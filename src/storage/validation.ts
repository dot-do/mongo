/**
 * Validation Helpers for Storage Module
 *
 * Functions to validate input data before storage operations.
 */

/**
 * Default embedding dimensions for common models
 */
export const EMBEDDING_DIMENSIONS = {
  'bge-m3': 1024,
  'bge-base-en-v1.5': 768,
  'bge-large-en-v1.5': 1024,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
} as const

/**
 * Validate that a value is a valid embedding vector
 *
 * @param vector - The value to validate
 * @param expectedDimensions - Optional expected dimension count
 * @returns The validated vector
 * @throws TypeError if validation fails
 */
export function validateVector(
  vector: unknown,
  expectedDimensions?: number
): number[] {
  if (!Array.isArray(vector)) {
    throw new TypeError('Vector must be an array')
  }

  if (vector.length === 0) {
    throw new TypeError('Vector cannot be empty')
  }

  for (let i = 0; i < vector.length; i++) {
    const value = vector[i]
    if (typeof value !== 'number') {
      throw new TypeError(`Vector value at index ${i} must be a number, got ${typeof value}`)
    }
    if (Number.isNaN(value)) {
      throw new TypeError(`Vector value at index ${i} is NaN`)
    }
    if (!Number.isFinite(value)) {
      throw new TypeError(`Vector value at index ${i} must be finite`)
    }
  }

  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) {
    throw new Error(
      `Vector has ${vector.length} dimensions, expected ${expectedDimensions}`
    )
  }

  return vector as number[]
}

/**
 * Validate a document ID
 *
 * @param documentId - The document ID to validate
 * @returns The validated document ID
 * @throws TypeError if validation fails
 */
export function validateDocumentId(documentId: unknown): string {
  if (typeof documentId !== 'string') {
    throw new TypeError(`Document ID must be a string, got ${typeof documentId}`)
  }

  if (documentId.length === 0) {
    throw new TypeError('Document ID cannot be empty')
  }

  if (documentId.length > 1024) {
    throw new TypeError('Document ID exceeds maximum length of 1024 characters')
  }

  // Check for invalid characters (colons are reserved for internal use)
  if (documentId.includes(':')) {
    throw new TypeError('Document ID cannot contain colons (:)')
  }

  return documentId
}

/**
 * Validate a collection name
 *
 * @param collectionName - The collection name to validate
 * @returns The validated collection name
 * @throws TypeError if validation fails
 */
export function validateCollectionName(collectionName: unknown): string {
  if (typeof collectionName !== 'string') {
    throw new TypeError(`Collection name must be a string, got ${typeof collectionName}`)
  }

  if (collectionName.length === 0) {
    throw new TypeError('Collection name cannot be empty')
  }

  if (collectionName.length > 128) {
    throw new TypeError('Collection name exceeds maximum length of 128 characters')
  }

  // MongoDB collection name rules
  if (collectionName.startsWith('system.')) {
    throw new TypeError('Collection name cannot start with "system."')
  }

  if (collectionName.includes('$')) {
    throw new TypeError('Collection name cannot contain "$"')
  }

  if (collectionName.includes('\0')) {
    throw new TypeError('Collection name cannot contain null characters')
  }

  return collectionName
}

/**
 * Validate a similarity score (0-1 range)
 *
 * @param score - The score to validate
 * @returns The validated score
 * @throws TypeError if validation fails
 */
export function validateScore(score: unknown): number {
  if (typeof score !== 'number') {
    throw new TypeError(`Score must be a number, got ${typeof score}`)
  }

  if (Number.isNaN(score)) {
    throw new TypeError('Score cannot be NaN')
  }

  if (score < 0 || score > 1) {
    throw new TypeError(`Score must be between 0 and 1, got ${score}`)
  }

  return score
}

/**
 * Validate search options
 *
 * @param options - The options to validate
 * @returns The validated options
 */
export function validateSearchOptions(
  options: unknown
): { limit: number; filter?: Record<string, unknown> } {
  if (options === undefined || options === null) {
    return { limit: 10 }
  }

  if (typeof options !== 'object') {
    throw new TypeError('Search options must be an object')
  }

  const opts = options as Record<string, unknown>
  const result: { limit: number; filter?: Record<string, unknown> } = { limit: 10 }

  if ('limit' in opts) {
    if (typeof opts.limit !== 'number' || opts.limit < 1) {
      throw new TypeError('Search limit must be a positive number')
    }
    result.limit = opts.limit
  }

  if ('filter' in opts && opts.filter !== undefined) {
    if (typeof opts.filter !== 'object' || opts.filter === null) {
      throw new TypeError('Search filter must be an object')
    }
    result.filter = opts.filter as Record<string, unknown>
  }

  return result
}
