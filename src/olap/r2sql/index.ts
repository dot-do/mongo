/**
 * R2 SQL Query Engine Module
 *
 * This module provides functionality for translating MongoDB aggregation
 * pipelines to SQL and executing them against Iceberg tables in R2.
 *
 * @example
 * ```typescript
 * import { createR2SQLTranslator, createR2SQLClient, createResultMapper } from './r2sql'
 *
 * // Create a translator
 * const translator = createR2SQLTranslator()
 *
 * // Translate a MongoDB pipeline to SQL
 * const result = translator.translate(
 *   [
 *     { $match: { status: 'active' } },
 *     { $group: { _id: '$category', total: { $sum: '$amount' } } },
 *     { $sort: { total: -1 } },
 *     { $limit: 10 },
 *   ],
 *   { tableName: 'events', namespace: 'analytics' }
 * )
 *
 * if (result.success) {
 *   console.log(result.query.sql)
 *   // SELECT "category", SUM("amount") AS "total"
 *   // FROM "analytics"."events"
 *   // WHERE "status" = ?
 *   // GROUP BY "category"
 *   // ORDER BY "total" DESC
 *   // LIMIT 10
 * }
 *
 * // Create a client to execute the query
 * const client = createR2SQLClient({
 *   endpoint: 'http://localhost:8123',
 * })
 *
 * const queryResult = await client.query(result.query.sql, result.query.parameters)
 *
 * // Map results back to MongoDB document format
 * const mapper = createResultMapper()
 * const docs = mapper.mapAggregationResult(queryResult.rows)
 * ```
 */

// Translator exports
export { R2SQLTranslator, createR2SQLTranslator } from './translator'

// Client exports
export { R2SQLClient, createR2SQLClient } from './client'

// Mapper exports
export { ResultMapper, createResultMapper } from './mapper'

// Type exports
export {
  // Pipeline types
  type PipelineStage,
  // Translation types
  type TranslationOptions,
  type TranslatedQuery,
  type TranslationError,
  type TranslationResult,
  // Client types
  type R2SQLClientOptions,
  type QueryOptions,
  type QueryResult,
  type QueryStatus,
  type ExecuteResult,
  // Mapper types
  type MapperOptions,
  type FieldMapping,
  // Error class
  R2SQLError,
} from './types'
