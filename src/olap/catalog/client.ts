/**
 * R2 Data Catalog Client
 *
 * Client for managing Cloudflare R2 Data Catalogs including:
 * - Catalog enablement and configuration
 * - Namespace management
 * - Table listing and discovery
 */

import {
  type R2CatalogConfig,
  type R2DataCatalog,
  type CatalogNamespace,
  type CatalogTableSummary,
  type EnableCatalogOptions,
  type ListNamespacesOptions,
  type ListTablesOptions,
  type PaginatedResult,
  CatalogError,
} from './types'

const DEFAULT_TIMEOUT = 30000
const NAMESPACE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * R2 Catalog Client for managing R2 Data Catalogs
 */
export class R2CatalogClient {
  private _config: R2CatalogConfig
  private _closed = false
  private _baseUrl: string

  constructor(config: R2CatalogConfig) {
    this._config = {
      ...config,
      connectionTimeout: config.connectionTimeout ?? DEFAULT_TIMEOUT,
    }
    this._baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}/catalog`
  }

  /**
   * Get the client configuration
   */
  getConfig(): R2CatalogConfig {
    return { ...this._config }
  }

  /**
   * Check if the client is closed
   */
  isClosed(): boolean {
    return this._closed
  }

  /**
   * Close the client and release resources
   */
  async close(): Promise<void> {
    this._closed = true
  }

  /**
   * Make an authenticated request to the R2 API
   */
  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (this._closed) {
      throw new CatalogError('Client is closed', 'CLIENT_CLOSED')
    }

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this._config.connectionTimeout
    )

    try {
      const response = await fetch(`${this._baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this._config.apiToken && {
            Authorization: `Bearer ${this._config.apiToken}`,
          }),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const data = await response.json()

      if (!response.ok) {
        const error = (data as { error?: { message: string; code: string } })
          .error
        throw new CatalogError(
          error?.message ?? 'Request failed',
          error?.code ?? 'UNKNOWN_ERROR',
          response.status
        )
      }

      return data as T
    } catch (error) {
      if (error instanceof CatalogError) {
        throw error
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new CatalogError('Connection timeout', 'TIMEOUT')
        }
        if (error.message.includes('ECONNREFUSED') || error.message.includes('Network')) {
          throw new CatalogError(
            'Failed to connect to R2: Network error',
            'NETWORK_ERROR'
          )
        }
        throw new CatalogError(error.message, 'UNKNOWN_ERROR')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Enable the data catalog on the R2 bucket
   */
  async enableCatalog(options?: EnableCatalogOptions): Promise<R2DataCatalog> {
    const response = await this._request<{ catalog: R2DataCatalogResponse }>(
      'POST',
      '/enable',
      {
        catalogName: options?.catalogName,
        defaultNamespace: options?.defaultNamespace,
        metadataLocation: options?.metadataLocation,
      }
    )

    return this._mapCatalog(response.catalog)
  }

  /**
   * Disable the data catalog on the R2 bucket
   */
  async disableCatalog(): Promise<void> {
    await this._request('POST', '/disable')
  }

  /**
   * Get catalog information
   */
  async getCatalogInfo(): Promise<R2DataCatalog | null> {
    const response = await this._request<{
      catalog: R2DataCatalogResponse | null
    }>('GET', '')

    if (!response.catalog) {
      return null
    }

    return this._mapCatalog(response.catalog)
  }

  /**
   * Check if the catalog is enabled
   */
  async isCatalogEnabled(): Promise<boolean> {
    const response = await this._request<{ enabled: boolean }>('GET', '/status')
    return response.enabled
  }

  /**
   * List namespaces in the catalog
   */
  async listNamespaces(
    options?: ListNamespacesOptions
  ): Promise<PaginatedResult<CatalogNamespace>> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.cursor) params.set('cursor', options.cursor)
    if (options?.prefix) params.set('prefix', options.prefix)

    const query = params.toString()
    const response = await this._request<{
      namespaces: CatalogNamespaceResponse[]
      cursor?: string
      hasMore: boolean
    }>('GET', `/namespaces${query ? `?${query}` : ''}`)

    return {
      items: response.namespaces.map(this._mapNamespace),
      cursor: response.cursor,
      hasMore: response.hasMore,
    }
  }

  /**
   * Create a namespace in the catalog
   */
  async createNamespace(
    name: string,
    properties?: Record<string, string>
  ): Promise<CatalogNamespace> {
    // Validate namespace name
    if (!NAMESPACE_NAME_PATTERN.test(name)) {
      throw new CatalogError(
        'Invalid namespace name',
        'INVALID_NAMESPACE_NAME'
      )
    }

    const response = await this._request<{
      namespace: CatalogNamespaceResponse
    }>('POST', '/namespaces', { name, properties })

    return this._mapNamespace(response.namespace)
  }

  /**
   * Delete a namespace from the catalog
   */
  async deleteNamespace(name: string): Promise<void> {
    await this._request('DELETE', `/namespaces/${encodeURIComponent(name)}`)
  }

  /**
   * Get a namespace by name
   */
  async getNamespace(name: string): Promise<CatalogNamespace | null> {
    const response = await this._request<{
      namespace: CatalogNamespaceResponse | null
    }>('GET', `/namespaces/${encodeURIComponent(name)}`)

    if (!response.namespace) {
      return null
    }

    return this._mapNamespace(response.namespace)
  }

  /**
   * List tables in a namespace
   */
  async listTables(
    options: ListTablesOptions
  ): Promise<PaginatedResult<CatalogTableSummary>> {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.prefix) params.set('prefix', options.prefix)

    const query = params.toString()
    const response = await this._request<{
      tables: CatalogTableSummary[]
      cursor?: string
      hasMore: boolean
    }>(
      'GET',
      `/namespaces/${encodeURIComponent(options.namespace)}/tables${query ? `?${query}` : ''}`
    )

    return {
      items: response.tables,
      cursor: response.cursor,
      hasMore: response.hasMore,
    }
  }

  /**
   * Get table metadata
   */
  async getTableMetadata(
    namespace: string,
    tableName: string
  ): Promise<Record<string, unknown> | null> {
    const response = await this._request<{
      metadata: Record<string, unknown> | null
    }>(
      'GET',
      `/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(tableName)}/metadata`
    )

    return response.metadata
  }

  private _mapCatalog(response: R2DataCatalogResponse): R2DataCatalog {
    return {
      name: response.name,
      bucket: response.bucket,
      enabled: response.enabled,
      location: response.location,
      createdAt: new Date(response.createdAt),
      updatedAt: response.updatedAt ? new Date(response.updatedAt) : undefined,
      namespaceCount: response.namespaceCount,
      tableCount: response.tableCount,
    }
  }

  private _mapNamespace(response: CatalogNamespaceResponse): CatalogNamespace {
    return {
      name: response.name,
      location: response.location,
      tableCount: response.tableCount,
      createdAt: new Date(response.createdAt),
      properties: response.properties,
    }
  }
}

// Response types from API
interface R2DataCatalogResponse {
  name: string
  bucket: string
  enabled: boolean
  location: string
  createdAt: string
  updatedAt?: string
  namespaceCount?: number
  tableCount?: number
}

interface CatalogNamespaceResponse {
  name: string
  location: string
  tableCount: number
  createdAt: string
  properties?: Record<string, string>
}

/**
 * Create a new R2 Catalog Client
 *
 * @param config - Client configuration
 * @returns Promise resolving to the client instance
 * @throws CatalogError if configuration is invalid or connection fails
 */
export async function createR2CatalogClient(
  config: R2CatalogConfig
): Promise<R2CatalogClient> {
  // Validate configuration
  if (!config.accountId) {
    throw new CatalogError(
      'Invalid configuration: accountId is required',
      'INVALID_CONFIG'
    )
  }

  if (!config.bucketName) {
    throw new CatalogError(
      'Invalid configuration: bucketName is required',
      'INVALID_CONFIG'
    )
  }

  const client = new R2CatalogClient(config)

  // Test connection with a simple request
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    config.connectionTimeout ?? DEFAULT_TIMEOUT
  )

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiToken && {
            Authorization: `Bearer ${config.apiToken}`,
          }),
        },
        signal: controller.signal,
      }
    )

    const data = await response.json()

    if (!response.ok) {
      const error = (data as { error?: { message: string; code: string } }).error
      if (response.status === 401) {
        throw new CatalogError('Authentication failed', 'AUTH_ERROR', 401)
      }
      if (response.status === 429) {
        throw new CatalogError('Rate limit exceeded', 'RATE_LIMIT', 429)
      }
      if (response.status >= 500) {
        throw new CatalogError(
          error?.message ?? 'Internal server error',
          'INTERNAL_ERROR',
          response.status
        )
      }
      throw new CatalogError(
        error?.message ?? 'Request failed',
        error?.code ?? 'UNKNOWN_ERROR',
        response.status
      )
    }

    return client
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new CatalogError('Connection timeout', 'TIMEOUT')
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('Network')) {
        throw new CatalogError(
          'Failed to connect to R2: Network error',
          'NETWORK_ERROR'
        )
      }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
