/**
 * Iceberg Table Management
 *
 * Client for managing Iceberg tables within R2 Data Catalogs:
 * - Table creation with schemas
 * - Schema evolution (add/rename/drop columns)
 * - Partition specification management
 * - Snapshot listing and management
 */

import type { R2CatalogClient } from './client'
import {
  type IcebergField,
  type IcebergSchema,
  type PartitionField,
  type PartitionSpec,
  type IcebergSnapshot,
  type IcebergTableMetadata,
  type CreateTableOptions,
  type SchemaEvolution,
  CatalogError,
} from './types'

// Type widening rules for Iceberg schema evolution
const TYPE_WIDENING: Record<string, string[]> = {
  int: ['long'],
  float: ['double'],
  decimal: ['decimal'], // Can increase precision/scale
}

/**
 * Iceberg table client for managing individual tables
 */
export class IcebergTableClient {
  private _catalogClient: R2CatalogClient
  private _namespace: string
  private _tableName: string
  private _baseUrl: string

  constructor(
    catalogClient: R2CatalogClient,
    namespace: string,
    tableName: string
  ) {
    this._catalogClient = catalogClient
    this._namespace = namespace
    this._tableName = tableName
    const config = catalogClient.getConfig()
    this._baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}/catalog/namespaces/${namespace}/tables/${tableName}`
  }

  /**
   * Get full table metadata
   */
  async getMetadata(): Promise<IcebergTableMetadata> {
    const response = await this._request<{ metadata: IcebergTableMetadataResponse }>(
      'GET',
      '/metadata'
    )
    return this._mapMetadata(response.metadata)
  }

  /**
   * Get the current schema
   */
  async getCurrentSchema(): Promise<IcebergSchema> {
    const response = await this._request<{ schema: IcebergSchema }>(
      'GET',
      '/schema'
    )
    return response.schema
  }

  /**
   * Evolve the table schema
   */
  async evolveSchema(evolution: SchemaEvolution): Promise<IcebergSchema> {
    // Validate evolution operation
    if (evolution.updateColumnType) {
      const currentSchema = await this.getCurrentSchema()
      const field = currentSchema.fields.find(
        (f) => f.name === evolution.updateColumnType!.name
      )
      if (field) {
        const allowedTypes = TYPE_WIDENING[field.type] || []
        if (!allowedTypes.includes(evolution.updateColumnType.newType)) {
          throw new CatalogError(
            `Cannot narrow type from ${field.type} to ${evolution.updateColumnType.newType}`,
            'INVALID_TYPE_CHANGE'
          )
        }
      }
    }

    if (evolution.dropColumn) {
      const currentSchema = await this.getCurrentSchema()
      const field = currentSchema.fields.find(
        (f) => f.name === evolution.dropColumn!.name
      )
      if (field?.required) {
        throw new CatalogError(
          'Cannot drop required column',
          'INVALID_SCHEMA_CHANGE'
        )
      }
    }

    const response = await this._request<{ schema: IcebergSchema }>(
      'POST',
      '/schema/evolve',
      evolution
    )
    return response.schema
  }

  /**
   * Get the table location in R2
   */
  async getLocation(): Promise<string> {
    const response = await this._request<{ location: string }>('GET', '/location')
    return response.location
  }

  /**
   * Get the current partition specification
   */
  async getPartitionSpec(): Promise<PartitionSpec> {
    const response = await this._request<{ partitionSpec: PartitionSpec }>(
      'GET',
      '/partition-spec'
    )
    return response.partitionSpec
  }

  /**
   * List table snapshots
   */
  async listSnapshots(options?: { limit?: number }): Promise<IcebergSnapshot[]> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this._request<{ snapshots: IcebergSnapshot[] }>(
      'GET',
      `/snapshots${query ? `?${query}` : ''}`
    )
    return response.snapshots
  }

  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<IcebergSnapshot> {
    const response = await this._request<{ snapshot: IcebergSnapshot }>(
      'GET',
      `/snapshots/${encodeURIComponent(snapshotId)}`
    )
    return response.snapshot
  }

  /**
   * Rollback to a previous snapshot
   */
  async rollbackToSnapshot(snapshotId: string): Promise<void> {
    await this._request('POST', `/snapshots/${encodeURIComponent(snapshotId)}/rollback`)
  }

  /**
   * Set table properties
   */
  async setProperties(properties: Record<string, string>): Promise<void> {
    await this._request('POST', '/properties', { properties })
  }

  /**
   * Get table properties
   */
  async getProperties(): Promise<Record<string, string>> {
    const response = await this._request<{ properties: Record<string, string> }>(
      'GET',
      '/properties'
    )
    return response.properties
  }

  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (this._catalogClient.isClosed()) {
      throw new CatalogError('Client is closed', 'CLIENT_CLOSED')
    }

    const config = this._catalogClient.getConfig()
    const response = await fetch(`${this._baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiToken && {
          Authorization: `Bearer ${config.apiToken}`,
        }),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json()

    if (!response.ok) {
      const error = (data as { error?: { message: string; code: string } }).error
      throw new CatalogError(
        error?.message ?? 'Request failed',
        error?.code ?? 'UNKNOWN_ERROR',
        response.status
      )
    }

    return data as T
  }

  private _mapMetadata(response: IcebergTableMetadataResponse): IcebergTableMetadata {
    return {
      name: response.name,
      namespace: response.namespace,
      uuid: response.uuid,
      location: response.location,
      currentSchema: response.currentSchema,
      schemas: response.schemas,
      currentPartitionSpec: response.currentPartitionSpec,
      partitionSpecs: response.partitionSpecs,
      currentSnapshotId: response.currentSnapshotId,
      snapshots: response.snapshots,
      properties: response.properties,
      createdAt: new Date(response.createdAt),
      updatedAt: new Date(response.updatedAt),
    }
  }
}

interface IcebergTableMetadataResponse {
  name: string
  namespace: string
  uuid: string
  location: string
  currentSchema: IcebergSchema
  schemas: IcebergSchema[]
  currentPartitionSpec: PartitionSpec
  partitionSpecs: PartitionSpec[]
  currentSnapshotId?: string
  snapshots: IcebergSnapshot[]
  properties: Record<string, string>
  createdAt: string
  updatedAt: string
}

/**
 * Create a new Iceberg table in the catalog
 */
export async function createTable(
  catalogClient: R2CatalogClient,
  namespace: string,
  tableName: string,
  options: CreateTableOptions
): Promise<IcebergTableClient> {
  // Validate schema
  if (!options.schema || options.schema.length === 0) {
    throw new CatalogError('Schema cannot be empty', 'INVALID_SCHEMA')
  }

  // Check for duplicate field names
  const fieldNames = new Set<string>()
  for (const field of options.schema) {
    if (fieldNames.has(field.name)) {
      throw new CatalogError(
        `Duplicate field name: ${field.name}`,
        'DUPLICATE_FIELD'
      )
    }
    fieldNames.add(field.name)
  }

  // Assign field IDs
  const schema: IcebergField[] = options.schema.map((field, index) => ({
    ...field,
    id: index + 1,
  }))

  // Build partition spec with field IDs
  const partitionSpec: PartitionField[] | undefined = options.partitionSpec?.map(
    (field, index) => ({
      ...field,
      fieldId: 1000 + index,
    })
  )

  // Resolve identifier field IDs
  let identifierFieldIds: number[] | undefined
  if (options.identifierFields) {
    identifierFieldIds = options.identifierFields.map((name) => {
      const field = schema.find((f) => f.name === name)
      if (!field) {
        throw new CatalogError(
          `Identifier field not found: ${name}`,
          'INVALID_IDENTIFIER'
        )
      }
      return field.id
    })
  }

  const config = catalogClient.getConfig()
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}/catalog/namespaces/${namespace}/tables`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiToken && {
        Authorization: `Bearer ${config.apiToken}`,
      }),
    },
    body: JSON.stringify({
      name: tableName,
      schema: {
        schemaId: 0,
        fields: schema,
        identifierFieldIds,
      },
      partitionSpec: partitionSpec
        ? {
            specId: 0,
            fields: partitionSpec,
          }
        : undefined,
      properties: options.properties,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    const error = (data as { error?: { message: string; code: string } }).error
    if (response.status === 409) {
      throw new CatalogError('Table already exists', 'TABLE_EXISTS', 409)
    }
    throw new CatalogError(
      error?.message ?? 'Failed to create table',
      error?.code ?? 'UNKNOWN_ERROR',
      response.status
    )
  }

  return new IcebergTableClient(catalogClient, namespace, tableName)
}

/**
 * Get an existing Iceberg table client
 */
export function getTable(
  catalogClient: R2CatalogClient,
  namespace: string,
  tableName: string
): IcebergTableClient {
  return new IcebergTableClient(catalogClient, namespace, tableName)
}

/**
 * Delete an Iceberg table from the catalog
 */
export async function deleteTable(
  catalogClient: R2CatalogClient,
  namespace: string,
  tableName: string
): Promise<void> {
  const config = catalogClient.getConfig()
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}/catalog/namespaces/${namespace}/tables/${tableName}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiToken && {
        Authorization: `Bearer ${config.apiToken}`,
      }),
    },
  })

  if (!response.ok) {
    const data = await response.json()
    const error = (data as { error?: { message: string; code: string } }).error
    throw new CatalogError(
      error?.message ?? 'Failed to delete table',
      error?.code ?? 'UNKNOWN_ERROR',
      response.status
    )
  }
}
