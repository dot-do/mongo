/**
 * Common types for mongo.do
 *
 * This module re-exports all public types for the mongo.do library.
 */

export { ObjectId, default as ObjectIdDefault } from './objectid'

// Environment and binding types
export type { Env } from './env'
export type {
  VectorizeMetadataValue,
  VectorizeMetadata,
  VectorizeVector,
  VectorizeQueryOptions,
  VectorizeMatch,
  VectorizeQueryResult,
  VectorizeMutationResult,
  VectorizeIndex,
  Ai,
  EmbeddingResult,
} from './vectorize'
export type {
  FunctionSpec,
  FunctionDefinition,
  FunctionContext,
  FunctionResult,
  FunctionExpression,
} from './function'

// Re-export RPC types (consolidated)
export {
  // Cloudflare types
  type DurableObjectNamespace,
  type DurableObjectId,
  type DurableObjectStub,
  // Environment types
  type MondoEnv,
  // Worker loader types
  type WorkerLoader,
  type WorkerCode,
  type WorkerStub,
  type WorkerEntrypoint,
  // JSON-RPC style types
  type RpcRequest,
  type RpcResponse,
  type BatchResponse,
  // HTTP RPC types
  type HttpRpcRequest,
  type HttpRpcSuccessResponse,
  type HttpRpcErrorResponse,
  type HttpRpcResponse,
  // Legacy RPC types
  MessageType,
  type LegacyRpcRequest,
  type LegacyRpcResponse,
  // Database reference types
  type DatabaseRef,
  type CollectionRef,
  // Batched executor types
  type BatchedExecutorOptions,
  type PipelineOp,
  // RPC client types
  type RpcClientOptions,
  type DeduplicatorOptions,
  type EventHandler,
  type ReconnectEvent,
  // RPC handler types
  type RpcHandler,
  // Error codes
  ErrorCode,
  type ErrorCodeValue,
  getErrorCodeName,
  // Response helpers
  successResponse,
  errorResponse,
  legacySuccessResponse,
  legacyErrorResponse,
} from './rpc'

/**
 * Index specification type
 * Keys are field names, values are 1 (ascending), -1 (descending), or 'text' for text indexes
 */
export type IndexSpec = Record<string, 1 | -1 | 'text'>

/**
 * Options for creating an index
 */
export interface CreateIndexOptions {
  /** Name of the index (auto-generated if not provided) */
  name?: string
  /** Create a unique index */
  unique?: boolean
  /** Create a sparse index (only index documents with the field) */
  sparse?: boolean
  /** Create index in background */
  background?: boolean
  /** Partial filter expression for partial indexes */
  partialFilterExpression?: Record<string, unknown>
  /** TTL in seconds for TTL indexes */
  expireAfterSeconds?: number
  /** Weights for text index fields (higher weight = more important) */
  weights?: Record<string, number>
  /** Default language for text index */
  default_language?: string
  /** Field containing document language override */
  language_override?: string
}

/**
 * Result from createIndex operation
 */
export interface CreateIndexResult {
  ok: 1
  numIndexesBefore: number
  numIndexesAfter: number
  createdCollectionAutomatically: boolean
  note?: string
}

/**
 * Index information returned by listIndexes
 */
export interface IndexInfo {
  /** Index name */
  name: string
  /** Index key specification */
  key: IndexSpec
  /** Version (always 2 for SQLite backed indexes) */
  v: number
  /** Whether this is a unique index */
  unique?: boolean
  /** Whether this is a sparse index */
  sparse?: boolean
  /** Partial filter expression */
  partialFilterExpression?: Record<string, unknown>
  /** TTL in seconds */
  expireAfterSeconds?: number
  /** Weights for text index fields */
  weights?: Record<string, number>
  /** Default language for text index */
  default_language?: string
  /** Whether this is a text index */
  textIndexVersion?: number
}

/**
 * Result from dropIndex operation
 */
export interface DropIndexResult {
  ok: 1
  nIndexesWas: number
}

/**
 * Document type - any JSON-serializable object with optional _id
 */
export interface Document {
  _id?: string | import('./objectid').ObjectId
  [key: string]: unknown
}

/**
 * Insert result
 */
export interface InsertOneResult {
  acknowledged: boolean
  insertedId: string
}

/**
 * Insert many result
 */
export interface InsertManyResult {
  acknowledged: boolean
  insertedCount: number
  insertedIds: Record<number, string>
}

/**
 * Delete result
 */
export interface DeleteResult {
  acknowledged: boolean
  deletedCount: number
}

/**
 * Update result
 */
export interface UpdateResult {
  acknowledged: boolean
  matchedCount: number
  modifiedCount: number
  /** Number of documents upserted (only present when upsert: true was used) */
  upsertedCount?: number
  /** ID of the upserted document (only present when a document was upserted) */
  upsertedId?: string
}

/**
 * Find options
 */
export interface FindOptions {
  projection?: Record<string, 0 | 1>
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
}

/**
 * Collection metadata stored in the database
 */
export interface CollectionMetadata {
  id: number
  name: string
  indexes: IndexInfo[]
  createdAt: string
  updatedAt: string
}
