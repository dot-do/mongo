/**
 * R2 SQL Result Mapper
 *
 * Maps SQL query results back to MongoDB document format.
 * Handles nested field reconstruction, type coercion, and array handling.
 */

import type { MapperOptions, FieldMapping } from './types'

// =============================================================================
// Extended Options (internal)
// =============================================================================

interface ExtendedMapperOptions extends MapperOptions {
  fieldMappings?: FieldMapping[]
}

// =============================================================================
// Result Mapper Class
// =============================================================================

/**
 * Result mapper for converting SQL rows to MongoDB documents
 */
export class ResultMapper {
  private _options: ExtendedMapperOptions
  private _dateFieldSet: Set<string>
  private _arrayFieldSet: Set<string>
  private _fieldMappingMap: Map<string, FieldMapping>

  constructor(options: ExtendedMapperOptions = {}) {
    this._options = {
      preserveUnderscoreId: options.preserveUnderscoreId ?? false,
      dateFields: options.dateFields ?? [],
      arrayFields: options.arrayFields ?? [],
      nestedFieldSeparator: options.nestedFieldSeparator ?? '__',
      snakeToCamel: options.snakeToCamel ?? false,
      fieldMappings: options.fieldMappings ?? [],
    }

    this._dateFieldSet = new Set(this._options.dateFields)
    this._arrayFieldSet = new Set(this._options.arrayFields)
    this._fieldMappingMap = new Map(
      this._options.fieldMappings?.map((m) => [m.sqlColumn, m]) ?? []
    )
  }

  /**
   * Map a single SQL row to a MongoDB document
   */
  mapRow(row: Record<string, unknown>): Record<string, unknown> {
    const doc: Record<string, unknown> = {}
    const nestedPaths: Map<string, Record<string, unknown>> = new Map()
    const arrayPaths: Map<string, unknown[]> = new Map()

    for (const [column, value] of Object.entries(row)) {
      // Check custom field mapping first
      const mapping = this._fieldMappingMap.get(column)
      if (mapping) {
        const coercedValue = this._coerceValue(value, mapping.type)
        this._setNestedValue(doc, mapping.mongoField, coercedValue)
        continue
      }

      // Handle doc_id -> _id conversion
      if (column === 'doc_id') {
        doc._id = value
        continue
      }

      // Handle _id preservation
      if (column === '_id' && this._options.preserveUnderscoreId) {
        doc._id = value
        continue
      }

      const separator = this._options.nestedFieldSeparator!

      // Check for nested field pattern
      if (column.includes(separator)) {
        const parts = column.split(separator)
        const rootField = parts[0]

        // Check if this is an array field
        const isArrayField = this._arrayFieldSet.has(rootField) || /^\d+$/.test(parts[1])

        if (isArrayField || /^\d+$/.test(parts[1])) {
          // Array reconstruction
          this._handleArrayField(arrayPaths, parts, value)
        } else {
          // Nested object reconstruction
          this._handleNestedField(nestedPaths, parts, value)
        }
        continue
      }

      // Handle snake_case to camelCase conversion
      let fieldName = column
      if (this._options.snakeToCamel) {
        fieldName = this._snakeToCamel(column)
      }

      // Handle special field types
      const coercedValue = this._autoCoerce(fieldName, value)
      doc[fieldName] = coercedValue
    }

    // Merge nested objects into doc
    for (const [path, nested] of nestedPaths) {
      doc[path] = nested
    }

    // Merge arrays into doc
    for (const [path, arr] of arrayPaths) {
      doc[path] = arr
    }

    // Initialize empty arrays for declared array fields not present
    for (const arrayField of this._arrayFieldSet) {
      if (!(arrayField in doc)) {
        doc[arrayField] = []
      }
    }

    return doc
  }

  /**
   * Map multiple SQL rows to MongoDB documents
   */
  mapRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row) => this.mapRow(row))
  }

  /**
   * Map aggregation results to MongoDB format
   */
  mapAggregationResult(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row) => this._mapAggregationRow(row))
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _handleNestedField(
    nestedPaths: Map<string, Record<string, unknown>>,
    parts: string[],
    value: unknown
  ): void {
    const rootField = parts[0]

    if (!nestedPaths.has(rootField)) {
      nestedPaths.set(rootField, {})
    }

    const nested = nestedPaths.get(rootField)!
    const path = parts.slice(1)

    this._setNestedValue(nested, path.join('.'), value)
  }

  private _handleArrayField(
    arrayPaths: Map<string, unknown[]>,
    parts: string[],
    value: unknown
  ): void {
    const rootField = parts[0]
    const indexStr = parts[1]
    const index = parseInt(indexStr, 10)

    if (!arrayPaths.has(rootField)) {
      arrayPaths.set(rootField, [])
    }

    const arr = arrayPaths.get(rootField)!

    // Extend array if needed
    while (arr.length <= index) {
      arr.push(undefined)
    }

    if (parts.length > 2) {
      // Nested object in array
      const nestedPath = parts.slice(2).join('.')
      if (arr[index] === undefined) {
        arr[index] = {}
      }
      this._setNestedValue(arr[index] as Record<string, unknown>, nestedPath, value)
    } else {
      arr[index] = value
    }
  }

  private _setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  private _autoCoerce(fieldName: string, value: unknown): unknown {
    // Handle null
    if (value === null) {
      return null
    }

    // Handle date fields
    if (this._dateFieldSet.has(fieldName) && typeof value === 'string') {
      return new Date(value)
    }

    // Try to auto-detect and coerce types
    if (typeof value === 'string') {
      // Try JSON parsing for object/array strings
      if ((value.startsWith('{') && value.endsWith('}')) ||
          (value.startsWith('[') && value.endsWith(']'))) {
        try {
          return JSON.parse(value)
        } catch {
          return value // Keep as string if invalid JSON
        }
      }

      // Boolean coercion
      if (value === 'true') return true
      if (value === 'false') return false

      const lowerFieldName = fieldName.toLowerCase()
      const isBooleanField = lowerFieldName.includes('bool') ||
          lowerFieldName.includes('enabled') ||
          lowerFieldName.includes('active') ||
          lowerFieldName.includes('disabled')

      if (isBooleanField) {
        if (value === '1') return true
        if (value === '0') return false
      }

      // Number coercion - only for values that look like pure numbers
      if (/^-?\d+$/.test(value)) {
        const num = parseInt(value, 10)
        // Check for BigInt needed
        if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
          return value // Keep as string for very large numbers
        }
        return num
      }
      if (/^-?\d+\.\d+$/.test(value)) {
        return parseFloat(value)
      }
    }

    return value
  }

  private _coerceValue(value: unknown, type?: string): unknown {
    if (value === null || value === undefined) return value

    switch (type) {
      case 'date':
        return typeof value === 'string' ? new Date(value) : value
      case 'number':
        return typeof value === 'string' ? parseFloat(value) : value
      case 'boolean':
        if (typeof value === 'string') {
          return value === 'true' || value === '1'
        }
        return Boolean(value)
      case 'object':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return value
          }
        }
        return value
      case 'array':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return [value]
          }
        }
        return Array.isArray(value) ? value : [value]
      default:
        return value
    }
  }

  private _mapAggregationRow(row: Record<string, unknown>): Record<string, unknown> {
    const doc: Record<string, unknown> = {}
    const separator = this._options.nestedFieldSeparator!

    // Look for compound _id fields
    const idFields: Record<string, unknown> = {}
    let hasCompoundId = false

    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith('_id' + separator)) {
        hasCompoundId = true
        const fieldName = column.slice(('_id' + separator).length)
        idFields[fieldName] = value
      } else if (column === '_id') {
        doc._id = value
      } else if (column === 'category' && !('_id' in row)) {
        // Handle case where category is the grouping field but named differently
        doc._id = value
      } else {
        // Rename SQL aggregate aliases to MongoDB format
        let mongoField = column
        if (column.startsWith('sum_')) {
          mongoField = 'total' + this._capitalize(column.slice(4))
        } else if (column.startsWith('avg_')) {
          mongoField = 'avg' + this._capitalize(column.slice(4))
        } else if (column === 'count_star') {
          mongoField = 'count'
        }

        doc[mongoField] = value
      }
    }

    if (hasCompoundId) {
      doc._id = idFields
    }

    return doc
  }

  private _snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
  }

  private _capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new result mapper instance
 */
export function createResultMapper(options?: ExtendedMapperOptions): ResultMapper {
  return new ResultMapper(options)
}
