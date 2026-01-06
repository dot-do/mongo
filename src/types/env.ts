/**
 * Cloudflare Workers environment bindings for mongo.do
 *
 * These types define the bindings available in the Cloudflare Workers runtime.
 * Configure these in your wrangler.toml file.
 *
 * @see https://developers.cloudflare.com/workers/configuration/bindings/
 * @see https://developers.cloudflare.com/vectorize/
 * @see https://developers.cloudflare.com/workers-ai/
 *
 * @example
 * ```toml
 * # wrangler.toml
 * [[durable_objects.bindings]]
 * name = "MONDO_DATABASE"
 * class_name = "MondoDatabase"
 *
 * [[vectorize]]
 * binding = "VECTORIZE"
 * index_name = "my-index"
 *
 * [ai]
 * binding = "AI"
 * ```
 */

import type { DurableObjectNamespace } from '@cloudflare/workers-types'
import type { VectorizeIndex, Ai } from './vectorize'

/**
 * Environment interface for Cloudflare Workers
 *
 * This interface defines all bindings available to the mongo.do worker.
 * Required bindings must be configured in wrangler.toml.
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     // Access the Durable Object
 *     const id = env.MONDO_DATABASE.idFromName('default')
 *     const stub = env.MONDO_DATABASE.get(id)
 *     return stub.fetch(request)
 *   }
 * }
 * ```
 */
export interface Env {
  /**
   * Durable Object namespace for MondoDatabase instances
   */
  MONDO_DATABASE: DurableObjectNamespace

  /**
   * Optional Vectorize index binding for vector search
   */
  VECTORIZE?: VectorizeIndex

  /**
   * Optional Workers AI binding for generating embeddings
   */
  AI?: Ai

  /**
   * Optional embedding model to use (e.g., '@cf/baai/bge-m3')
   */
  EMBEDDING_MODEL?: string

  /**
   * Optional flag to enable/disable automatic embedding generation
   */
  EMBEDDING_ENABLED?: string
}
