/**
 * Schema Evolution Manager
 *
 * Automatic schema evolution for Iceberg tables based on CDC events.
 * Handles detection of new fields and type changes from MongoDB documents.
 */

import type { IcebergTableClient } from './table'
import type { IcebergField, IcebergSchema, SchemaEvolution } from './types'
import { CatalogError } from './types'

// =============================================================================
// MongoDB to Iceberg Type Mapping
// =============================================================================

/**
 * Map MongoDB/BSON types to Iceberg types
 */
export function mongoTypeToIceberg(value: unknown): string {
  if (value === null || value === undefined) {
    return 'string' // Default for null values
  }

  const type = typeof value

  switch (type) {
    case 'string':
      return 'string'
    case 'number':
      // Check for integer vs float
      if (Number.isInteger(value)) {
        const num = value as number
        if (num >= -2147483648 && num <= 2147483647) {
          return 'int'
        }
        return 'long'
      }
      return 'double'
    case 'boolean':
      return 'boolean'
    case 'object':
      if (value instanceof Date) {
        return 'timestamptz'
      }
      if (Array.isArray(value)) {
        // Arrays stored as JSON strings
        return 'string'
      }
      if (value && typeof value === 'object' && '$oid' in value) {
        return 'string' // ObjectId
      }
      if (value && typeof value === 'object' && '$date' in value) {
        return 'timestamptz'
      }
      if (value && typeof value === 'object' && '$numberLong' in value) {
        return 'long'
      }
      if (value && typeof value === 'object' && '$numberDecimal' in value) {
        return 'decimal(38,18)'
      }
      // Nested objects stored as JSON strings
      return 'string'
    case 'bigint':
      return 'long'
    default:
      return 'string'
  }
}

/**
 * Check if a type change is a valid widening (safe type evolution)
 */
export function isValidTypeWidening(fromType: string, toType: string): boolean {
  const wideningMap: Record<string, string[]> = {
    int: ['long'],
    float: ['double'],
    decimal: ['decimal'], // Can increase precision
  }

  return wideningMap[fromType]?.includes(toType) ?? false
}

// =============================================================================
// Schema Diff
// =============================================================================

/**
 * Field difference between two schemas
 */
export interface FieldDiff {
  /** New fields to add */
  added: Array<{ name: string; type: string; doc?: string }>
  /** Removed fields (for information only - Iceberg doesn't support column deletion in some cases) */
  removed: string[]
  /** Type changes that need widening */
  typeChanges: Array<{ name: string; fromType: string; toType: string }>
}

/**
 * Compute the difference between current schema and incoming document fields
 */
export function computeSchemaDiff(
  currentSchema: IcebergSchema,
  documentFields: Record<string, unknown>
): FieldDiff {
  const currentFieldNames = new Set(currentSchema.fields.map((f) => f.name))
  const currentFieldTypes = new Map(currentSchema.fields.map((f) => [f.name, f.type]))

  const added: FieldDiff['added'] = []
  const typeChanges: FieldDiff['typeChanges'] = []
  const removed: string[] = []

  // Find new fields and type changes
  for (const [name, value] of Object.entries(documentFields)) {
    const icebergType = mongoTypeToIceberg(value)

    if (!currentFieldNames.has(name)) {
      // New field
      added.push({
        name,
        type: icebergType,
        doc: `Auto-detected from MongoDB document`,
      })
    } else {
      // Check for type change
      const currentType = currentFieldTypes.get(name)!
      if (currentType !== icebergType && isValidTypeWidening(currentType, icebergType)) {
        typeChanges.push({
          name,
          fromType: currentType,
          toType: icebergType,
        })
      }
    }
  }

  // Find removed fields (fields in schema but not in document)
  // Note: Single documents may not have all fields, so this is just informational
  for (const field of currentSchema.fields) {
    if (!(field.name in documentFields)) {
      removed.push(field.name)
    }
  }

  return { added, removed, typeChanges }
}

// =============================================================================
// Schema Evolution Manager
// =============================================================================

/**
 * Configuration for schema evolution
 */
export interface SchemaEvolutionConfig {
  /** Automatically add new columns when detected */
  autoAddColumns?: boolean
  /** Automatically widen column types when needed */
  autoWidenTypes?: boolean
  /** Log schema changes without applying them */
  dryRun?: boolean
  /** Maximum number of columns allowed */
  maxColumns?: number
  /** Columns that should never be auto-added (blocklist) */
  excludeColumns?: string[]
  /** Column name patterns to exclude (regex) */
  excludePatterns?: RegExp[]
}

/**
 * Schema evolution event
 */
export interface SchemaEvolutionEvent {
  /** Table identifier */
  tableId: string
  /** Timestamp of the evolution */
  timestamp: Date
  /** Type of change */
  changeType: 'add_column' | 'widen_type' | 'no_change'
  /** Details of the change */
  details: {
    fieldName?: string
    fromType?: string
    toType?: string
  }
  /** Whether the change was applied */
  applied: boolean
  /** Reason if not applied */
  reason?: string
}

/**
 * Manages automatic schema evolution for Iceberg tables
 */
export class SchemaEvolutionManager {
  private _tableClient: IcebergTableClient
  private _config: Required<SchemaEvolutionConfig>
  private _schemaVersions = new Map<string, number>()

  constructor(tableClient: IcebergTableClient, config: SchemaEvolutionConfig = {}) {
    this._tableClient = tableClient
    this._config = {
      autoAddColumns: config.autoAddColumns ?? true,
      autoWidenTypes: config.autoWidenTypes ?? true,
      dryRun: config.dryRun ?? false,
      maxColumns: config.maxColumns ?? 1000,
      excludeColumns: config.excludeColumns ?? [],
      excludePatterns: config.excludePatterns ?? [],
    }
  }

  /**
   * Process a batch of documents and evolve schema if needed
   */
  async processDocuments(documents: Record<string, unknown>[]): Promise<SchemaEvolutionEvent[]> {
    const events: SchemaEvolutionEvent[] = []
    const currentSchema = await this._tableClient.getCurrentSchema()

    // Merge all document fields to get complete field picture
    const mergedFields: Record<string, unknown> = {}
    for (const doc of documents) {
      for (const [key, value] of Object.entries(doc)) {
        if (!(key in mergedFields) || mergedFields[key] === null) {
          mergedFields[key] = value
        }
      }
    }

    // Flatten nested fields for schema detection
    const flattenedFields = this._flattenFields(mergedFields)

    // Compute schema diff
    const diff = computeSchemaDiff(currentSchema, flattenedFields)

    // Process additions
    for (const field of diff.added) {
      if (this._shouldExcludeField(field.name)) {
        events.push({
          tableId: this._getTableId(),
          timestamp: new Date(),
          changeType: 'add_column',
          details: { fieldName: field.name },
          applied: false,
          reason: 'Field excluded by configuration',
        })
        continue
      }

      if (currentSchema.fields.length >= this._config.maxColumns) {
        events.push({
          tableId: this._getTableId(),
          timestamp: new Date(),
          changeType: 'add_column',
          details: { fieldName: field.name },
          applied: false,
          reason: `Maximum column limit (${this._config.maxColumns}) reached`,
        })
        continue
      }

      if (this._config.autoAddColumns && !this._config.dryRun) {
        try {
          const evolution: SchemaEvolution = {
            addColumn: {
              name: field.name,
              type: field.type,
              required: false, // Auto-added columns are always optional
              doc: field.doc,
            },
          }
          await this._tableClient.evolveSchema(evolution)

          events.push({
            tableId: this._getTableId(),
            timestamp: new Date(),
            changeType: 'add_column',
            details: { fieldName: field.name, toType: field.type },
            applied: true,
          })
        } catch (error) {
          events.push({
            tableId: this._getTableId(),
            timestamp: new Date(),
            changeType: 'add_column',
            details: { fieldName: field.name },
            applied: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      } else {
        events.push({
          tableId: this._getTableId(),
          timestamp: new Date(),
          changeType: 'add_column',
          details: { fieldName: field.name, toType: field.type },
          applied: false,
          reason: this._config.dryRun
            ? 'Dry run mode'
            : 'Auto-add columns disabled',
        })
      }
    }

    // Process type changes
    for (const change of diff.typeChanges) {
      if (this._config.autoWidenTypes && !this._config.dryRun) {
        try {
          const evolution: SchemaEvolution = {
            updateColumnType: {
              name: change.name,
              newType: change.toType,
            },
          }
          await this._tableClient.evolveSchema(evolution)

          events.push({
            tableId: this._getTableId(),
            timestamp: new Date(),
            changeType: 'widen_type',
            details: {
              fieldName: change.name,
              fromType: change.fromType,
              toType: change.toType,
            },
            applied: true,
          })
        } catch (error) {
          events.push({
            tableId: this._getTableId(),
            timestamp: new Date(),
            changeType: 'widen_type',
            details: {
              fieldName: change.name,
              fromType: change.fromType,
              toType: change.toType,
            },
            applied: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      } else {
        events.push({
          tableId: this._getTableId(),
          timestamp: new Date(),
          changeType: 'widen_type',
          details: {
            fieldName: change.name,
            fromType: change.fromType,
            toType: change.toType,
          },
          applied: false,
          reason: this._config.dryRun
            ? 'Dry run mode'
            : 'Auto-widen types disabled',
        })
      }
    }

    if (events.length === 0) {
      events.push({
        tableId: this._getTableId(),
        timestamp: new Date(),
        changeType: 'no_change',
        details: {},
        applied: true,
      })
    }

    return events
  }

  /**
   * Check if a batch of documents would require schema evolution
   */
  async checkSchemaCompatibility(
    documents: Record<string, unknown>[]
  ): Promise<{ compatible: boolean; diff: FieldDiff }> {
    const currentSchema = await this._tableClient.getCurrentSchema()

    const mergedFields: Record<string, unknown> = {}
    for (const doc of documents) {
      for (const [key, value] of Object.entries(doc)) {
        if (!(key in mergedFields) || mergedFields[key] === null) {
          mergedFields[key] = value
        }
      }
    }

    const flattenedFields = this._flattenFields(mergedFields)
    const diff = computeSchemaDiff(currentSchema, flattenedFields)

    const compatible = diff.added.length === 0 && diff.typeChanges.length === 0

    return { compatible, diff }
  }

  /**
   * Get the current schema version
   */
  async getSchemaVersion(): Promise<number> {
    const schema = await this._tableClient.getCurrentSchema()
    return schema.schemaId
  }

  private _getTableId(): string {
    // This would come from the table client in a real implementation
    return 'table'
  }

  private _shouldExcludeField(fieldName: string): boolean {
    if (this._config.excludeColumns.includes(fieldName)) {
      return true
    }

    for (const pattern of this._config.excludePatterns) {
      if (pattern.test(fieldName)) {
        return true
      }
    }

    return false
  }

  private _flattenFields(
    obj: Record<string, unknown>,
    prefix = '',
    result: Record<string, unknown> = {}
  ): Record<string, unknown> {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}__${key}` : key

      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        // Check for BSON extended types
        const valueObj = value as Record<string, unknown>
        if ('$oid' in valueObj || '$date' in valueObj || '$numberLong' in valueObj || '$numberDecimal' in valueObj) {
          result[newKey] = value
        } else {
          // Recursively flatten nested objects
          this._flattenFields(valueObj, newKey, result)
        }
      } else {
        result[newKey] = value
      }
    }

    return result
  }
}

/**
 * Create a schema evolution manager for a table
 */
export function createSchemaEvolutionManager(
  tableClient: IcebergTableClient,
  config?: SchemaEvolutionConfig
): SchemaEvolutionManager {
  return new SchemaEvolutionManager(tableClient, config)
}
