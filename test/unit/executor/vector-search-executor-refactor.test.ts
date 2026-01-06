import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VectorSearchExecutor, VectorSearchTranslation } from '../../../src/executor/vector-search-executor'
import type { VectorStorageAdapter, VectorMatch } from '../../../src/storage/vector-types'

/**
 * RED Phase: Tests for VectorSearchExecutor refactor to use VectorStorageAdapter
 *
 * These tests will fail until we refactor VectorSearchExecutor to accept
 * VectorStorageAdapter instead of VectorizeIndex directly.
 */

// Mock SQL interface (required by VectorSearchExecutor constructor)
const mockSql = {
  exec: vi.fn(() => ({ results: [] }))
}

// Create a mock VectorStorageAdapter
function createMockAdapter(overrides: Partial<VectorStorageAdapter> = {}): VectorStorageAdapter {
  return {
    upsertVector: vi.fn().mockResolvedValue(undefined),
    deleteVector: vi.fn().mockResolvedValue(undefined),
    vectorSearch: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockReturnValue(true),
    ...overrides
  }
}

describe('VectorSearchExecutor (Refactored)', () => {
  describe('Dependency Injection', () => {
    it('should accept VectorStorageAdapter via constructor', () => {
      const adapter = createMockAdapter()

      // This should work once refactored - currently only accepts VectorizeIndex
      const executor = new VectorSearchExecutor(mockSql, { adapter })

      expect(executor).toBeDefined()
    })

    it('should work with mock VectorStorageAdapter', async () => {
      const mockMatches: VectorMatch[] = [
        { documentId: 'doc1', score: 0.95, metadata: { name: 'Test Doc' } },
        { documentId: 'doc2', score: 0.85, metadata: { name: 'Another Doc' } }
      ]

      const adapter = createMockAdapter({
        vectorSearch: vi.fn().mockResolvedValue(mockMatches)
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1, 0.2, 0.3],
        limit: 10,
        scoreField: 'score'
      }

      const results = await executor.executeVectorSearch(translation, 'testCollection')

      expect(adapter.vectorSearch).toHaveBeenCalledWith(
        'testCollection',
        [0.1, 0.2, 0.3],
        expect.objectContaining({ limit: 10 })
      )
      expect(results).toHaveLength(2)
    })

    it('should throw helpful error if no adapter provided', async () => {
      // When neither adapter nor vectorize is provided, should give clear error
      expect(() => {
        const executor = new VectorSearchExecutor(mockSql)
        // Accessing internal state to verify proper initialization
        expect(executor).toBeDefined()
      }).not.toThrow()

      // But calling executeVectorSearch should throw
      const executor = new VectorSearchExecutor(mockSql)
      const translation: VectorSearchTranslation = {
        queryVector: [0.1, 0.2],
        limit: 5,
        scoreField: 'score'
      }

      await expect(executor.executeVectorSearch(translation, 'test')).rejects.toThrow(
        /adapter.*not.*configured|vectorize.*not.*configured/i
      )
    })
  })

  describe('executeVectorSearch', () => {
    it('should delegate to adapter.vectorSearch', async () => {
      const vectorSearchMock = vi.fn().mockResolvedValue([])
      const adapter = createMockAdapter({ vectorSearch: vectorSearchMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.5, 0.5, 0.5],
        limit: 20,
        scoreField: 'similarity'
      }

      await executor.executeVectorSearch(translation, 'products')

      expect(vectorSearchMock).toHaveBeenCalledTimes(1)
      expect(vectorSearchMock).toHaveBeenCalledWith(
        'products',
        [0.5, 0.5, 0.5],
        expect.any(Object)
      )
    })

    it('should pass collection name correctly', async () => {
      const vectorSearchMock = vi.fn().mockResolvedValue([])
      const adapter = createMockAdapter({ vectorSearch: vectorSearchMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1],
        limit: 5,
        scoreField: 'score'
      }

      await executor.executeVectorSearch(translation, 'my_special_collection')

      expect(vectorSearchMock).toHaveBeenCalledWith(
        'my_special_collection',
        expect.any(Array),
        expect.any(Object)
      )
    })

    it('should pass query vector correctly', async () => {
      const vectorSearchMock = vi.fn().mockResolvedValue([])
      const adapter = createMockAdapter({ vectorSearch: vectorSearchMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const expectedVector = [0.123, 0.456, 0.789, 0.012]
      const translation: VectorSearchTranslation = {
        queryVector: expectedVector,
        limit: 10,
        scoreField: 'score'
      }

      await executor.executeVectorSearch(translation, 'vectors')

      expect(vectorSearchMock).toHaveBeenCalledWith(
        expect.any(String),
        expectedVector,
        expect.any(Object)
      )
    })

    it('should pass limit option correctly', async () => {
      const vectorSearchMock = vi.fn().mockResolvedValue([])
      const adapter = createMockAdapter({ vectorSearch: vectorSearchMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1],
        limit: 42,
        scoreField: 'score'
      }

      await executor.executeVectorSearch(translation, 'test')

      expect(vectorSearchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ limit: 42 })
      )
    })

    it('should map VectorMatch to result format with score field', async () => {
      const mockMatches: VectorMatch[] = [
        { documentId: 'doc-123', score: 0.92, metadata: { title: 'Hello', value: 42 } },
        { documentId: 'doc-456', score: 0.78, metadata: { title: 'World', value: 99 } }
      ]

      const adapter = createMockAdapter({
        vectorSearch: vi.fn().mockResolvedValue(mockMatches)
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1, 0.2],
        limit: 10,
        scoreField: 'relevanceScore'
      }

      const results = await executor.executeVectorSearch(translation, 'docs')

      expect(results).toHaveLength(2)
      expect(results[0]).toMatchObject({
        title: 'Hello',
        value: 42,
        relevanceScore: 0.92
      })
      expect(results[1]).toMatchObject({
        title: 'World',
        value: 99,
        relevanceScore: 0.78
      })
    })

    it('should handle empty results', async () => {
      const adapter = createMockAdapter({
        vectorSearch: vi.fn().mockResolvedValue([])
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1, 0.2, 0.3],
        limit: 10,
        scoreField: 'score'
      }

      const results = await executor.executeVectorSearch(translation, 'empty')

      expect(results).toEqual([])
    })

    it('should preserve document _id in results', async () => {
      const mockMatches: VectorMatch[] = [
        { documentId: 'abc123', score: 0.9, metadata: { name: 'Test', _id: 'abc123' } }
      ]

      const adapter = createMockAdapter({
        vectorSearch: vi.fn().mockResolvedValue(mockMatches)
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.5],
        limit: 5,
        scoreField: 'score'
      }

      const results = await executor.executeVectorSearch(translation, 'test')

      expect(results[0]._id).toBe('abc123')
    })
  })

  describe('upsertVector', () => {
    it('should delegate to adapter.upsertVector', async () => {
      const upsertMock = vi.fn().mockResolvedValue(undefined)
      const adapter = createMockAdapter({ upsertVector: upsertMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const doc = { _id: 'doc1', name: 'Test', data: [1, 2, 3] }
      const vector = [0.1, 0.2, 0.3, 0.4]

      await executor.upsertVector('myCollection', 'doc1', vector, doc)

      expect(upsertMock).toHaveBeenCalledWith(
        'myCollection',
        'doc1',
        vector,
        expect.any(Object)
      )
    })
  })

  describe('deleteVector', () => {
    it('should delegate to adapter.deleteVector', async () => {
      const deleteMock = vi.fn().mockResolvedValue(undefined)
      const adapter = createMockAdapter({ deleteVector: deleteMock })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      await executor.deleteVector('myCollection', 'doc-to-delete')

      expect(deleteMock).toHaveBeenCalledWith('myCollection', 'doc-to-delete')
    })
  })

  describe('Backward Compatibility', () => {
    it('should still support legacy VectorizeIndex if adapter not provided', async () => {
      // Mock VectorizeIndex
      const mockVectorize = {
        query: vi.fn().mockResolvedValue({
          matches: [
            {
              id: 'testColl:doc1',
              score: 0.88,
              metadata: {
                _data: JSON.stringify({ name: 'Legacy Doc' }),
                _collection: 'testColl',
                _documentId: 'doc1'
              }
            }
          ]
        }),
        upsert: vi.fn().mockResolvedValue(undefined),
        deleteByIds: vi.fn().mockResolvedValue(undefined)
      }

      // Legacy usage: passing VectorizeIndex directly
      const executor = new VectorSearchExecutor(mockSql, mockVectorize as any)

      const translation: VectorSearchTranslation = {
        queryVector: [0.1, 0.2],
        limit: 5,
        scoreField: 'score'
      }

      const results = await executor.executeVectorSearch(translation, 'testColl')

      expect(mockVectorize.query).toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        name: 'Legacy Doc',
        score: 0.88
      })
    })

    it('should prefer adapter over legacy vectorize if both provided', async () => {
      const adapterSearchMock = vi.fn().mockResolvedValue([
        { documentId: 'adapter-doc', score: 0.99, metadata: { source: 'adapter' } }
      ])
      const adapter = createMockAdapter({ vectorSearch: adapterSearchMock })

      const mockVectorize = {
        query: vi.fn().mockResolvedValue({ matches: [] })
      }

      // Both adapter and legacy vectorize provided - adapter should be preferred
      const executor = new VectorSearchExecutor(mockSql, { adapter, vectorize: mockVectorize as any })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1],
        limit: 10,
        scoreField: 'score'
      }

      await executor.executeVectorSearch(translation, 'test')

      expect(adapterSearchMock).toHaveBeenCalled()
      expect(mockVectorize.query).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should propagate adapter errors', async () => {
      const adapter = createMockAdapter({
        vectorSearch: vi.fn().mockRejectedValue(new Error('Database connection failed'))
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      const translation: VectorSearchTranslation = {
        queryVector: [0.1],
        limit: 10,
        scoreField: 'score'
      }

      await expect(executor.executeVectorSearch(translation, 'test')).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('should check adapter availability', () => {
      const adapter = createMockAdapter({
        isAvailable: vi.fn().mockReturnValue(false)
      })

      const executor = new VectorSearchExecutor(mockSql, { adapter })

      // The executor should expose adapter availability
      expect(executor.isVectorSearchAvailable()).toBe(false)
    })
  })
})
