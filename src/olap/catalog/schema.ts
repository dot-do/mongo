/**
 * Mondodb Iceberg Schema Definitions
 *
 * Schema definitions for storing mondodb documents in Iceberg tables.
 * These schemas define the structure for CDC events and document storage.
 */

import type { IcebergField, PartitionField } from './types'

/**
 * Schema for mondodb CDC events
 *
 * This schema is used to store change data capture events from mondodb
 * in an Iceberg table format suitable for OLAP queries.
 */
export const MONDODB_CDC_SCHEMA: Omit<IcebergField, 'id'>[] = [
  { name: 'doc_id', type: 'string', required: true, doc: 'Document ID from MongoDB _id' },
  { name: 'collection', type: 'string', required: true, doc: 'Collection name' },
  { name: 'database', type: 'string', required: true, doc: 'Database name' },
  { name: 'data', type: 'string', required: true, doc: 'JSON-encoded document data' },
  { name: 'op', type: 'string', required: true, doc: 'Operation type: insert, update, delete' },
  { name: 'ingested_at', type: 'timestamptz', required: true, doc: 'Ingestion timestamp' },
  { name: 'ts', type: 'long', required: false, doc: 'MongoDB oplog timestamp' },
  { name: 'ns', type: 'string', required: false, doc: 'Full namespace (db.collection)' },
]

/**
 * Default partition specification for CDC events
 *
 * Partitions by collection (identity) and ingestion date (day transform)
 * to optimize query performance for time-series and collection-specific queries.
 */
export const MONDODB_CDC_PARTITION_SPEC: Omit<PartitionField, 'fieldId'>[] = [
  { sourceId: 2, name: 'collection', transform: 'identity' },
  { sourceId: 6, name: 'ingested_day', transform: 'day' },
]

/**
 * Schema for aggregated metrics
 *
 * Used for storing pre-computed aggregations from MongoDB pipelines.
 */
export const MONDODB_METRICS_SCHEMA: Omit<IcebergField, 'id'>[] = [
  { name: 'metric_id', type: 'string', required: true, doc: 'Unique metric identifier' },
  { name: 'collection', type: 'string', required: true, doc: 'Source collection' },
  { name: 'database', type: 'string', required: true, doc: 'Source database' },
  { name: 'pipeline_hash', type: 'string', required: true, doc: 'Hash of aggregation pipeline' },
  { name: 'dimensions', type: 'string', required: true, doc: 'JSON-encoded dimension values' },
  { name: 'measures', type: 'string', required: true, doc: 'JSON-encoded measure values' },
  { name: 'computed_at', type: 'timestamptz', required: true, doc: 'When metric was computed' },
  { name: 'valid_from', type: 'timestamptz', required: false, doc: 'Start of validity period' },
  { name: 'valid_to', type: 'timestamptz', required: false, doc: 'End of validity period' },
]

/**
 * Partition specification for metrics
 */
export const MONDODB_METRICS_PARTITION_SPEC: Omit<PartitionField, 'fieldId'>[] = [
  { sourceId: 2, name: 'collection', transform: 'identity' },
  { sourceId: 4, name: 'pipeline_hash', transform: 'identity' },
  { sourceId: 7, name: 'computed_day', transform: 'day' },
]

/**
 * Schema for query results cache
 *
 * Used for caching expensive query results in Iceberg format.
 */
export const MONDODB_CACHE_SCHEMA: Omit<IcebergField, 'id'>[] = [
  { name: 'cache_key', type: 'string', required: true, doc: 'Cache key hash' },
  { name: 'query_hash', type: 'string', required: true, doc: 'Hash of the query' },
  { name: 'collection', type: 'string', required: true, doc: 'Source collection' },
  { name: 'database', type: 'string', required: true, doc: 'Source database' },
  { name: 'result', type: 'string', required: true, doc: 'JSON-encoded query result' },
  { name: 'row_count', type: 'long', required: true, doc: 'Number of rows in result' },
  { name: 'cached_at', type: 'timestamptz', required: true, doc: 'Cache timestamp' },
  { name: 'expires_at', type: 'timestamptz', required: false, doc: 'Expiration timestamp' },
  { name: 'hits', type: 'long', required: false, doc: 'Number of cache hits' },
]

/**
 * Partition specification for cache
 */
export const MONDODB_CACHE_PARTITION_SPEC: Omit<PartitionField, 'fieldId'>[] = [
  { sourceId: 3, name: 'collection', transform: 'identity' },
  { sourceId: 7, name: 'cached_day', transform: 'day' },
]

/**
 * Default table properties for mondodb Iceberg tables
 */
export const DEFAULT_TABLE_PROPERTIES: Record<string, string> = {
  'write.format.default': 'parquet',
  'write.parquet.compression-codec': 'zstd',
  'write.metadata.compression-codec': 'gzip',
  'write.target-file-size-bytes': String(512 * 1024 * 1024), // 512MB
  'commit.retry.num-retries': '4',
  'commit.manifest-merge.enabled': 'true',
}

/**
 * Properties optimized for high-write workloads (CDC)
 */
export const HIGH_WRITE_TABLE_PROPERTIES: Record<string, string> = {
  ...DEFAULT_TABLE_PROPERTIES,
  'write.target-file-size-bytes': String(256 * 1024 * 1024), // 256MB
  'write.distribution-mode': 'hash',
  'history.expire.max-snapshot-age-ms': String(7 * 24 * 60 * 60 * 1000), // 7 days
  'history.expire.min-snapshots-to-keep': '10',
}

/**
 * Properties optimized for read-heavy workloads (analytics)
 */
export const READ_OPTIMIZED_TABLE_PROPERTIES: Record<string, string> = {
  ...DEFAULT_TABLE_PROPERTIES,
  'write.target-file-size-bytes': String(1024 * 1024 * 1024), // 1GB
  'read.split.target-size': String(128 * 1024 * 1024), // 128MB
  'read.split.open-file-cost': String(4 * 1024 * 1024), // 4MB
}

/**
 * Get schema configuration for a specific mondodb table type
 */
export function getSchemaConfig(type: 'cdc' | 'metrics' | 'cache') {
  switch (type) {
    case 'cdc':
      return {
        schema: MONDODB_CDC_SCHEMA,
        partitionSpec: MONDODB_CDC_PARTITION_SPEC,
        properties: HIGH_WRITE_TABLE_PROPERTIES,
      }
    case 'metrics':
      return {
        schema: MONDODB_METRICS_SCHEMA,
        partitionSpec: MONDODB_METRICS_PARTITION_SPEC,
        properties: READ_OPTIMIZED_TABLE_PROPERTIES,
      }
    case 'cache':
      return {
        schema: MONDODB_CACHE_SCHEMA,
        partitionSpec: MONDODB_CACHE_PARTITION_SPEC,
        properties: DEFAULT_TABLE_PROPERTIES,
      }
  }
}
