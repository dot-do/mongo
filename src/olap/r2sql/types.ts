/**
 * R2 SQL Query Engine Types
 *
 * Type definitions for translating MongoDB aggregation pipelines to SQL
 * and executing queries against Iceberg tables in R2.
 */

// =============================================================================
// Pipeline Stage Types
// =============================================================================

/**
 * MongoDB aggregation pipeline stage types
 */
export type PipelineStage =
  | { $match: Record<string, unknown> }
  | { $group: { _id: unknown; [key: string]: unknown } }
  | { $project: Record<string, 0 | 1 | unknown> }
  | { $sort: Record<string, 1 | -1> }
  | { $limit: number }
  | { $skip: number }
  | { $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean } }
  | { $lookup: { from: string; localField: string; foreignField: string; as: string } }
  | { $count: string }
  | { $addFields: Record<string, unknown> }

// =============================================================================
// Translation Types
// =============================================================================

/**
 * Translation options
 */
export interface TranslationOptions {
  /** Table name in R2 */
  tableName: string
  /** Namespace (schema) name */
  namespace?: string
  /** Partition columns for automatic filtering */
  partitionColumns?: string[]
  /** Maximum query complexity allowed */
  maxComplexity?: number
  /** Enable query optimization */
  optimize?: boolean
}

/**
 * Translated SQL query
 */
export interface TranslatedQuery {
  /** The SQL query string */
  sql: string
  /** Parameter values for prepared statement */
  parameters: unknown[]
  /** Estimated query complexity */
  complexity: number
  /** Warning messages (e.g., for potentially slow queries) */
  warnings: string[]
  /** Original pipeline for reference */
  originalPipeline: PipelineStage[]
}

/**
 * Translation error
 */
export interface TranslationError {
  /** Error code */
  code: string
  /** Human-readable message */
  message: string
  /** Stage index where error occurred */
  stageIndex?: number
  /** The problematic stage */
  stage?: PipelineStage
}

/**
 * Result of translation attempt
 */
export type TranslationResult =
  | { success: true; query: TranslatedQuery }
  | { success: false; error: TranslationError }

// =============================================================================
// Client Types
// =============================================================================

/**
 * R2 SQL client configuration options
 */
export interface R2SQLClientOptions {
  /** Database endpoint URL */
  endpoint: string
  /** Authentication credentials */
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
  /** Maximum number of connections in pool */
  maxConnections?: number
  /** Default query timeout in milliseconds */
  queryTimeout?: number
  /** Cache configuration */
  cache?: {
    enabled: boolean
    ttl?: number
    maxSize?: number
  }
}

/**
 * Query execution options
 */
export interface QueryOptions {
  /** Query timeout override */
  timeout?: number
  /** Maximum rows to return */
  maxRows?: number
  /** Row offset for pagination */
  offset?: number
  /** Whether to use cache */
  cache?: boolean
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Query result
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]
  /** Number of rows returned */
  rowCount: number
  /** Whether more rows exist */
  hasMore: boolean
  /** Query identifier */
  queryId: string
  /** Execution time in milliseconds */
  executionTime: number
  /** Bytes scanned (if available) */
  bytesScanned?: number
}

/**
 * Query status
 */
export interface QueryStatus {
  /** Current status */
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  /** Progress percentage (0-100) */
  progress?: number
}

/**
 * Execute result for write operations
 */
export interface ExecuteResult {
  /** Whether execution succeeded */
  success: boolean
  /** Number of rows affected */
  rowsAffected: number
}

// =============================================================================
// Mapper Types
// =============================================================================

/**
 * Result mapper options
 */
export interface MapperOptions {
  /** Preserve _id field as-is */
  preserveUnderscoreId?: boolean
  /** Fields to convert to Date objects */
  dateFields?: string[]
  /** Fields that should be arrays */
  arrayFields?: string[]
  /** Separator for nested field names (default: '__') */
  nestedFieldSeparator?: string
  /** Convert snake_case to camelCase */
  snakeToCamel?: boolean
  /** Custom field mappings */
  fieldMappings?: FieldMapping[]
}

/**
 * Custom field mapping definition
 */
export interface FieldMapping {
  /** SQL column name */
  sqlColumn: string
  /** MongoDB field name */
  mongoField: string
  /** Type coercion */
  type?: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
  /** Whether field is nested */
  nested?: boolean
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * R2 SQL error
 */
export class R2SQLError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'R2SQLError'
  }
}
