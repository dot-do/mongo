/**
 * Type Guards for Storage Module
 *
 * Runtime type checking functions for storage interfaces.
 * These are useful for validating data at system boundaries.
 */

import type { StorageAdapter } from './types'
import type { VectorStorageAdapter, VectorMatch } from './vector-types'

/**
 * Check if a value is a valid Document (has optional _id and is object)
 */
export function isDocument(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

/**
 * Check if a value implements StorageAdapter interface
 */
export function isStorageAdapter(value: unknown): value is StorageAdapter {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const adapter = value as Record<string, unknown>

  return (
    typeof adapter.insertOne === 'function' &&
    typeof adapter.findOne === 'function' &&
    typeof adapter.find === 'function' &&
    typeof adapter.updateOne === 'function' &&
    typeof adapter.deleteOne === 'function' &&
    typeof adapter.close === 'function'
  )
}

/**
 * Check if a value implements VectorStorageAdapter interface
 */
export function isVectorStorageAdapter(value: unknown): value is VectorStorageAdapter {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const adapter = value as Record<string, unknown>

  return (
    typeof adapter.upsertVector === 'function' &&
    typeof adapter.deleteVector === 'function' &&
    typeof adapter.vectorSearch === 'function' &&
    typeof adapter.isAvailable === 'function'
  )
}

/**
 * Check if a value is a valid VectorMatch result
 */
export function isVectorMatch(value: unknown): value is VectorMatch {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const match = value as Record<string, unknown>

  return (
    typeof match.documentId === 'string' &&
    typeof match.score === 'number' &&
    match.score >= 0 &&
    match.score <= 1
  )
}

/**
 * Check if a value is a valid embedding vector
 */
export function isVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'number' && !Number.isNaN(v))
  )
}

/**
 * Check if a value is a valid Filter object
 */
export function isFilter(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}
