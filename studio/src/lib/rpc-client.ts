/**
 * mongo.do RPC Client
 *
 * Provides a type-safe interface for communicating with the mongo.do Durable Object
 * via the RPC endpoint.
 */

/**
 * Error thrown when an RPC request is aborted via AbortController.
 */
export class RpcAbortError extends Error {
  readonly name = 'RpcAbortError'

  constructor(message = 'RPC request was aborted') {
    super(message)
  }
}

/**
 * Options for RPC calls that support cancellation and timeouts.
 */
export interface RpcCallOptions {
  /** AbortSignal to cancel the request */
  signal?: AbortSignal
  /** Timeout in milliseconds (overrides default timeout) */
  timeout?: number
}

/**
 * A cancellable request that provides both the promise and abort controller.
 */
export interface CancellableRequest<T> {
  /** The promise that resolves with the result */
  promise: Promise<T>
  /** The AbortController to cancel the request */
  controller: AbortController
  /** Convenience method to abort the request */
  cancel: () => void
}

export interface RpcRequest {
  id?: string
  method: string
  params: unknown[]
}

export interface RpcResponse<T = unknown> {
  id?: string
  result?: T
  error?: {
    code: number
    message: string
  }
}

export interface RpcBatchResponse<T = unknown> {
  results: RpcResponse<T>[]
}

export interface Document {
  _id: string
  [key: string]: unknown
}

export interface CollectionInfo {
  name: string
  type: 'collection' | 'view'
  options?: Record<string, unknown>
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk?: number
  empty?: boolean
}

export interface IndexInfo {
  name: string
  key: Record<string, 1 | -1 | 'text' | '2dsphere'>
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  /** Size of the index in bytes */
  sizeBytes?: number
  /** Usage statistics for the index */
  usageStats?: IndexUsageStats
}

export interface IndexUsageStats {
  /** Number of times the index was used by queries */
  accesses: number
  /** Number of times queries could have used this index but didn't */
  indexUsed?: boolean
  /** Timestamp of last access */
  lastAccess?: Date
  /** Read operations that used this index */
  readOps?: number
  /** Write operations that updated this index */
  writeOps?: number
}

export interface FindOptions {
  filter?: Record<string, unknown>
  projection?: Record<string, 0 | 1>
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
}

export interface UpdateResult {
  acknowledged: boolean
  matchedCount: number
  modifiedCount: number
  upsertedId?: string
}

export interface DeleteResult {
  acknowledged: boolean
  deletedCount: number
}

export interface InsertOneResult {
  acknowledged: boolean
  insertedId: string
}

export interface InsertManyResult {
  acknowledged: boolean
  insertedIds: string[]
}

/**
 * Configuration options for the RPC client.
 */
export interface RpcClientConfig {
  /** Base URL for RPC calls */
  baseUrl?: string
  /** Default timeout in milliseconds (default: 30000 = 30 seconds) */
  defaultTimeout?: number
}

/** Default timeout for RPC requests: 30 seconds */
const DEFAULT_TIMEOUT = 30000

class RpcClient {
  private baseUrl: string
  private requestId = 0
  private defaultTimeout: number

  constructor(config: RpcClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? ''
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT
  }

  /**
   * Set the base URL for RPC calls.
   * This should be called when establishing a connection.
   */
  setBaseUrl(url: string): void {
    // Remove trailing slash if present for consistency
    this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
  }

  /**
   * Get the current base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * Set the default timeout for RPC calls.
   * @param timeout - Timeout in milliseconds
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout
  }

  /**
   * Get the current default timeout.
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout
  }

  private nextId(): string {
    return String(++this.requestId)
  }

  /**
   * Create an AbortSignal that combines the provided signal with a timeout.
   * Returns the combined signal and a cleanup function.
   */
  private createTimeoutSignal(
    options?: RpcCallOptions
  ): { signal: AbortSignal; cleanup: () => void } {
    const timeout = options?.timeout ?? this.defaultTimeout
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new DOMException('Request timeout', 'TimeoutError'))
      }, timeout)
    }

    // If an external signal is provided, listen for its abort
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason)
      } else {
        options.signal.addEventListener('abort', () => {
          controller.abort(options.signal?.reason)
        })
      }
    }

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }

    return { signal: controller.signal, cleanup }
  }

  /**
   * Make an RPC call with optional cancellation support.
   *
   * @param method - The RPC method to call
   * @param params - Parameters to pass to the method
   * @param options - Optional settings including AbortSignal for cancellation and timeout
   * @throws RpcAbortError if the request is aborted or times out
   */
  async call<T>(
    method: string,
    params: unknown[] = [],
    options?: RpcCallOptions
  ): Promise<T> {
    // Check if already aborted before making the request
    if (options?.signal?.aborted) {
      throw new RpcAbortError()
    }

    const { signal, cleanup } = this.createTimeoutSignal(options)

    try {
      const response = await fetch(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: this.nextId(),
          method,
          params,
        }),
        signal,
      })

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.statusText}`)
      }

      const data: RpcResponse<T> = await response.json()

      if (data.error) {
        throw new Error(data.error.message)
      }

      return data.result as T
    } catch (error) {
      // Convert AbortError/TimeoutError to RpcAbortError for consistent error handling
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new RpcAbortError(error.name === 'TimeoutError' ? 'RPC request timed out' : 'RPC request was aborted')
      }
      throw error
    } finally {
      cleanup()
    }
  }

  /**
   * Create a cancellable RPC call that returns both the promise and a cancel function.
   *
   * @example
   * const { promise, cancel } = rpcClient.callCancellable('find', [db, collection, options])
   * // Later, if needed:
   * cancel()
   */
  callCancellable<T>(
    method: string,
    params: unknown[] = []
  ): CancellableRequest<T> {
    const controller = new AbortController()
    const promise = this.call<T>(method, params, { signal: controller.signal })
    return {
      promise,
      controller,
      cancel: () => controller.abort(),
    }
  }

  /**
   * Make a batch RPC call with optional cancellation support.
   *
   * @param requests - Array of RPC requests to execute
   * @param options - Optional settings including AbortSignal for cancellation and timeout
   * @throws RpcAbortError if the request is aborted or times out
   */
  async batch<T>(
    requests: RpcRequest[],
    options?: RpcCallOptions
  ): Promise<T[]> {
    // Check if already aborted before making the request
    if (options?.signal?.aborted) {
      throw new RpcAbortError()
    }

    const { signal, cleanup } = this.createTimeoutSignal(options)

    try {
      const response = await fetch(`${this.baseUrl}/rpc/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          requests.map((req) => ({
            ...req,
            id: req.id ?? this.nextId(),
          }))
        ),
        signal,
      })

      if (!response.ok) {
        throw new Error(`RPC batch request failed: ${response.statusText}`)
      }

      const data: RpcBatchResponse<T> = await response.json()

      return data.results.map((r) => {
        if (r.error) {
          throw new Error(r.error.message)
        }
        return r.result as T
      })
    } catch (error) {
      // Convert AbortError/TimeoutError to RpcAbortError for consistent error handling
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new RpcAbortError(error.name === 'TimeoutError' ? 'RPC request timed out' : 'RPC request was aborted')
      }
      throw error
    } finally {
      cleanup()
    }
  }

  /**
   * Create a cancellable batch RPC call.
   *
   * @example
   * const { promise, cancel } = rpcClient.batchCancellable([
   *   { method: 'find', params: [db, 'users', {}] },
   *   { method: 'countDocuments', params: [db, 'users', {}] }
   * ])
   * // Later, if needed:
   * cancel()
   */
  batchCancellable<T>(requests: RpcRequest[]): CancellableRequest<T[]> {
    const controller = new AbortController()
    const promise = this.batch<T>(requests, { signal: controller.signal })
    return {
      promise,
      controller,
      cancel: () => controller.abort(),
    }
  }

  // Database operations
  async listDatabases(callOptions?: RpcCallOptions): Promise<DatabaseInfo[]> {
    return this.call<DatabaseInfo[]>('listDatabases', [], callOptions)
  }

  async listCollections(database: string, callOptions?: RpcCallOptions): Promise<CollectionInfo[]> {
    return this.call<CollectionInfo[]>('listCollections', [database], callOptions)
  }

  async createCollection(
    database: string,
    name: string,
    options?: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<void> {
    return this.call<void>('createCollection', [database, name, options], callOptions)
  }

  async dropCollection(database: string, name: string, callOptions?: RpcCallOptions): Promise<void> {
    return this.call<void>('dropCollection', [database, name], callOptions)
  }

  /**
   * Create a new database.
   * MongoDB creates databases lazily when the first collection is created.
   *
   * @param name - The name of the database to create
   * @param initialCollection - Optional initial collection name (defaults to '_init')
   */
  async createDatabase(
    name: string,
    initialCollection?: string
  ): Promise<{ ok: boolean }> {
    // MongoDB creates databases lazily, so we create an initial collection
    const collectionName = initialCollection || '_init'
    await this.createCollection(name, collectionName)
    return { ok: true }
  }

  // Document operations

  /**
   * Find documents matching the query.
   * Supports cancellation via AbortSignal.
   */
  async find(
    database: string,
    collection: string,
    options: FindOptions = {},
    callOptions?: RpcCallOptions
  ): Promise<Document[]> {
    return this.call<Document[]>(
      'find',
      [database, collection, options],
      callOptions
    )
  }

  /**
   * Create a cancellable find operation.
   * Returns both the promise and a cancel function.
   */
  findCancellable(
    database: string,
    collection: string,
    options: FindOptions = {}
  ): CancellableRequest<Document[]> {
    return this.callCancellable<Document[]>('find', [
      database,
      collection,
      options,
    ])
  }

  async findOne(
    database: string,
    collection: string,
    filter: Record<string, unknown> = {},
    callOptions?: RpcCallOptions
  ): Promise<Document | null> {
    return this.call<Document | null>(
      'findOne',
      [database, collection, filter],
      callOptions
    )
  }

  async insertOne(
    database: string,
    collection: string,
    document: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<InsertOneResult> {
    return this.call<InsertOneResult>(
      'insertOne',
      [database, collection, document],
      callOptions
    )
  }

  async insertMany(
    database: string,
    collection: string,
    documents: Record<string, unknown>[],
    callOptions?: RpcCallOptions
  ): Promise<InsertManyResult> {
    return this.call<InsertManyResult>(
      'insertMany',
      [database, collection, documents],
      callOptions
    )
  }

  async updateOne(
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<UpdateResult> {
    return this.call<UpdateResult>(
      'updateOne',
      [database, collection, filter, update],
      callOptions
    )
  }

  async updateMany(
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<UpdateResult> {
    return this.call<UpdateResult>(
      'updateMany',
      [database, collection, filter, update],
      callOptions
    )
  }

  async deleteOne(
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<DeleteResult> {
    return this.call<DeleteResult>(
      'deleteOne',
      [database, collection, filter],
      callOptions
    )
  }

  async deleteMany(
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<DeleteResult> {
    return this.call<DeleteResult>(
      'deleteMany',
      [database, collection, filter],
      callOptions
    )
  }

  /**
   * Count documents matching the filter.
   * Supports cancellation via AbortSignal.
   */
  async countDocuments(
    database: string,
    collection: string,
    filter: Record<string, unknown> = {},
    callOptions?: RpcCallOptions
  ): Promise<number> {
    return this.call<number>(
      'countDocuments',
      [database, collection, filter],
      callOptions
    )
  }

  /**
   * Run an aggregation pipeline.
   * Supports cancellation via AbortSignal.
   */
  async aggregate(
    database: string,
    collection: string,
    pipeline: Record<string, unknown>[],
    callOptions?: RpcCallOptions
  ): Promise<Document[]> {
    return this.call<Document[]>(
      'aggregate',
      [database, collection, pipeline],
      callOptions
    )
  }

  /**
   * Create a cancellable aggregation operation.
   * Returns both the promise and a cancel function.
   */
  aggregateCancellable(
    database: string,
    collection: string,
    pipeline: Record<string, unknown>[]
  ): CancellableRequest<Document[]> {
    return this.callCancellable<Document[]>('aggregate', [
      database,
      collection,
      pipeline,
    ])
  }

  // Index operations
  async listIndexes(
    database: string,
    collection: string,
    callOptions?: RpcCallOptions
  ): Promise<IndexInfo[]> {
    return this.call<IndexInfo[]>('listIndexes', [database, collection], callOptions)
  }

  async createIndex(
    database: string,
    collection: string,
    keys: Record<string, 1 | -1 | 'text' | '2dsphere'>,
    options?: Record<string, unknown>,
    callOptions?: RpcCallOptions
  ): Promise<string> {
    return this.call<string>('createIndex', [
      database,
      collection,
      keys,
      options,
    ], callOptions)
  }

  async dropIndex(
    database: string,
    collection: string,
    indexName: string,
    callOptions?: RpcCallOptions
  ): Promise<void> {
    return this.call<void>('dropIndex', [database, collection, indexName], callOptions)
  }

  // Health check
  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/api/health`)
    if (!response.ok) {
      throw new Error('Health check failed')
    }
    return response.json()
  }
}

export const rpcClient = new RpcClient()
export default rpcClient
