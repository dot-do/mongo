/**
 * Runtime Environment Detection
 *
 * Detects the current JavaScript runtime environment (workerd, Node.js, Bun)
 * and provides utilities for feature detection and environment configuration.
 */

export type Runtime = 'workerd' | 'node' | 'bun' | 'unknown'

/**
 * Environment bindings that may be passed to Workers
 */
export interface EnvironmentBindings {
  ENVIRONMENT?: string
  NODE_ENV?: string
  [key: string]: unknown
}

/**
 * Feature availability flags
 */
export interface RuntimeFeatures {
  webCrypto: boolean
  fetch: boolean
  sqlite: boolean
}

/**
 * Complete environment information
 */
export interface EnvironmentInfo {
  runtime: Runtime
  isProduction: boolean
  isDevelopment: boolean
  isTest: boolean
  features: RuntimeFeatures
  nodeVersion?: string
  bunVersion?: string
}

/**
 * Runtime detection and environment configuration
 */
export class RuntimeDetection {
  private readonly env: EnvironmentBindings
  private cachedRuntime?: Runtime

  constructor(env: EnvironmentBindings = {}) {
    this.env = env
  }

  /**
   * Detect if running in Cloudflare Workers (workerd)
   */
  isWorkerd(): boolean {
    // Check navigator.userAgent for Cloudflare-Workers
    if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
      return true
    }

    // Check for caches.default (Cloudflare-specific API)
    if (typeof caches !== 'undefined' && 'default' in caches) {
      return true
    }

    return false
  }

  /**
   * Detect if running in Node.js
   */
  isNode(): boolean {
    // Must have process.versions.node and NOT be Bun
    if (typeof process !== 'undefined' && process.versions?.node && !this.isBun()) {
      return true
    }
    return false
  }

  /**
   * Detect if running in Bun
   */
  isBun(): boolean {
    // Check for global Bun object
    if (typeof (globalThis as any).Bun !== 'undefined') {
      return true
    }
    // Also check process.versions.bun
    if (typeof process !== 'undefined' && (process.versions as any)?.bun) {
      return true
    }
    return false
  }

  /**
   * Get the current runtime environment
   */
  getRuntime(): Runtime {
    if (this.cachedRuntime) {
      return this.cachedRuntime
    }

    if (this.isWorkerd()) {
      this.cachedRuntime = 'workerd'
    } else if (this.isBun()) {
      this.cachedRuntime = 'bun'
    } else if (this.isNode()) {
      this.cachedRuntime = 'node'
    } else {
      this.cachedRuntime = 'unknown'
    }

    return this.cachedRuntime
  }

  /**
   * Get Node.js version if running in Node
   */
  getNodeVersion(): string | undefined {
    if (typeof process !== 'undefined' && process.versions?.node) {
      return process.versions.node
    }
    return undefined
  }

  /**
   * Get Bun version if running in Bun
   */
  getBunVersion(): string | undefined {
    if (typeof (globalThis as any).Bun !== 'undefined') {
      return (globalThis as any).Bun.version
    }
    return undefined
  }

  /**
   * Detect if running in test environment
   */
  isTest(): boolean {
    // Get process reference at call time to support mocking
    const proc = typeof process !== 'undefined' ? process : (globalThis as any).process

    // Check for common test environment indicators
    if (proc?.env) {
      if (proc.env.VITEST === 'true') return true
      if (proc.env.JEST_WORKER_ID) return true
      if (proc.env.NODE_ENV === 'test') return true
    }
    return false
  }

  /**
   * Detect if running in production
   */
  isProduction(): boolean {
    // Check environment binding (for Workers)
    if (this.env.ENVIRONMENT === 'production') {
      return true
    }

    // Get process reference at call time to support mocking
    const proc = typeof process !== 'undefined' ? process : (globalThis as any).process

    // Check NODE_ENV
    if (proc?.env?.NODE_ENV === 'production') {
      return true
    }

    return false
  }

  /**
   * Detect if running in development
   */
  isDevelopment(): boolean {
    // If production or test, not development
    if (this.isProduction() || this.isTest()) {
      return false
    }

    // Check explicit development flag
    if (this.env.ENVIRONMENT === 'development') {
      return true
    }

    // Get process reference at call time to support mocking
    const proc = typeof process !== 'undefined' ? process : (globalThis as any).process

    if (proc?.env?.NODE_ENV === 'development') {
      return true
    }

    // Default to development if not production or test
    return true
  }

  /**
   * Check if WebCrypto API is available
   */
  hasWebCrypto(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
  }

  /**
   * Check if fetch API is available
   */
  hasFetch(): boolean {
    return typeof fetch === 'function'
  }

  /**
   * Check if SQLite is available (for libSQL support)
   */
  hasSQLite(): boolean {
    // In workerd, SQLite is not available natively
    if (this.isWorkerd()) {
      return false
    }

    // In Node.js or Bun, we can use better-sqlite3 or bun:sqlite
    if (this.isNode() || this.isBun()) {
      return true
    }

    return false
  }

  /**
   * Get complete environment information
   */
  getEnvironmentInfo(): EnvironmentInfo {
    return {
      runtime: this.getRuntime(),
      isProduction: this.isProduction(),
      isDevelopment: this.isDevelopment(),
      isTest: this.isTest(),
      features: {
        webCrypto: this.hasWebCrypto(),
        fetch: this.hasFetch(),
        sqlite: this.hasSQLite(),
      },
      nodeVersion: this.getNodeVersion(),
      bunVersion: this.getBunVersion(),
    }
  }
}

// Default singleton instance
export const runtime = new RuntimeDetection()

// Convenience exports
export const detectRuntime = (): Runtime => runtime.getRuntime()
export const isWorkerd = (): boolean => runtime.isWorkerd()
export const isNode = (): boolean => runtime.isNode()
export const isBun = (): boolean => runtime.isBun()
export const isProduction = (): boolean => runtime.isProduction()
export const isDevelopment = (): boolean => runtime.isDevelopment()
export const isTest = (): boolean => runtime.isTest()
