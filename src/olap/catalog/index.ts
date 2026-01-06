/**
 * R2 Data Catalog Module
 *
 * This module provides functionality for managing Cloudflare R2 Data Catalogs
 * with Apache Iceberg table format support.
 *
 * @example
 * ```typescript
 * import { createR2CatalogClient, createTable, createMaintenanceClient } from './catalog'
 *
 * // Create a catalog client
 * const client = await createR2CatalogClient({
 *   accountId: 'my-account',
 *   bucketName: 'my-bucket',
 *   apiToken: 'my-token',
 * })
 *
 * // Enable the catalog
 * await client.enableCatalog({ defaultNamespace: 'default' })
 *
 * // Create a table
 * const table = await createTable(client, 'default', 'events', {
 *   schema: [
 *     { name: 'id', type: 'string', required: true },
 *     { name: 'timestamp', type: 'timestamptz', required: true },
 *     { name: 'data', type: 'string', required: false },
 *   ],
 *   partitionSpec: [
 *     { sourceId: 2, name: 'event_day', transform: 'day' },
 *   ],
 * })
 *
 * // Configure maintenance
 * const maintenance = createMaintenanceClient(client)
 * await maintenance.enableCompaction('default.events', {
 *   targetFileSizeBytes: 512 * 1024 * 1024,
 * })
 * ```
 */

// Client exports
export { R2CatalogClient, createR2CatalogClient } from './client'

// Table management exports
export {
  IcebergTableClient,
  createTable,
  getTable,
  deleteTable,
} from './table'

// Maintenance exports
export { MaintenanceClient, createMaintenanceClient } from './maintenance'

// Schema evolution exports
export {
  SchemaEvolutionManager,
  createSchemaEvolutionManager,
  mongoTypeToIceberg,
  isValidTypeWidening,
  computeSchemaDiff,
  type SchemaEvolutionConfig,
  type SchemaEvolutionEvent,
  type FieldDiff,
} from './evolution'

// Compaction management exports
export {
  CompactionManager,
  createCompactionManager,
  type AutoCompactionConfig,
  type CompactionJob,
  type CompactionStatus,
  type TargetSizePreset,
  type CompactionSchedule,
} from './compaction'

// Multi-table strategy exports
export {
  MultiTableStrategyManager,
  createMultiTableStrategyManager,
  type TableMaintenancePolicy,
  type MultiTableStrategyConfig,
  type TableHealth,
  type StrategyExecutionStatus,
  type MaintenancePriority,
  type MaintenanceOrderStrategy,
} from './strategy'

// Schema exports
export {
  MONDODB_CDC_SCHEMA,
  MONDODB_CDC_PARTITION_SPEC,
  MONDODB_METRICS_SCHEMA,
  MONDODB_METRICS_PARTITION_SPEC,
  MONDODB_CACHE_SCHEMA,
  MONDODB_CACHE_PARTITION_SPEC,
  DEFAULT_TABLE_PROPERTIES,
  HIGH_WRITE_TABLE_PROPERTIES,
  READ_OPTIMIZED_TABLE_PROPERTIES,
  getSchemaConfig,
} from './schema'

// Type exports
export {
  // Catalog types
  type R2CatalogConfig,
  type R2DataCatalog,
  type CatalogNamespace,
  type CatalogTableSummary,
  type EnableCatalogOptions,
  type ListNamespacesOptions,
  type ListTablesOptions,
  type PaginatedResult,
  // Iceberg table types
  type IcebergField,
  type IcebergSchema,
  type PartitionField,
  type PartitionSpec,
  type IcebergSnapshot,
  type IcebergTableMetadata,
  type CreateTableOptions,
  type SchemaEvolution,
  // Maintenance types
  type CompactionConfig,
  type SnapshotExpirationConfig,
  type OrphanCleanupConfig,
  type RetentionPolicy,
  type MaintenanceConfig,
  type MaintenanceTaskStatus,
  // Error class
  CatalogError,
} from './types'
