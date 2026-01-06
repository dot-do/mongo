import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VectorizeStorageAdapter, createVectorizeAdapter } from '../../../src/storage/vectorize/adapter'
import type { VectorizeIndex } from '../../../src/types/vectorize'

/**
 * Tests for VectorizeStorageAdapter
 *
 * Verifies that the adapter correctly wraps Cloudflare Vectorize
 * to implement the VectorStorageAdapter interface.
 */

// Create mock VectorizeIndex
function createMockVectorize(overrides: Partial<VectorizeIndex> = {}): VectorizeIndex {
  return {
    query: vi.fn().mockResolvedValue({ matches: [] }),
    upsert: vi.fn().mockResolvedValue({ count: 1, ids: [] }),
    deleteByIds: vi.fn().mockResolvedValue({ count: 1, ids: [] }),
    getByIds: vi.fn().mockResolvedValue({ vectors: [] }),
    describe: vi.fn().mockResolvedValue({ dimensions: 1024 }),
    ...overrides,
  } as VectorizeIndex
}

describe('VectorizeStorageAdapter', () => {
  let mockVectorize: VectorizeIndex

  beforeEach(() => {
    vi.clearAllMocks()
    mockVectorize = createMockVectorize()
  })

  describe('constructor', () => {
    it('should create adapter with VectorizeIndex', () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)
      expect(adapter).toBeDefined()
    })

    it('should throw if VectorizeIndex is not provided', () => {
      expect(() => new VectorizeStorageAdapter(null as any)).toThrow(
        /VectorizeIndex.*required/i
      )
    })
  })

  describe('upsertVector', () => {
    it('should upsert vector with correct ID format', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.upsertVector('users', 'doc123', [0.1, 0.2, 0.3])

      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'users:doc123',
          values: [0.1, 0.2, 0.3],
        }),
      ])
    })

    it('should include metadata with internal fields', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.upsertVector('products', 'prod1', [0.5], { name: 'Widget', price: 99 })

      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'products:prod1',
          metadata: expect.objectContaining({
            name: 'Widget',
            price: 99,
            _collection: 'products',
            _documentId: 'prod1',
          }),
        }),
      ])
    })

    it('should work without metadata', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.upsertVector('items', 'item1', [0.1, 0.2])

      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          metadata: expect.objectContaining({
            _collection: 'items',
            _documentId: 'item1',
          }),
        }),
      ])
    })
  })

  describe('deleteVector', () => {
    it('should delete vector with correct ID format', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.deleteVector('users', 'doc123')

      expect(mockVectorize.deleteByIds).toHaveBeenCalledWith(['users:doc123'])
    })
  })

  describe('vectorSearch', () => {
    it('should query with correct parameters', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.vectorSearch('products', [0.1, 0.2, 0.3], { limit: 20 })

      expect(mockVectorize.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
        topK: 20,
        returnMetadata: 'all',
      })
    })

    it('should use default limit of 10', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)

      await adapter.vectorSearch('products', [0.1])

      expect(mockVectorize.query).toHaveBeenCalledWith([0.1], {
        topK: 10,
        returnMetadata: 'all',
      })
    })

    it('should filter results by collection prefix', async () => {
      const vectorizeWithResults = createMockVectorize({
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: 'products:p1', score: 0.95, metadata: { _documentId: 'p1' } },
            { id: 'orders:o1', score: 0.90, metadata: { _documentId: 'o1' } },
            { id: 'products:p2', score: 0.85, metadata: { _documentId: 'p2' } },
          ],
        }),
      })

      const adapter = new VectorizeStorageAdapter(vectorizeWithResults)
      const results = await adapter.vectorSearch('products', [0.1])

      expect(results).toHaveLength(2)
      expect(results[0].documentId).toBe('p1')
      expect(results[1].documentId).toBe('p2')
    })

    it('should map VectorizeMatch to VectorMatch format', async () => {
      const vectorizeWithResults = createMockVectorize({
        query: vi.fn().mockResolvedValue({
          matches: [
            {
              id: 'users:user1',
              score: 0.92,
              metadata: {
                _collection: 'users',
                _documentId: 'user1',
                name: 'Alice',
                role: 'admin',
              },
            },
          ],
        }),
      })

      const adapter = new VectorizeStorageAdapter(vectorizeWithResults)
      const results = await adapter.vectorSearch('users', [0.1])

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        documentId: 'user1',
        score: 0.92,
        metadata: {
          name: 'Alice',
          role: 'admin',
        },
      })
    })

    it('should exclude internal metadata fields from results', async () => {
      const vectorizeWithResults = createMockVectorize({
        query: vi.fn().mockResolvedValue({
          matches: [
            {
              id: 'items:i1',
              score: 0.88,
              metadata: {
                _collection: 'items',
                _documentId: 'i1',
                title: 'Test Item',
              },
            },
          ],
        }),
      })

      const adapter = new VectorizeStorageAdapter(vectorizeWithResults)
      const results = await adapter.vectorSearch('items', [0.1])

      expect(results[0].metadata).not.toHaveProperty('_collection')
      expect(results[0].metadata).not.toHaveProperty('_documentId')
      expect(results[0].metadata).toHaveProperty('title', 'Test Item')
    })

    it('should return empty array when no matches', async () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)
      const results = await adapter.vectorSearch('empty', [0.1])

      expect(results).toEqual([])
    })

    it('should return undefined metadata when no custom metadata', async () => {
      const vectorizeWithResults = createMockVectorize({
        query: vi.fn().mockResolvedValue({
          matches: [
            {
              id: 'items:i1',
              score: 0.88,
              metadata: {
                _collection: 'items',
                _documentId: 'i1',
              },
            },
          ],
        }),
      })

      const adapter = new VectorizeStorageAdapter(vectorizeWithResults)
      const results = await adapter.vectorSearch('items', [0.1])

      expect(results[0].metadata).toBeUndefined()
    })
  })

  describe('isAvailable', () => {
    it('should return true when vectorize is available', () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)
      expect(adapter.isAvailable()).toBe(true)
    })
  })

  describe('getVectorize', () => {
    it('should return underlying VectorizeIndex', () => {
      const adapter = new VectorizeStorageAdapter(mockVectorize)
      expect(adapter.getVectorize()).toBe(mockVectorize)
    })
  })

  describe('createVectorizeAdapter factory', () => {
    it('should create adapter instance', () => {
      const adapter = createVectorizeAdapter(mockVectorize)
      expect(adapter).toBeInstanceOf(VectorizeStorageAdapter)
    })
  })
})
