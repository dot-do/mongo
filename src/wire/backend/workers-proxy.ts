/**
 * WorkersProxyBackend
 *
 * MondoBackend implementation that proxies requests to Cloudflare Workers
 * via the RPC endpoint. This enables the wire protocol server to delegate
 * operations to a remote Cloudflare Workers deployment.
 */

import type { Document } from 'bson'
import type {
  MondoBackend,
  DatabaseInfo,
  CollectionInfo,
  FindOptions,
  FindResult,
  InsertResult,
  UpdateResult,
  DeleteResult,
  AggregateResult,
  CollStats,
  DbStats,
  IndexInfo,
  IndexSpec,
  CursorState,
} from './interface.js'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration options for WorkersProxyBackend
 */
export interface WorkersProxyBackendOptions {
  /** RPC endpoint URL (required) */
  endpoint: string
  /** Authentication token (optional) */
  authToken?: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Number of retries on transient failures (default: 0) */
  retries?: number
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number
  /** Use exponential backoff for retries (default: true) */
  exponentialBackoff?: boolean
  /** Maximum delay between retries in milliseconds (default: 30000) */
  maxRetryDelay?: number
}

/**
 * RPC request structure
 */
interface RpcRequest {
  method: string
  db?: string
  collection?: string
  filter?: Document
  update?: Document
  document?: Document
  documents?: Document[]
  pipeline?: Document[]
  options?: Document
  field?: string
  query?: Document
}

/**
 * RPC success response
 */
interface RpcSuccessResponse {
  ok: 1
  result: unknown
}

/**
 * RPC error response
 */
interface RpcErrorResponse {
  ok: 0
  error: string
  code: number
  codeName?: string
}

type RpcResponse = RpcSuccessResponse | RpcErrorResponse

/**
 * Error with MongoDB-compatible error code
 */
export class MongoProxyError extends Error {
  code: number
  codeName?: string

  constructor(message: string, code: number, codeName?: string) {
    super(message)
    this.name = 'MongoProxyError'
    this.code = code
    if (codeName) {
      this.codeName = codeName
    }
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Cursor timeout in milliseconds (10 minutes) */
const CURSOR_TIMEOUT_MS = 10 * 60 * 1000

/** HTTP status codes that should trigger retries */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

/** MongoDB error codes that should not be retried */
const NON_RETRYABLE_ERROR_CODES = new Set([
  2,     // BadValue
  13,    // Unauthorized
  26,    // NamespaceNotFound
  59,    // CommandNotFound
  11000, // DuplicateKey
])

// ============================================================================
// WorkersProxyBackend Implementation
// ============================================================================

/**
 * MondoBackend implementation that proxies to Cloudflare Workers RPC endpoint
 */
export class WorkersProxyBackend implements MondoBackend {
  private endpoint: string
  private authToken?: string
  private timeout: number
  private retries: number
  private retryDelay: number
  private exponentialBackoff: boolean
  private maxRetryDelay: number
  private cursors: Map<bigint, CursorState> = new Map()
  private requestIdCounter = 0

  constructor(options: WorkersProxyBackendOptions) {
    // Validate endpoint
    if (!options.endpoint) {
      throw new Error('WorkersProxyBackend requires an endpoint URL')
    }

    try {
      new URL(options.endpoint)
    } catch {
      throw new Error(`WorkersProxyBackend endpoint is not a valid URL: ${options.endpoint}`)
    }

    this.endpoint = options.endpoint
    if (options.authToken) {
      this.authToken = options.authToken
    }
    this.timeout = options.timeout ?? 30000
    this.retries = options.retries ?? 0
    this.retryDelay = options.retryDelay ?? 1000
    this.exponentialBackoff = options.exponentialBackoff ?? true
    this.maxRetryDelay = options.maxRetryDelay ?? 30000
  }

  /**
   * Generate unique request ID for tracing
   */
  private nextRequestId(): string {
    return `req-${Date.now()}-${++this.requestIdCounter}`
  }

  /**
   * Calculate delay for retry attempt using exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    if (!this.exponentialBackoff) {
      return this.retryDelay
    }
    // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt)
    const jitter = Math.random() * this.retryDelay * 0.5
    return Math.min(exponentialDelay + jitter, this.maxRetryDelay)
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Make an RPC call to the Workers endpoint
   */
  private async rpc<T>(request: RpcRequest, attempt = 0, requestId?: string): Promise<T> {
    const reqId = requestId ?? this.nextRequestId()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': reqId,
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      })

      // Check for HTTP errors
      if (!response.ok && !response.headers.get('Content-Type')?.includes('application/json')) {
        const error = new Error(`HTTP error: ${response.status} ${response.statusText}`)

        // Retry on retryable status codes
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.retries) {
          await this.delay(this.calculateRetryDelay(attempt))
          return this.rpc<T>(request, attempt + 1, reqId)
        }

        throw error
      }

      // Parse response
      let data: RpcResponse
      try {
        data = await response.json() as RpcResponse
      } catch {
        throw new Error('Invalid JSON response from RPC endpoint')
      }

      // Check for RPC errors
      if (data.ok === 0) {
        const error = new MongoProxyError(data.error, data.code, data.codeName)

        // Don't retry non-retryable error codes
        if (NON_RETRYABLE_ERROR_CODES.has(data.code)) {
          throw error
        }

        throw error
      }

      return data.result as T
    } catch (error) {
      // Retry on network errors
      if (
        attempt < this.retries &&
        error instanceof Error &&
        !('code' in error && NON_RETRYABLE_ERROR_CODES.has((error as MongoProxyError).code))
      ) {
        await this.delay(this.calculateRetryDelay(attempt))
        return this.rpc<T>(request, attempt + 1, reqId)
      }

      throw error
    }
  }

  /**
   * Delay for a specified number of milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Convert cursor ID from string to bigint
   */
  private parseCursorId(cursorId: string | bigint): bigint {
    if (typeof cursorId === 'bigint') return cursorId
    return BigInt(cursorId)
  }

  // ==========================================================================
  // Database Operations
  // ==========================================================================

  async listDatabases(): Promise<DatabaseInfo[]> {
    return this.rpc<DatabaseInfo[]>({ method: 'listDatabases' })
  }

  async createDatabase(name: string): Promise<void> {
    await this.rpc<null>({ method: 'createDatabase', db: name })
  }

  async dropDatabase(name: string): Promise<void> {
    await this.rpc<null>({ method: 'dropDatabase', db: name })
  }

  async databaseExists(name: string): Promise<boolean> {
    return this.rpc<boolean>({ method: 'databaseExists', db: name })
  }

  // ==========================================================================
  // Collection Operations
  // ==========================================================================

  async listCollections(db: string, filter?: Document): Promise<CollectionInfo[]> {
    const request: RpcRequest = {
      method: 'listCollections',
      db,
    }
    if (filter) {
      request.filter = filter
    }
    return this.rpc<CollectionInfo[]>(request)
  }

  async createCollection(db: string, name: string, options?: Document): Promise<void> {
    const request: RpcRequest = {
      method: 'createCollection',
      db,
      collection: name,
    }
    if (options) {
      request.options = options
    }
    await this.rpc<null>(request)
  }

  async dropCollection(db: string, name: string): Promise<void> {
    await this.rpc<null>({
      method: 'dropCollection',
      db,
      collection: name,
    })
  }

  async collectionExists(db: string, name: string): Promise<boolean> {
    return this.rpc<boolean>({
      method: 'collectionExists',
      db,
      collection: name,
    })
  }

  async collStats(db: string, collection: string): Promise<CollStats> {
    return this.rpc<CollStats>({
      method: 'collStats',
      db,
      collection,
    })
  }

  async dbStats(db: string): Promise<DbStats> {
    return this.rpc<DbStats>({
      method: 'dbStats',
      db,
    })
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async find(db: string, collection: string, options: FindOptions): Promise<FindResult> {
    const request: RpcRequest = {
      method: 'find',
      db,
      collection,
    }
    if (options.filter) {
      request.filter = options.filter
    }
    const findOptions: Document = {}
    if (options.projection) findOptions.projection = options.projection
    if (options.sort) findOptions.sort = options.sort
    if (options.limit !== undefined) findOptions.limit = options.limit
    if (options.skip !== undefined) findOptions.skip = options.skip
    if (options.batchSize !== undefined) findOptions.batchSize = options.batchSize
    if (options.hint) findOptions.hint = options.hint
    if (options.comment) findOptions.comment = options.comment
    if (options.allowDiskUse !== undefined) findOptions.allowDiskUse = options.allowDiskUse
    if (options.collation) findOptions.collation = options.collation
    if (Object.keys(findOptions).length > 0) {
      request.options = findOptions
    }
    const result = await this.rpc<{
      documents: Document[]
      cursorId: string
      hasMore: boolean
    }>(request)

    return {
      documents: result.documents,
      cursorId: this.parseCursorId(result.cursorId),
      hasMore: result.hasMore,
    }
  }

  async insertOne(db: string, collection: string, doc: Document): Promise<InsertResult> {
    const result = await this.rpc<{
      acknowledged: boolean
      insertedIds: Record<number, unknown>
      insertedCount: number
    }>({
      method: 'insertOne',
      db,
      collection,
      document: doc,
    })

    return {
      acknowledged: result.acknowledged,
      insertedIds: new Map(Object.entries(result.insertedIds).map(([k, v]) => [Number(k), v])),
      insertedCount: result.insertedCount,
    }
  }

  async insertMany(db: string, collection: string, docs: Document[]): Promise<InsertResult> {
    const result = await this.rpc<{
      acknowledged: boolean
      insertedIds: Record<number, unknown>
      insertedCount: number
    }>({
      method: 'insertMany',
      db,
      collection,
      documents: docs,
    })

    return {
      acknowledged: result.acknowledged,
      insertedIds: new Map(Object.entries(result.insertedIds).map(([k, v]) => [Number(k), v])),
      insertedCount: result.insertedCount,
    }
  }

  async updateOne(
    db: string,
    collection: string,
    filter: Document,
    update: Document,
    options?: { upsert?: boolean; arrayFilters?: Document[] }
  ): Promise<UpdateResult> {
    const request: RpcRequest = {
      method: 'updateOne',
      db,
      collection,
      filter,
      update,
    }
    if (options) {
      request.options = options
    }
    return this.rpc<UpdateResult>(request)
  }

  async updateMany(
    db: string,
    collection: string,
    filter: Document,
    update: Document,
    options?: { upsert?: boolean; arrayFilters?: Document[] }
  ): Promise<UpdateResult> {
    const request: RpcRequest = {
      method: 'updateMany',
      db,
      collection,
      filter,
      update,
    }
    if (options) {
      request.options = options
    }
    return this.rpc<UpdateResult>(request)
  }

  async deleteOne(db: string, collection: string, filter: Document): Promise<DeleteResult> {
    return this.rpc<DeleteResult>({
      method: 'deleteOne',
      db,
      collection,
      filter,
    })
  }

  async deleteMany(db: string, collection: string, filter: Document): Promise<DeleteResult> {
    return this.rpc<DeleteResult>({
      method: 'deleteMany',
      db,
      collection,
      filter,
    })
  }

  // ==========================================================================
  // Count and Distinct
  // ==========================================================================

  async count(db: string, collection: string, query?: Document): Promise<number> {
    const request: RpcRequest = {
      method: 'count',
      db,
      collection,
    }
    if (query) {
      request.query = query
    }
    return this.rpc<number>(request)
  }

  async distinct(db: string, collection: string, field: string, query?: Document): Promise<unknown[]> {
    const request: RpcRequest = {
      method: 'distinct',
      db,
      collection,
      field,
    }
    if (query) {
      request.query = query
    }
    return this.rpc<unknown[]>(request)
  }

  // ==========================================================================
  // Aggregation
  // ==========================================================================

  async aggregate(
    db: string,
    collection: string,
    pipeline: Document[],
    options?: { batchSize?: number; allowDiskUse?: boolean }
  ): Promise<AggregateResult> {
    const request: RpcRequest = {
      method: 'aggregate',
      db,
      collection,
      pipeline,
    }
    if (options) {
      request.options = options
    }
    const result = await this.rpc<{
      documents: Document[]
      cursorId: string
      hasMore: boolean
    }>(request)

    return {
      documents: result.documents,
      cursorId: this.parseCursorId(result.cursorId),
      hasMore: result.hasMore,
    }
  }

  // ==========================================================================
  // Index Operations
  // ==========================================================================

  async listIndexes(db: string, collection: string): Promise<IndexInfo[]> {
    return this.rpc<IndexInfo[]>({
      method: 'listIndexes',
      db,
      collection,
    })
  }

  async createIndexes(db: string, collection: string, indexes: IndexSpec[]): Promise<string[]> {
    return this.rpc<string[]>({
      method: 'createIndexes',
      db,
      collection,
      options: { indexes },
    })
  }

  async dropIndex(db: string, collection: string, indexName: string): Promise<void> {
    await this.rpc<null>({
      method: 'dropIndex',
      db,
      collection,
      options: { indexName },
    })
  }

  async dropIndexes(db: string, collection: string): Promise<void> {
    await this.rpc<null>({
      method: 'dropIndexes',
      db,
      collection,
    })
  }

  // ==========================================================================
  // Cursor Management
  // ==========================================================================

  createCursor(state: CursorState): void {
    this.cursors.set(state.id, state)
  }

  getCursor(id: bigint): CursorState | undefined {
    return this.cursors.get(id)
  }

  advanceCursor(id: bigint, count: number): Document[] {
    const cursor = this.cursors.get(id)
    if (!cursor) {
      return []
    }

    const start = cursor.position
    const end = Math.min(start + count, cursor.documents.length)
    cursor.position = end

    return cursor.documents.slice(start, end)
  }

  closeCursor(id: bigint): boolean {
    return this.cursors.delete(id)
  }

  cleanupExpiredCursors(): void {
    const now = Date.now()
    for (const [id, cursor] of this.cursors) {
      if (now - cursor.createdAt > CURSOR_TIMEOUT_MS) {
        this.cursors.delete(id)
      }
    }
  }
}
