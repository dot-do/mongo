import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * RED Phase: Tests for runtime environment detection
 *
 * These tests verify that the runtime detection module correctly identifies:
 * - Cloudflare Workers (workerd)
 * - Node.js
 * - Bun
 * - Test environments (vitest/jest)
 * - Production vs Development modes
 */

describe('RuntimeDetection', () => {
  // Store original globals to restore after tests
  const originalGlobals: Record<string, unknown> = {}

  beforeEach(() => {
    vi.resetModules()
    // Store original values
    originalGlobals.navigator = globalThis.navigator
    originalGlobals.process = globalThis.process
    originalGlobals.Bun = (globalThis as any).Bun
    originalGlobals.caches = (globalThis as any).caches
  })

  afterEach(() => {
    // Restore original values
    Object.defineProperty(globalThis, 'navigator', {
      value: originalGlobals.navigator,
      writable: true,
      configurable: true,
    })
    ;(globalThis as any).process = originalGlobals.process
    ;(globalThis as any).Bun = originalGlobals.Bun
    ;(globalThis as any).caches = originalGlobals.caches
  })

  describe('workerd detection', () => {
    it('should detect workerd environment via navigator.userAgent', async () => {
      // Mock workerd environment
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'Cloudflare-Workers' },
        writable: true,
        configurable: true,
      })
      delete (globalThis as any).process

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isWorkerd()).toBe(true)
      expect(runtime.isNode()).toBe(false)
      expect(runtime.isBun()).toBe(false)
      expect(runtime.getRuntime()).toBe('workerd')
    })

    it('should detect workerd environment via caches API', async () => {
      // Mock workerd environment with caches API (CF-specific)
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      })
      ;(globalThis as any).caches = {
        default: {},
        open: vi.fn(),
      }
      delete (globalThis as any).process
      delete (globalThis as any).Bun

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isWorkerd()).toBe(true)
    })
  })

  describe('Node.js detection', () => {
    it('should detect Node.js environment', async () => {
      // Mock Node.js environment
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      })
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: {},
      }
      delete (globalThis as any).Bun
      delete (globalThis as any).caches

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isNode()).toBe(true)
      expect(runtime.isWorkerd()).toBe(false)
      expect(runtime.isBun()).toBe(false)
      expect(runtime.getRuntime()).toBe('node')
    })

    it('should detect Node.js version', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.10.0' },
        env: {},
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.getNodeVersion()).toBe('20.10.0')
    })
  })

  describe('Bun detection', () => {
    it('should detect Bun environment', async () => {
      // Mock Bun environment
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      })
      ;(globalThis as any).Bun = {
        version: '1.0.0',
      }
      ;(globalThis as any).process = {
        versions: { bun: '1.0.0' },
        env: {},
      }
      delete (globalThis as any).caches

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isBun()).toBe(true)
      expect(runtime.isNode()).toBe(false)
      expect(runtime.isWorkerd()).toBe(false)
      expect(runtime.getRuntime()).toBe('bun')
    })

    it('should detect Bun version', async () => {
      ;(globalThis as any).Bun = { version: '1.1.0' }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.getBunVersion()).toBe('1.1.0')
    })
  })

  describe('test environment detection', () => {
    it('should detect vitest test environment', async () => {
      // Vitest sets import.meta.vitest or process.env.VITEST
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { VITEST: 'true' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isTest()).toBe(true)
    })

    it('should detect jest test environment', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { JEST_WORKER_ID: '1' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isTest()).toBe(true)
    })

    it('should detect NODE_ENV=test', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { NODE_ENV: 'test' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isTest()).toBe(true)
    })
  })

  describe('production/development flags', () => {
    it('should expose isProduction flag when NODE_ENV=production', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { NODE_ENV: 'production' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isProduction()).toBe(true)
      expect(runtime.isDevelopment()).toBe(false)
    })

    it('should expose isDevelopment flag when NODE_ENV=development', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { NODE_ENV: 'development' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isDevelopment()).toBe(true)
      expect(runtime.isProduction()).toBe(false)
    })

    it('should default to development when NODE_ENV is not set', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: {},
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.isDevelopment()).toBe(true)
      expect(runtime.isProduction()).toBe(false)
    })

    it('should detect production in workerd via environment binding', async () => {
      // In Workers, production is typically detected via ENVIRONMENT binding
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'Cloudflare-Workers' },
        writable: true,
        configurable: true,
      })
      delete (globalThis as any).process

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection({ ENVIRONMENT: 'production' })

      expect(runtime.isProduction()).toBe(true)
    })
  })

  describe('singleton pattern', () => {
    it('should provide a default singleton instance', async () => {
      const { runtime } = await import('../../../src/runtime/detection')

      expect(runtime).toBeDefined()
      expect(typeof runtime.getRuntime).toBe('function')
    })

    it('should allow creating custom instances', async () => {
      const { RuntimeDetection } = await import('../../../src/runtime/detection')

      const instance1 = new RuntimeDetection()
      const instance2 = new RuntimeDetection({ ENVIRONMENT: 'staging' })

      expect(instance1).not.toBe(instance2)
    })
  })

  describe('feature detection', () => {
    it('should detect if WebCrypto is available', async () => {
      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      // WebCrypto should be available in most modern environments
      expect(typeof runtime.hasWebCrypto()).toBe('boolean')
    })

    it('should detect if fetch is available', async () => {
      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      expect(runtime.hasFetch()).toBe(true)
    })

    it('should detect if SQLite is available (for libSQL)', async () => {
      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()

      // This should return false in workerd, true in Node with better-sqlite3
      expect(typeof runtime.hasSQLite()).toBe('boolean')
    })
  })

  describe('environment info', () => {
    it('should provide complete environment info object', async () => {
      ;(globalThis as any).process = {
        versions: { node: '20.0.0' },
        env: { NODE_ENV: 'development' },
      }

      const { RuntimeDetection } = await import('../../../src/runtime/detection')
      const runtime = new RuntimeDetection()
      const info = runtime.getEnvironmentInfo()

      expect(info).toMatchObject({
        runtime: expect.any(String),
        isProduction: expect.any(Boolean),
        isDevelopment: expect.any(Boolean),
        isTest: expect.any(Boolean),
        features: {
          webCrypto: expect.any(Boolean),
          fetch: expect.any(Boolean),
          sqlite: expect.any(Boolean),
        },
      })
    })
  })
})
