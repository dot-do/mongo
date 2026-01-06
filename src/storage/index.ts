/**
 * Storage Module - Unified storage abstractions
 *
 * This module provides a consistent interface for different storage backends:
 * - Document storage (MongoDB-compatible CRUD operations)
 * - Vector storage (embedding similarity search)
 *
 * Supported backends:
 * - libSQL (local development, native vector search)
 * - Cloudflare D1 (production document storage)
 * - Cloudflare Vectorize (production vector storage)
 */

// Document storage types
export type {
  Document,
  Filter,
  FindOptions,
  UpdateOperators,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  StorageAdapter,
} from './types'

// Vector storage types
export type {
  VectorSearchOptions,
  VectorMatch,
  VectorStorageAdapter,
} from './vector-types'

// Adapters
export { VectorizeStorageAdapter, createVectorizeAdapter } from './vectorize/adapter'

// Type guards
export {
  isStorageAdapter,
  isVectorStorageAdapter,
  isVectorMatch,
  isDocument,
} from './guards'

// Validation helpers
export {
  validateVector,
  validateDocumentId,
  validateCollectionName,
} from './validation'
