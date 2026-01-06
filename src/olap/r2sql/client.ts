/**
 * R2 SQL Query Client
 *
 * Client for executing SQL queries against Iceberg tables in R2.
 * Supports connection pooling, query caching, pagination, and streaming.
 */

import {
  type R2SQLClientOptions,
  type QueryOptions,
  type QueryResult,
  type QueryStatus,
  type ExecuteResult,
  R2SQLError,
} from './types'

// =============================================================================
// Cache Implementation
// =============================================================================

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

class QueryCache<T = QueryResult> {
  private _cache = new Map<string, CacheEntry<T>>()
  private _maxSize: number

  constructor(maxSize = 1000) {
    this._maxSize = maxSize
  }

  get(key: string): T | undefined {
    const entry = this._cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: T, ttl: number): void {
    if (this._cache.size >= this._maxSize) {
      // Remove oldest entry
      const firstKey = this._cache.keys().next().value
      if (firstKey) this._cache.delete(firstKey)
    }
    this._cache.set(key, { data, expiresAt: Date.now() + ttl })
  }

  clear(): void {
    this._cache.clear()
  }
}

// =============================================================================
// Client Class
// =============================================================================

/**
 * R2 SQL Client for query execution
 */
export class R2SQLClient {
  private _options: Required<R2SQLClientOptions>
  private _closed = false
  private _cache: QueryCache | null = null
  private _queryStatuses = new Map<string, QueryStatus>()
  private _nextQueryId = 1

  constructor(options: R2SQLClientOptions) {
    this._options = {
      endpoint: options.endpoint,
      credentials: options.credentials ?? { accessKeyId: '', secretAccessKey: '' },
      maxConnections: options.maxConnections ?? 10,
      queryTimeout: options.queryTimeout ?? 30000,
      cache: options.cache ?? { enabled: false },
    }

    if (this._options.cache.enabled) {
      this._cache = new QueryCache(this._options.cache.maxSize ?? 1000)
    }
  }

  /**
   * Execute a SELECT query and return results
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    this._ensureNotClosed()

    const queryId = this._generateQueryId()
    const startTime = Date.now()
    const timeout = options.timeout ?? this._options.queryTimeout

    // Check cache
    if (options.cache !== false && this._cache) {
      const cacheKey = this._getCacheKey(sql, params, options)
      const cached = this._cache.get(cacheKey)
      if (cached) {
        return {
          ...cached,
          executionTime: 0,
        } as QueryResult<T>
      }
    }

    // Track query status
    this._queryStatuses.set(queryId, { status: 'running', progress: 0 })

    try {
      // Set up abort handling
      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort())
      }

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          controller.abort()
          this._queryStatuses.set(queryId, { status: 'failed' })
        }, timeout)
      }

      // Build query with pagination
      let finalSql = sql
      if (options.maxRows !== undefined && !sql.toLowerCase().includes('limit')) {
        finalSql += ` LIMIT ${options.maxRows + 1}` // +1 to detect hasMore
      }
      if (options.offset !== undefined && !sql.toLowerCase().includes('offset')) {
        finalSql += ` OFFSET ${options.offset}`
      }

      // Execute query
      const response = await this._executeRequest(
        finalSql,
        params,
        controller.signal
      )

      if (timeoutId) clearTimeout(timeoutId)

      // Process results
      let rows = response.rows as T[]
      let hasMore = false

      if (options.maxRows !== undefined && rows.length > options.maxRows) {
        hasMore = true
        rows = rows.slice(0, options.maxRows)
      }

      const executionTime = Date.now() - startTime

      const result: QueryResult<T> = {
        rows,
        rowCount: rows.length,
        hasMore,
        queryId,
        executionTime,
        bytesScanned: response.bytesScanned,
      }

      // Update status
      this._queryStatuses.set(queryId, { status: 'completed' })

      // Cache result
      if (options.cache !== false && this._cache && this._options.cache.ttl) {
        const cacheKey = this._getCacheKey(sql, params, options)
        this._cache.set(cacheKey, result as QueryResult, this._options.cache.ttl)
      }

      return result
    } catch (error) {
      this._queryStatuses.set(queryId, { status: 'failed' })

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          if (options.signal?.aborted) {
            throw new R2SQLError('Query aborted', 'QUERY_ABORTED')
          }
          throw new R2SQLError('Query timeout', 'QUERY_TIMEOUT')
        }
        throw new R2SQLError(error.message, 'QUERY_ERROR')
      }
      throw error
    }
  }

  /**
   * Stream query results row by row
   */
  async *queryStream<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): AsyncIterable<T> {
    this._ensureNotClosed()

    const batchSize = options.maxRows ?? 1000
    let offset = options.offset ?? 0
    let hasMore = true

    while (hasMore) {
      const result = await this.query<T>(sql, params, {
        ...options,
        maxRows: batchSize,
        offset,
        cache: false, // Don't cache streaming results
      })

      for (const row of result.rows) {
        yield row
      }

      hasMore = result.hasMore
      offset += batchSize
    }
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    this._ensureNotClosed()

    try {
      const response = await this._executeRequest(sql, params)

      return {
        success: true,
        rowsAffected: response.rowsAffected ?? 0,
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new R2SQLError(error.message, 'EXECUTE_ERROR')
      }
      throw error
    }
  }

  /**
   * Cancel a running query
   */
  async cancelQuery(queryId: string): Promise<void> {
    this._queryStatuses.set(queryId, { status: 'cancelled' })

    // In a real implementation, this would send a cancel request to the server
    // For now, we just update the status
  }

  /**
   * Get the status of a query
   */
  async getQueryStatus(queryId: string): Promise<QueryStatus> {
    const status = this._queryStatuses.get(queryId)
    return status ?? { status: 'completed' }
  }

  /**
   * Close the client and release resources
   */
  async close(): Promise<void> {
    this._closed = true
    this._cache?.clear()
    this._queryStatuses.clear()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _ensureNotClosed(): void {
    if (this._closed) {
      throw new R2SQLError('Client is closed', 'CLIENT_CLOSED')
    }
  }

  private _generateQueryId(): string {
    return `query-${this._nextQueryId++}-${Date.now()}`
  }

  private _getCacheKey(sql: string, params: unknown[], options: QueryOptions): string {
    return JSON.stringify({ sql, params, maxRows: options.maxRows, offset: options.offset })
  }

  private async _executeRequest(
    sql: string,
    params: unknown[],
    signal?: AbortSignal
  ): Promise<{ rows: unknown[]; bytesScanned?: number; rowsAffected?: number }> {
    // Apply parameter substitution
    const finalSql = this._substituteParams(sql, params)

    const response = await fetch(`${this._options.endpoint}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this._options.credentials.accessKeyId && {
          Authorization: `Basic ${btoa(
            `${this._options.credentials.accessKeyId}:${this._options.credentials.secretAccessKey}`
          )}`,
        }),
      },
      body: JSON.stringify({ query: finalSql }),
      signal,
    })

    if (!response.ok) {
      const error = await response.text()
      if (error.toLowerCase().includes('syntax')) {
        throw new R2SQLError(error, 'SYNTAX_ERROR')
      }
      throw new R2SQLError(error, 'QUERY_ERROR')
    }

    return response.json()
  }

  private _substituteParams(sql: string, params: unknown[]): string {
    let paramIndex = 0
    return sql.replace(/\?/g, () => {
      const value = params[paramIndex++]
      return this._escapeValue(value)
    })
  }

  private _escapeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    if (typeof value === 'string') {
      // Escape single quotes and wrap in quotes
      return `'${value.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE'
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`
    }
    if (Array.isArray(value)) {
      return `(${value.map((v) => this._escapeValue(v)).join(', ')})`
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new R2 SQL client instance
 */
export function createR2SQLClient(options: R2SQLClientOptions): R2SQLClient {
  return new R2SQLClient(options)
}
