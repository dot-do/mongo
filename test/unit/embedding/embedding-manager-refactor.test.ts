import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VectorStorageAdapter } from '../../../src/storage/vector-types'

/**
 * RED Phase: Tests for EmbeddingManager refactor to use AI SDK and VectorStorageAdapter
 *
 * These tests will fail until we refactor EmbeddingManager to support:
 * 1. AI SDK's embed/embedMany for embedding generation
 * 2. VectorStorageAdapter for vector storage
 * 3. Backward compatibility with legacy Vectorize + Workers AI
 */

// Mock the AI SDK
vi.mock('ai', () => ({
  embed: vi.fn(),
  embedMany: vi.fn()
}))

// Create mock VectorStorageAdapter
function createMockVectorStorage(overrides: Partial<VectorStorageAdapter> = {}): VectorStorageAdapter {
  return {
    upsertVector: vi.fn().mockResolvedValue(undefined),
    deleteVector: vi.fn().mockResolvedValue(undefined),
    vectorSearch: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockReturnValue(true),
    ...overrides
  }
}

// Create mock embedding model (AI SDK format)
function createMockEmbeddingModel() {
  return {
    modelId: '@cf/baai/bge-m3',
    provider: 'workers-ai'
  }
}

describe('EmbeddingManager (Refactored)', () => {
  let mockVectorStorage: VectorStorageAdapter
  let mockModel: ReturnType<typeof createMockEmbeddingModel>

  beforeEach(async () => {
    vi.clearAllMocks()

    mockVectorStorage = createMockVectorStorage()
    mockModel = createMockEmbeddingModel()

    // Setup AI SDK mock responses
    const { embed, embedMany } = await import('ai')

    vi.mocked(embed).mockResolvedValue({
      embedding: Array(1024).fill(0.1),
      usage: { tokens: 10 }
    } as any)

    vi.mocked(embedMany).mockResolvedValue({
      embeddings: [
        Array(1024).fill(0.1),
        Array(1024).fill(0.2)
      ],
      usage: { tokens: 20 }
    } as any)
  })

  describe('Constructor', () => {
    it('should accept new config format with embeddingModel and vectorStorage', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      // New config format with AI SDK model and VectorStorageAdapter
      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'test'
      })

      expect(manager).toBeDefined()
    })

    it('should accept VectorStorageAdapter instead of VectorizeIndex', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      expect(manager).toBeDefined()
      expect(manager.getConfig().collection).toBe('users')
    })

    it('should accept EmbeddingModel from AI SDK instead of Ai binding', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'products'
      })

      expect(manager).toBeDefined()
    })

    it('should use embeddingModel.modelId as the model name', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: { modelId: 'custom-model', provider: 'openai' },
        vectorStorage: mockVectorStorage,
        collection: 'test'
      })

      expect(manager.getConfig().model).toBe('custom-model')
    })
  })

  describe('embedDocument', () => {
    it('should use AI SDK embed() for embedding generation', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')
      const { embed } = await import('ai')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.embedDocument({ _id: 'doc1', name: 'Alice', email: 'alice@test.com' })

      expect(embed).toHaveBeenCalledWith({
        model: mockModel,
        value: expect.any(String)
      })
    })

    it('should call vectorStorage.upsertVector with embedding result', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.embedDocument({ _id: 'doc1', name: 'Alice' })

      expect(mockVectorStorage.upsertVector).toHaveBeenCalledWith(
        'users',
        'doc1',
        expect.arrayContaining([expect.any(Number)]),
        expect.any(Object)
      )
    })

    it('should serialize document before embedding', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')
      const { embed } = await import('ai')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users',
        serialization: { serializer: 'yaml' }
      })

      await manager.embedDocument({ _id: 'doc1', name: 'Alice', age: 30 })

      // Should call embed with serialized text containing the document fields
      expect(embed).toHaveBeenCalledWith({
        model: mockModel,
        value: expect.stringContaining('name')
      })
    })

    it('should return EmbedResult with count and ids', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      const result = await manager.embedDocument({ _id: 'doc1', name: 'Alice' })

      expect(result).toEqual({
        count: 1,
        ids: expect.arrayContaining([expect.stringContaining('doc1')])
      })
    })

    it('should pass metadata to vectorStorage', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.embedDocument(
        { _id: 'doc1', name: 'Alice' },
        { metadata: { category: 'vip' } }
      )

      expect(mockVectorStorage.upsertVector).toHaveBeenCalledWith(
        'users',
        'doc1',
        expect.any(Array),
        expect.objectContaining({ category: 'vip' })
      )
    })
  })

  describe('embedDocuments', () => {
    it('should use AI SDK embedMany() for batch embedding', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')
      const { embedMany } = await import('ai')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.embedDocuments([
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' }
      ])

      expect(embedMany).toHaveBeenCalledWith({
        model: mockModel,
        values: expect.arrayContaining([expect.any(String), expect.any(String)])
      })
    })

    it('should call vectorStorage.upsertVector for each document', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.embedDocuments([
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' }
      ])

      // Should call upsertVector for each document
      expect(mockVectorStorage.upsertVector).toHaveBeenCalledTimes(2)
      expect(mockVectorStorage.upsertVector).toHaveBeenCalledWith(
        'users',
        'doc1',
        expect.any(Array),
        expect.any(Object)
      )
      expect(mockVectorStorage.upsertVector).toHaveBeenCalledWith(
        'users',
        'doc2',
        expect.any(Array),
        expect.any(Object)
      )
    })

    it('should return EmbedResult with count and ids for all documents', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      const result = await manager.embedDocuments([
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' }
      ])

      expect(result.count).toBe(2)
      expect(result.ids).toHaveLength(2)
    })

    it('should handle empty documents array', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      const result = await manager.embedDocuments([])

      expect(result).toEqual({ count: 0, ids: [] })
    })
  })

  describe('deleteDocument', () => {
    it('should call vectorStorage.deleteVector', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.deleteDocument('doc1')

      expect(mockVectorStorage.deleteVector).toHaveBeenCalledWith('users', 'doc1')
    })

    it('should use collection name from config', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'products'
      })

      await manager.deleteDocument('product123')

      expect(mockVectorStorage.deleteVector).toHaveBeenCalledWith('products', 'product123')
    })
  })

  describe('deleteDocuments', () => {
    it('should call vectorStorage.deleteVector for each document', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await manager.deleteDocuments(['doc1', 'doc2', 'doc3'])

      expect(mockVectorStorage.deleteVector).toHaveBeenCalledTimes(3)
      expect(mockVectorStorage.deleteVector).toHaveBeenCalledWith('users', 'doc1')
      expect(mockVectorStorage.deleteVector).toHaveBeenCalledWith('users', 'doc2')
      expect(mockVectorStorage.deleteVector).toHaveBeenCalledWith('users', 'doc3')
    })
  })

  describe('Backward Compatibility', () => {
    it('should still work with legacy Vectorize + Workers AI config', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const mockVectorize = {
        upsert: vi.fn().mockResolvedValue({ count: 1, ids: ['users:doc1'] }),
        deleteByIds: vi.fn().mockResolvedValue({ count: 1, ids: ['users:doc1'] })
      }

      const mockAi = {
        run: vi.fn().mockResolvedValue({ data: [Array(1024).fill(0.1)] })
      }

      // Legacy config format
      const manager = new EmbeddingManager({
        vectorize: mockVectorize as any,
        ai: mockAi as any,
        collection: 'users'
      })

      await manager.embedDocument({ _id: 'doc1', name: 'Alice' })

      expect(mockAi.run).toHaveBeenCalled()
      expect(mockVectorize.upsert).toHaveBeenCalled()
    })

    it('should prefer new config over legacy if both provided', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')
      const { embed } = await import('ai')

      const mockVectorize = {
        upsert: vi.fn().mockResolvedValue({ count: 1, ids: ['users:doc1'] }),
        deleteByIds: vi.fn().mockResolvedValue({ count: 1, ids: ['users:doc1'] })
      }

      const mockAi = {
        run: vi.fn().mockResolvedValue({ data: [Array(1024).fill(0.1)] })
      }

      // Both new and legacy config
      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        vectorize: mockVectorize as any,
        ai: mockAi as any,
        collection: 'users'
      })

      await manager.embedDocument({ _id: 'doc1', name: 'Alice' })

      // Should use new AI SDK
      expect(embed).toHaveBeenCalled()
      expect(mockAi.run).not.toHaveBeenCalled()

      // Should use new VectorStorageAdapter
      expect(mockVectorStorage.upsertVector).toHaveBeenCalled()
      expect(mockVectorize.upsert).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should propagate embedding errors', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')
      const { embed } = await import('ai')

      vi.mocked(embed).mockRejectedValue(new Error('Rate limit exceeded'))

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: mockVectorStorage,
        collection: 'users'
      })

      await expect(manager.embedDocument({ _id: 'doc1', name: 'Alice' })).rejects.toThrow(
        'Rate limit exceeded'
      )
    })

    it('should propagate storage errors', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const failingStorage = createMockVectorStorage({
        upsertVector: vi.fn().mockRejectedValue(new Error('Storage unavailable'))
      })

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: failingStorage,
        collection: 'users'
      })

      await expect(manager.embedDocument({ _id: 'doc1', name: 'Alice' })).rejects.toThrow(
        'Storage unavailable'
      )
    })

    it('should throw helpful error if no embedding provider configured', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      // No embeddingModel or ai provided
      expect(() => {
        new EmbeddingManager({
          vectorStorage: mockVectorStorage,
          collection: 'users'
        } as any)
      }).toThrow(/embedding.*model.*not.*configured|ai.*not.*configured/i)
    })

    it('should throw helpful error if no vector storage configured', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      // No vectorStorage or vectorize provided
      expect(() => {
        new EmbeddingManager({
          embeddingModel: mockModel,
          collection: 'users'
        } as any)
      }).toThrow(/vector.*storage.*not.*configured|vectorize.*not.*configured/i)
    })
  })

  describe('Configuration', () => {
    it('should expose storage availability via isAvailable method', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: createMockVectorStorage({ isAvailable: () => true }),
        collection: 'users'
      })

      expect(manager.isAvailable()).toBe(true)
    })

    it('should return false from isAvailable when storage unavailable', async () => {
      const { EmbeddingManager } = await import('../../../src/embedding/embedding-manager')

      const manager = new EmbeddingManager({
        embeddingModel: mockModel,
        vectorStorage: createMockVectorStorage({ isAvailable: () => false }),
        collection: 'users'
      })

      expect(manager.isAvailable()).toBe(false)
    })
  })
})
