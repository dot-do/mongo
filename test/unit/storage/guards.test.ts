import { describe, it, expect, vi } from 'vitest'
import {
  isDocument,
  isStorageAdapter,
  isVectorStorageAdapter,
  isVectorMatch,
  isVector,
  isFilter,
} from '../../../src/storage/guards'

describe('Storage Type Guards', () => {
  describe('isDocument', () => {
    it('should return true for plain objects', () => {
      expect(isDocument({})).toBe(true)
      expect(isDocument({ _id: '123', name: 'test' })).toBe(true)
      expect(isDocument({ nested: { value: 1 } })).toBe(true)
    })

    it('should return false for non-objects', () => {
      expect(isDocument(null)).toBe(false)
      expect(isDocument(undefined)).toBe(false)
      expect(isDocument('string')).toBe(false)
      expect(isDocument(123)).toBe(false)
      expect(isDocument(true)).toBe(false)
    })

    it('should return false for arrays', () => {
      expect(isDocument([])).toBe(false)
      expect(isDocument([1, 2, 3])).toBe(false)
    })
  })

  describe('isStorageAdapter', () => {
    it('should return true for valid StorageAdapter', () => {
      const adapter = {
        insertOne: vi.fn(),
        insertMany: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
        updateOne: vi.fn(),
        updateMany: vi.fn(),
        deleteOne: vi.fn(),
        deleteMany: vi.fn(),
        countDocuments: vi.fn(),
        close: vi.fn(),
      }
      expect(isStorageAdapter(adapter)).toBe(true)
    })

    it('should return false for incomplete adapter', () => {
      const incomplete = {
        insertOne: vi.fn(),
        findOne: vi.fn(),
        // missing other methods
      }
      expect(isStorageAdapter(incomplete)).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(isStorageAdapter(null)).toBe(false)
      expect(isStorageAdapter(undefined)).toBe(false)
      expect(isStorageAdapter('string')).toBe(false)
    })
  })

  describe('isVectorStorageAdapter', () => {
    it('should return true for valid VectorStorageAdapter', () => {
      const adapter = {
        upsertVector: vi.fn(),
        deleteVector: vi.fn(),
        vectorSearch: vi.fn(),
        isAvailable: vi.fn(),
      }
      expect(isVectorStorageAdapter(adapter)).toBe(true)
    })

    it('should return false for incomplete adapter', () => {
      const incomplete = {
        upsertVector: vi.fn(),
        // missing other methods
      }
      expect(isVectorStorageAdapter(incomplete)).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(isVectorStorageAdapter(null)).toBe(false)
      expect(isVectorStorageAdapter(undefined)).toBe(false)
    })
  })

  describe('isVectorMatch', () => {
    it('should return true for valid VectorMatch', () => {
      expect(isVectorMatch({ documentId: 'doc1', score: 0.95 })).toBe(true)
      expect(isVectorMatch({ documentId: 'doc1', score: 0, metadata: {} })).toBe(true)
      expect(isVectorMatch({ documentId: 'doc1', score: 1 })).toBe(true)
    })

    it('should return false for invalid score', () => {
      expect(isVectorMatch({ documentId: 'doc1', score: 1.5 })).toBe(false)
      expect(isVectorMatch({ documentId: 'doc1', score: -0.1 })).toBe(false)
    })

    it('should return false for missing fields', () => {
      expect(isVectorMatch({ documentId: 'doc1' })).toBe(false)
      expect(isVectorMatch({ score: 0.5 })).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(isVectorMatch(null)).toBe(false)
      expect(isVectorMatch(undefined)).toBe(false)
    })
  })

  describe('isVector', () => {
    it('should return true for valid vectors', () => {
      expect(isVector([0.1, 0.2, 0.3])).toBe(true)
      expect(isVector([0])).toBe(true)
      expect(isVector([-1, 0, 1])).toBe(true)
    })

    it('should return false for empty arrays', () => {
      expect(isVector([])).toBe(false)
    })

    it('should return false for arrays with non-numbers', () => {
      expect(isVector(['string'])).toBe(false)
      expect(isVector([1, 'two', 3])).toBe(false)
      expect(isVector([1, null, 3])).toBe(false)
    })

    it('should return false for arrays with NaN', () => {
      expect(isVector([NaN])).toBe(false)
      expect(isVector([1, NaN, 3])).toBe(false)
    })

    it('should return false for non-arrays', () => {
      expect(isVector(null)).toBe(false)
      expect(isVector(undefined)).toBe(false)
      expect(isVector({})).toBe(false)
    })
  })

  describe('isFilter', () => {
    it('should return true for valid filters', () => {
      expect(isFilter({})).toBe(true)
      expect(isFilter({ name: 'test' })).toBe(true)
      expect(isFilter({ $and: [{ a: 1 }, { b: 2 }] })).toBe(true)
    })

    it('should return false for arrays', () => {
      expect(isFilter([])).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(isFilter(null)).toBe(false)
      expect(isFilter(undefined)).toBe(false)
      expect(isFilter('string')).toBe(false)
    })
  })
})
