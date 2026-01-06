/**
 * R2 Data Catalog Type Definitions
 *
 * Types for Cloudflare R2 Data Catalog management including:
 * - Catalog configuration and metadata
 * - Namespace management
 * - Table listing and discovery
 * - Iceberg table operations
 * - Maintenance configuration
 */

// =============================================================================
// Catalog Types
// =============================================================================

/**
 * R2 Catalog configuration options
 */
export interface R2CatalogConfig {
  /** Account ID for the Cloudflare account */
  accountId: string
  /** Bucket name where the catalog is stored */
  bucketName: string
  /** Optional API token for authentication */
  apiToken?: string
  /** Optional region for R2 bucket */
  region?: string
  /** Connection timeout in milliseconds */
  connectionTimeout?: number
}

/**
 * Represents an R2 Data Catalog
 */
export interface R2DataCatalog {
  /** Catalog name */
  name: string
  /** R2 bucket name */
  bucket: string
  /** Whether the catalog is enabled */
  enabled: boolean
  /** Catalog location (R2 path) */
  location: string
  /** Creation timestamp */
  createdAt: Date
  /** Last updated timestamp */
  updatedAt?: Date
  /** Number of namespaces in the catalog */
  namespaceCount?: number
  /** Number of tables in the catalog */
  tableCount?: number
}

/**
 * Represents a namespace (schema) in the catalog
 */
export interface CatalogNamespace {
  /** Namespace name */
  name: string
  /** Full path in R2 */
  location: string
  /** Number of tables in this namespace */
  tableCount: number
  /** Creation timestamp */
  createdAt: Date
  /** Namespace properties */
  properties?: Record<string, string>
}

/**
 * Table summary returned when listing tables
 */
export interface CatalogTableSummary {
  /** Table name */
  name: string
  /** Namespace containing this table */
  namespace: string
  /** Table type (iceberg, etc.) */
  type: string
  /** Table location in R2 */
  location: string
  /** Current snapshot ID */
  currentSnapshotId?: string
}

/**
 * Options for enabling catalog on a bucket
 */
export interface EnableCatalogOptions {
  /** Catalog name (defaults to bucket name) */
  catalogName?: string
  /** Initial namespace to create */
  defaultNamespace?: string
  /** Metadata location within bucket */
  metadataLocation?: string
}

/**
 * Options for listing namespaces
 */
export interface ListNamespacesOptions {
  /** Maximum number of namespaces to return */
  limit?: number
  /** Continuation token for pagination */
  cursor?: string
  /** Filter by namespace prefix */
  prefix?: string
}

/**
 * Options for listing tables
 */
export interface ListTablesOptions {
  /** Namespace to list tables from */
  namespace: string
  /** Maximum number of tables to return */
  limit?: number
  /** Continuation token for pagination */
  cursor?: string
  /** Filter by table prefix */
  prefix?: string
}

/**
 * Result of a paginated list operation
 */
export interface PaginatedResult<T> {
  items: T[]
  cursor?: string
  hasMore: boolean
}

// =============================================================================
// Iceberg Table Types
// =============================================================================

/**
 * Iceberg field/column definition
 */
export interface IcebergField {
  /** Field ID (auto-assigned) */
  id: number
  /** Field name */
  name: string
  /** Data type (string, long, double, timestamp, etc.) */
  type: string
  /** Whether the field is required */
  required: boolean
  /** Optional documentation */
  doc?: string
}

/**
 * Iceberg table schema
 */
export interface IcebergSchema {
  /** Schema ID */
  schemaId: number
  /** List of fields */
  fields: IcebergField[]
  /** Optional identifier field IDs */
  identifierFieldIds?: number[]
}

/**
 * Partition field definition
 */
export interface PartitionField {
  /** Source field ID */
  sourceId: number
  /** Partition field ID */
  fieldId: number
  /** Partition name */
  name: string
  /** Transform type (identity, bucket, truncate, year, month, day, hour) */
  transform: string
}

/**
 * Partition specification
 */
export interface PartitionSpec {
  /** Spec ID */
  specId: number
  /** List of partition fields */
  fields: PartitionField[]
}

/**
 * Table snapshot
 */
export interface IcebergSnapshot {
  /** Snapshot ID */
  snapshotId: string
  /** Timestamp when snapshot was created */
  timestampMs: number
  /** Parent snapshot ID */
  parentSnapshotId?: string
  /** Operation that created snapshot (append, overwrite, delete) */
  operation: string
  /** Summary statistics */
  summary: {
    operation: string
    'added-records'?: string
    'deleted-records'?: string
    'added-files'?: string
    'deleted-files'?: string
    'total-records': string
    'total-files': string
    'total-data-files': string
    'total-delete-files': string
  }
  /** Manifest list location */
  manifestList: string
}

/**
 * Full Iceberg table metadata
 */
export interface IcebergTableMetadata {
  /** Table name */
  name: string
  /** Namespace */
  namespace: string
  /** Table UUID */
  uuid: string
  /** Table location in R2 */
  location: string
  /** Current schema */
  currentSchema: IcebergSchema
  /** All schema versions */
  schemas: IcebergSchema[]
  /** Current partition spec */
  currentPartitionSpec: PartitionSpec
  /** All partition specs */
  partitionSpecs: PartitionSpec[]
  /** Current snapshot ID */
  currentSnapshotId?: string
  /** List of snapshots */
  snapshots: IcebergSnapshot[]
  /** Table properties */
  properties: Record<string, string>
  /** Creation timestamp */
  createdAt: Date
  /** Last updated timestamp */
  updatedAt: Date
}

/**
 * Options for creating a table
 */
export interface CreateTableOptions {
  /** Schema definition */
  schema: Omit<IcebergField, 'id'>[]
  /** Optional partition spec */
  partitionSpec?: Omit<PartitionField, 'fieldId'>[]
  /** Optional table properties */
  properties?: Record<string, string>
  /** Optional identifier fields (for upsert support) */
  identifierFields?: string[]
}

/**
 * Schema evolution operation
 */
export interface SchemaEvolution {
  /** Add a new column */
  addColumn?: {
    name: string
    type: string
    required?: boolean
    doc?: string
    after?: string
  }
  /** Rename a column */
  renameColumn?: {
    from: string
    to: string
  }
  /** Drop a column */
  dropColumn?: {
    name: string
  }
  /** Update column type (only widening allowed) */
  updateColumnType?: {
    name: string
    newType: string
  }
  /** Update column documentation */
  updateColumnDoc?: {
    name: string
    doc: string
  }
  /** Make column optional */
  makeColumnOptional?: {
    name: string
  }
}

// =============================================================================
// Maintenance Types
// =============================================================================

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /** Enable automatic compaction */
  enabled: boolean
  /** Target file size in bytes (default: 512MB) */
  targetFileSizeBytes?: number
  /** Minimum number of files to trigger compaction */
  minFilesToCompact?: number
  /** Maximum number of files per compaction task */
  maxFilesPerTask?: number
  /** Minimum time between compaction runs (seconds) */
  minCompactionIntervalSeconds?: number
  /** Strategy: 'binpack' or 'sort' */
  strategy?: 'binpack' | 'sort'
  /** Sort order for 'sort' strategy */
  sortOrder?: Array<{ field: string; direction: 'asc' | 'desc' }>
}

/**
 * Snapshot expiration configuration
 */
export interface SnapshotExpirationConfig {
  /** Enable automatic snapshot expiration */
  enabled: boolean
  /** Maximum age of snapshots to retain (seconds) */
  maxSnapshotAgeSeconds?: number
  /** Minimum number of snapshots to retain */
  minSnapshotsToRetain?: number
  /** Maximum number of snapshots to retain */
  maxSnapshotsToRetain?: number
}

/**
 * Orphan file cleanup configuration
 */
export interface OrphanCleanupConfig {
  /** Enable automatic orphan file cleanup */
  enabled: boolean
  /** Maximum age of orphan files before deletion (seconds) */
  maxOrphanAgeSeconds?: number
  /** File patterns to consider as orphans */
  filePatterns?: string[]
  /** Locations to scan for orphans */
  locations?: string[]
}

/**
 * Data retention policy
 */
export interface RetentionPolicy {
  /** Retention period in days */
  retentionDays: number
  /** Partition column to use for retention (if time-based) */
  partitionColumn?: string
  /** Delete or archive expired data */
  action: 'delete' | 'archive'
  /** Archive location (if action is 'archive') */
  archiveLocation?: string
}

/**
 * Full maintenance configuration for a table
 */
export interface MaintenanceConfig {
  /** Table identifier */
  tableId: string
  /** Compaction settings */
  compaction: CompactionConfig
  /** Snapshot expiration settings */
  snapshotExpiration: SnapshotExpirationConfig
  /** Orphan cleanup settings */
  orphanCleanup: OrphanCleanupConfig
  /** Retention policy */
  retention?: RetentionPolicy
  /** Last maintenance run timestamp */
  lastMaintenanceRun?: Date
  /** Next scheduled maintenance run */
  nextMaintenanceRun?: Date
}

/**
 * Maintenance task status
 */
export interface MaintenanceTaskStatus {
  /** Task ID */
  taskId: string
  /** Task type */
  type: 'compaction' | 'snapshot-expiration' | 'orphan-cleanup' | 'retention'
  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed'
  /** Start time */
  startedAt?: Date
  /** Completion time */
  completedAt?: Date
  /** Error message if failed */
  error?: string
  /** Task metrics */
  metrics?: {
    filesProcessed?: number
    bytesProcessed?: number
    snapshotsExpired?: number
    orphansDeleted?: number
  }
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when catalog operations fail
 */
export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'CatalogError'
  }
}
