import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * RED Phase: Tests for StorageFactory automatic adapter selection
 *
 * These tests verify that StorageFactory correctly creates adapters
 * based on runtime environment (workerd vs Node/Bun) and available bindings.
 */

describe('StorageFactory', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createStorageAdapter', () => {
    it('should create LibSQLStorageAdapter in Node/dev mode', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        RuntimeDetection: class {
          getRuntime() { return 'node' }
          isProduction() { return false }
          isDevelopment() { return true }
        },
        runtime: {
          getRuntime: () => 'node',
          isProduction: () => false,
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isProduction: () => false,
        isDevelopment: () => true,
      }))

      const { createStorageAdapter } = await import('../../../src/storage/factory')

      const adapter = await createStorageAdapter({ database: 'test' })

      expect(adapter.constructor.name).toBe('LibSQLStorageAdapter')
    })

    it('should use .mongo directory for libSQL by default', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isDevelopment: () => true,
      }))

      const { createStorageAdapter } = await import('../../../src/storage/factory')

      const adapter = await createStorageAdapter({ database: 'myapp' })

      // Verify path contains .mongo directory
      expect(adapter.getPath()).toContain('.mongo')
      expect(adapter.getPath()).toContain('myapp.db')
    })

    it('should respect custom baseDir option', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isDevelopment: () => true,
      }))

      const { createStorageAdapter } = await import('../../../src/storage/factory')

      const adapter = await createStorageAdapter({
        database: 'test',
        baseDir: './custom-data',
      })

      expect(adapter.getPath()).toContain('custom-data')
    })

    it('should create D1StorageAdapter in workerd with D1 binding', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => true,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
        isProduction: () => true,
        isDevelopment: () => false,
      }))

      const { createStorageAdapter } = await import('../../../src/storage/factory')

      const mockD1 = {
        prepare: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      }

      const adapter = await createStorageAdapter({
        database: 'test',
        d1: mockD1 as any,
      })

      expect(adapter.constructor.name).toBe('D1StorageAdapter')
    })

    it('should throw if no storage binding available in workerd', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => true,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
        isProduction: () => true,
        isDevelopment: () => false,
      }))

      const { createStorageAdapter } = await import('../../../src/storage/factory')

      await expect(createStorageAdapter({ database: 'test' })).rejects.toThrow(
        /D1.*binding.*required/i
      )
    })
  })

  describe('createVectorAdapter', () => {
    it('should create LibSQLVectorAdapter in dev mode', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isDevelopment: () => true,
      }))

      const { createVectorAdapter } = await import('../../../src/storage/factory')

      const adapter = await createVectorAdapter({ database: 'test' })

      expect(adapter.constructor.name).toBe('LibSQLVectorAdapter')
    })

    it('should create VectorizeStorageAdapter in workerd with Vectorize binding', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => true,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
        isProduction: () => true,
        isDevelopment: () => false,
      }))

      const { createVectorAdapter } = await import('../../../src/storage/factory')

      const mockVectorize = {
        query: vi.fn(),
        upsert: vi.fn(),
        deleteByIds: vi.fn(),
      }

      const adapter = await createVectorAdapter({
        database: 'test',
        vectorize: mockVectorize as any,
      })

      expect(adapter.constructor.name).toBe('VectorizeStorageAdapter')
    })

    it('should throw if no vector binding available in workerd', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => true,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
        isProduction: () => true,
        isDevelopment: () => false,
      }))

      const { createVectorAdapter } = await import('../../../src/storage/factory')

      await expect(createVectorAdapter({ database: 'test' })).rejects.toThrow(
        /Vectorize.*binding.*required/i
      )
    })

    it('should use libSQL for vectors even in workerd if devMode is true', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => false,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
      }))

      const { createVectorAdapter } = await import('../../../src/storage/factory')

      const adapter = await createVectorAdapter({
        database: 'test',
        devMode: true, // Force dev mode
      })

      expect(adapter.constructor.name).toBe('LibSQLVectorAdapter')
    })
  })

  describe('createEmbeddingProvider', () => {
    it('should create Workers AI model when env.AI present', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      const mockAI = { run: vi.fn() }
      const model = await createEmbeddingProvider({ ai: mockAI as any })

      expect(model.provider).toBe('workers-ai')
    })

    it('should create OpenAI model when API key present', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      const model = await createEmbeddingProvider({
        openaiApiKey: 'sk-test',
      })

      expect(model.provider).toBe('openai')
    })

    it('should create Ollama model when Ollama URL present', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      const model = await createEmbeddingProvider({
        ollamaBaseUrl: 'http://localhost:11434',
      })

      expect(model.provider).toBe('ollama')
    })

    it('should prefer Workers AI over OpenAI when both available', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      const mockAI = { run: vi.fn() }
      const model = await createEmbeddingProvider({
        ai: mockAI as any,
        openaiApiKey: 'sk-test',
      })

      expect(model.provider).toBe('workers-ai')
    })

    it('should throw if no embedding provider configuration present', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      await expect(createEmbeddingProvider({})).rejects.toThrow(
        /embedding.*provider.*not.*configured/i
      )
    })

    it('should allow custom model ID', async () => {
      const { createEmbeddingProvider } = await import('../../../src/storage/factory')

      const mockAI = { run: vi.fn() }
      const model = await createEmbeddingProvider({
        ai: mockAI as any,
        modelId: '@cf/baai/bge-large-en-v1.5',
      })

      expect(model.modelId).toBe('@cf/baai/bge-large-en-v1.5')
    })
  })

  describe('createFullStack', () => {
    it('should create all adapters with shared configuration', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isDevelopment: () => true,
      }))

      const { createFullStack } = await import('../../../src/storage/factory')

      const { storage, vectors, embedding } = await createFullStack({
        database: 'test',
        openaiApiKey: 'sk-test',
      })

      expect(storage).toBeDefined()
      expect(vectors).toBeDefined()
      expect(embedding).toBeDefined()
    })

    it('should use same database path for storage and vectors', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          isDevelopment: () => true,
        },
        detectRuntime: () => 'node',
        isDevelopment: () => true,
      }))

      const { createFullStack } = await import('../../../src/storage/factory')

      const { storage, vectors } = await createFullStack({
        database: 'shared-db',
        openaiApiKey: 'sk-test',
      })

      // Both should reference the same database file
      expect(storage.getPath()).toBe(vectors.getPath())
    })

    it('should work in workerd with all bindings', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          isProduction: () => true,
          isDevelopment: () => false,
        },
        detectRuntime: () => 'workerd',
        isProduction: () => true,
        isDevelopment: () => false,
      }))

      const { createFullStack } = await import('../../../src/storage/factory')

      const mockD1 = { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn() }
      const mockVectorize = { query: vi.fn(), upsert: vi.fn(), deleteByIds: vi.fn() }
      const mockAI = { run: vi.fn() }

      const { storage, vectors, embedding } = await createFullStack({
        database: 'test',
        d1: mockD1 as any,
        vectorize: mockVectorize as any,
        ai: mockAI as any,
      })

      expect(storage.constructor.name).toBe('D1StorageAdapter')
      expect(vectors.constructor.name).toBe('VectorizeStorageAdapter')
      expect(embedding.provider).toBe('workers-ai')
    })
  })

  describe('isAvailable', () => {
    it('should report libSQL available in Node environment', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'node',
          hasSQLite: () => true,
        },
        detectRuntime: () => 'node',
      }))

      const { isLibSQLAvailable } = await import('../../../src/storage/factory')

      expect(isLibSQLAvailable()).toBe(true)
    })

    it('should report libSQL not available in workerd', async () => {
      vi.doMock('../../../src/runtime/detection', () => ({
        runtime: {
          getRuntime: () => 'workerd',
          hasSQLite: () => false,
        },
        detectRuntime: () => 'workerd',
      }))

      const { isLibSQLAvailable } = await import('../../../src/storage/factory')

      expect(isLibSQLAvailable()).toBe(false)
    })
  })
})
