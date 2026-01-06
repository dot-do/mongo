import { describe, it, expect } from 'vitest'
import {
  validateVector,
  validateDocumentId,
  validateCollectionName,
  validateScore,
  validateSearchOptions,
  EMBEDDING_DIMENSIONS,
} from '../../../src/storage/validation'

describe('Storage Validation', () => {
  describe('validateVector', () => {
    it('should accept valid vectors', () => {
      expect(validateVector([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3])
      expect(validateVector([0])).toEqual([0])
      expect(validateVector([-1, 0, 1])).toEqual([-1, 0, 1])
    })

    it('should reject non-arrays', () => {
      expect(() => validateVector(null)).toThrow('must be an array')
      expect(() => validateVector(undefined)).toThrow('must be an array')
      expect(() => validateVector('string')).toThrow('must be an array')
      expect(() => validateVector({})).toThrow('must be an array')
    })

    it('should reject empty arrays', () => {
      expect(() => validateVector([])).toThrow('cannot be empty')
    })

    it('should reject arrays with non-numbers', () => {
      expect(() => validateVector(['string'])).toThrow('must be a number')
      expect(() => validateVector([1, 'two', 3])).toThrow('must be a number')
    })

    it('should reject NaN values', () => {
      expect(() => validateVector([NaN])).toThrow('is NaN')
      expect(() => validateVector([1, NaN, 3])).toThrow('is NaN')
    })

    it('should reject infinite values', () => {
      expect(() => validateVector([Infinity])).toThrow('must be finite')
      expect(() => validateVector([-Infinity])).toThrow('must be finite')
    })

    it('should validate expected dimensions', () => {
      expect(validateVector([0.1, 0.2, 0.3], 3)).toEqual([0.1, 0.2, 0.3])
      expect(() => validateVector([0.1, 0.2], 3)).toThrow('2 dimensions, expected 3')
    })
  })

  describe('validateDocumentId', () => {
    it('should accept valid document IDs', () => {
      expect(validateDocumentId('doc123')).toBe('doc123')
      expect(validateDocumentId('user_1')).toBe('user_1')
      expect(validateDocumentId('abc')).toBe('abc')
    })

    it('should reject non-strings', () => {
      expect(() => validateDocumentId(123)).toThrow('must be a string')
      expect(() => validateDocumentId(null)).toThrow('must be a string')
    })

    it('should reject empty strings', () => {
      expect(() => validateDocumentId('')).toThrow('cannot be empty')
    })

    it('should reject IDs with colons', () => {
      expect(() => validateDocumentId('user:123')).toThrow('cannot contain colons')
    })

    it('should reject IDs that are too long', () => {
      const longId = 'a'.repeat(1025)
      expect(() => validateDocumentId(longId)).toThrow('exceeds maximum length')
    })
  })

  describe('validateCollectionName', () => {
    it('should accept valid collection names', () => {
      expect(validateCollectionName('users')).toBe('users')
      expect(validateCollectionName('my_collection')).toBe('my_collection')
      expect(validateCollectionName('Products123')).toBe('Products123')
    })

    it('should reject non-strings', () => {
      expect(() => validateCollectionName(123)).toThrow('must be a string')
      expect(() => validateCollectionName(null)).toThrow('must be a string')
    })

    it('should reject empty strings', () => {
      expect(() => validateCollectionName('')).toThrow('cannot be empty')
    })

    it('should reject names starting with system.', () => {
      expect(() => validateCollectionName('system.users')).toThrow('cannot start with "system."')
    })

    it('should reject names containing $', () => {
      expect(() => validateCollectionName('user$data')).toThrow('cannot contain "$"')
    })

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(129)
      expect(() => validateCollectionName(longName)).toThrow('exceeds maximum length')
    })
  })

  describe('validateScore', () => {
    it('should accept valid scores', () => {
      expect(validateScore(0)).toBe(0)
      expect(validateScore(0.5)).toBe(0.5)
      expect(validateScore(1)).toBe(1)
    })

    it('should reject non-numbers', () => {
      expect(() => validateScore('0.5')).toThrow('must be a number')
      expect(() => validateScore(null)).toThrow('must be a number')
    })

    it('should reject NaN', () => {
      expect(() => validateScore(NaN)).toThrow('cannot be NaN')
    })

    it('should reject out-of-range scores', () => {
      expect(() => validateScore(-0.1)).toThrow('must be between 0 and 1')
      expect(() => validateScore(1.1)).toThrow('must be between 0 and 1')
    })
  })

  describe('validateSearchOptions', () => {
    it('should return defaults for undefined', () => {
      expect(validateSearchOptions(undefined)).toEqual({ limit: 10 })
      expect(validateSearchOptions(null)).toEqual({ limit: 10 })
    })

    it('should accept valid options', () => {
      expect(validateSearchOptions({ limit: 20 })).toEqual({ limit: 20 })
      expect(validateSearchOptions({ limit: 5, filter: { status: 'active' } })).toEqual({
        limit: 5,
        filter: { status: 'active' },
      })
    })

    it('should reject non-object options', () => {
      expect(() => validateSearchOptions('string')).toThrow('must be an object')
    })

    it('should reject invalid limit', () => {
      expect(() => validateSearchOptions({ limit: 0 })).toThrow('positive number')
      expect(() => validateSearchOptions({ limit: -1 })).toThrow('positive number')
      expect(() => validateSearchOptions({ limit: 'ten' })).toThrow('positive number')
    })

    it('should reject invalid filter', () => {
      expect(() => validateSearchOptions({ filter: 'string' })).toThrow('must be an object')
    })
  })

  describe('EMBEDDING_DIMENSIONS', () => {
    it('should have correct dimensions for common models', () => {
      expect(EMBEDDING_DIMENSIONS['bge-m3']).toBe(1024)
      expect(EMBEDDING_DIMENSIONS['text-embedding-3-small']).toBe(1536)
      expect(EMBEDDING_DIMENSIONS['text-embedding-3-large']).toBe(3072)
    })
  })
})
