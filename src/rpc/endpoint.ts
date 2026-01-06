/**
 * RPC Endpoint - Workers RPC handler for MondoBackend operations
 *
 * Implements:
 * - HTTP POST /rpc endpoint for JSON-RPC style calls
 * - Request validation and routing
 * - MongoDB-compatible error codes
 * - CORS support
 * - Authentication (optional)
 */

import type { ExecutionContext } from './worker-entrypoint'
import type {
  DurableObjectNamespace,
  HttpRpcRequest,
  HttpRpcSuccessResponse,
  HttpRpcErrorResponse,
  RpcHandler,
} from '../types/rpc'
import { ErrorCode } from '../types/rpc'

// Re-export types for backward compatibility
export type { RpcHandler }

/**
 * Rate limiting hook result
 */
export interface RateLimitResult {
  allowed: boolean
  retryAfter?: number // seconds until request should be retried
  remaining?: number // remaining requests in window
  limit?: number // total requests allowed in window
}

/**
 * Rate limiting hook function type
 */
export type RateLimitHook = (
  request: Request,
  method: string,
  clientId?: string
) => Promise<RateLimitResult> | RateLimitResult

/**
 * Environment with MONDO_DATABASE Durable Object binding
 */
export interface RpcEnv {
  MONDO_DATABASE: DurableObjectNamespace
  MONDO_AUTH_TOKEN?: string
  /** Optional rate limiting hook */
  rateLimitHook?: RateLimitHook
}

// Use the imported HttpRpcRequest type internally
type RpcRequest = HttpRpcRequest

// Use the imported response types internally
type RpcSuccessResponse = HttpRpcSuccessResponse
type RpcErrorResponse = HttpRpcErrorResponse

// ============================================================================
// MongoDB Error Codes (mapped for this module)
// ============================================================================

const ErrorCodes = {
  InternalError: { code: ErrorCode.INTERNAL_ERROR, name: 'InternalError' },
  BadValue: { code: ErrorCode.BAD_VALUE, name: 'BadValue' },
  Unauthorized: { code: ErrorCode.UNAUTHORIZED, name: 'Unauthorized' },
  NamespaceNotFound: { code: ErrorCode.NAMESPACE_NOT_FOUND, name: 'NamespaceNotFound' },
  CommandNotFound: { code: ErrorCode.COMMAND_NOT_FOUND, name: 'CommandNotFound' },
  DuplicateKey: { code: ErrorCode.DUPLICATE_KEY, name: 'DuplicateKey' },
} as const

// ============================================================================
// Method Definitions
// ============================================================================

/**
 * Methods that don't require db or collection
 */
const GLOBAL_METHODS = new Set(['listDatabases'])

/**
 * Methods that require db but not collection
 */
const DB_METHODS = new Set(['listCollections', 'createDatabase', 'dropDatabase', 'databaseExists', 'dbStats'])

/**
 * Methods that require both db and collection
 */
const COLLECTION_METHODS = new Set([
  'find',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'count',
  'countDocuments',
  'distinct',
  'aggregate',
  'createCollection',
  'dropCollection',
  'collectionExists',
  'collStats',
  'listIndexes',
  'createIndexes',
  'dropIndex',
  'dropIndexes',
  'getMore',
  'killCursors',
])

/**
 * All supported methods
 */
const SUPPORTED_METHODS = new Set([...GLOBAL_METHODS, ...DB_METHODS, ...COLLECTION_METHODS])

/**
 * Write methods (cannot be called on system collections)
 */
const WRITE_METHODS = new Set([
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'createIndexes',
  'dropIndex',
  'dropIndexes',
])

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mondo-Token, Accept-Encoding',
  'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-ID',
  'Access-Control-Max-Age': '86400',
}

/**
 * Read-only methods that can be cached
 */
const CACHEABLE_METHODS = new Set(['find', 'count', 'countDocuments', 'listDatabases', 'listCollections', 'listIndexes', 'collStats', 'dbStats'])

/**
 * Get cache headers based on method
 */
function getCacheHeaders(method: string): Record<string, string> {
  if (CACHEABLE_METHODS.has(method)) {
    return {
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'Vary': 'Authorization, Accept-Encoding',
    }
  }
  return {
    'Cache-Control': 'no-store',
  }
}

/**
 * Get rate limit headers if rate limit info is available
 */
function getRateLimitHeaders(rateLimitResult?: RateLimitResult): Record<string, string> {
  if (!rateLimitResult) return {}

  const headers: Record<string, string> = {}

  if (rateLimitResult.limit !== undefined) {
    headers['X-RateLimit-Limit'] = String(rateLimitResult.limit)
  }
  if (rateLimitResult.remaining !== undefined) {
    headers['X-RateLimit-Remaining'] = String(rateLimitResult.remaining)
  }
  if (rateLimitResult.retryAfter !== undefined) {
    headers['X-RateLimit-Reset'] = String(Math.ceil(Date.now() / 1000) + rateLimitResult.retryAfter)
    headers['Retry-After'] = String(rateLimitResult.retryAfter)
  }

  return headers
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a success response with optional caching and rate limit headers
 */
function successResponse(
  result: unknown,
  method?: string,
  rateLimitResult?: RateLimitResult,
  requestId?: string
): Response {
  const body: RpcSuccessResponse = { ok: 1, result }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
    ...(method ? getCacheHeaders(method) : {}),
    ...getRateLimitHeaders(rateLimitResult),
  }

  if (requestId) {
    headers['X-Request-ID'] = requestId
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  })
}

/**
 * Create an error response with optional rate limit headers
 */
function errorResponse(
  message: string,
  errorCode: { code: number; name: string },
  status = 400,
  rateLimitResult?: RateLimitResult,
  requestId?: string
): Response {
  const body: RpcErrorResponse = {
    ok: 0,
    error: message,
    code: errorCode.code,
    codeName: errorCode.name,
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
    ...getRateLimitHeaders(rateLimitResult),
  }

  if (requestId) {
    headers['X-Request-ID'] = requestId
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  })
}

/**
 * Validate database name
 */
function isValidDbName(name: string | undefined): name is string {
  return typeof name === 'string' && name.length > 0
}

/**
 * Validate collection name
 */
function isValidCollectionName(name: string | undefined): name is string {
  return typeof name === 'string' && name.length > 0
}

/**
 * Check if collection is a system collection
 */
function isSystemCollection(name: string): boolean {
  return name.startsWith('system.')
}

/**
 * Timing-safe string comparison to prevent timing attacks
 *
 * Compares strings in constant time, preventing attackers from
 * inferring token values through timing analysis.
 *
 * Security note: When lengths differ, we still perform a constant-time
 * comparison against a buffer of equal length to avoid leaking length
 * information through timing differences.
 */
function safeCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)

  if (bufA.length !== bufB.length) {
    // Do a dummy comparison to maintain constant time
    let result = 0
    for (let i = 0; i < bufA.length; i++) {
      result |= (bufA[i] ?? 0) ^ (bufA[i] ?? 0)
    }
    return false
  }

  // Timing-safe comparison
  let result = 0
  for (let i = 0; i < bufA.length; i++) {
    result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0)
  }
  return result === 0
}

// ============================================================================
// RPC Handler Implementation
// ============================================================================

/**
 * Create an RPC handler for the given environment
 */
export function createRpcHandler(env: RpcEnv, _ctx: ExecutionContext): RpcHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      // Extract request ID for tracing
      const requestId = request.headers.get('X-Request-ID') ?? undefined

      // Handle OPTIONS preflight request
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        })
      }

      // Only accept POST requests
      if (request.method !== 'POST') {
        return errorResponse('Method not allowed. Use POST.', ErrorCodes.BadValue, 405, undefined, requestId)
      }

      // Check content type
      const contentType = request.headers.get('Content-Type')
      if (!contentType?.includes('application/json')) {
        return errorResponse(
          'Invalid Content-Type. Expected application/json.',
          ErrorCodes.BadValue,
          400,
          undefined,
          requestId
        )
      }

      // Authenticate if auth token is configured
      if (env.MONDO_AUTH_TOKEN) {
        const authHeader = request.headers.get('Authorization')
        const tokenHeader = request.headers.get('X-Mondo-Token')

        let token: string | null = null

        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.slice(7)
        } else if (tokenHeader) {
          token = tokenHeader
        }

        if (!token || !safeCompare(token, env.MONDO_AUTH_TOKEN)) {
          return errorResponse('Unauthorized', ErrorCodes.Unauthorized, 401, undefined, requestId)
        }
      }

      // Parse request body
      let body: RpcRequest
      try {
        const text = await request.text()
        if (!text) {
          return errorResponse('Empty request body', ErrorCodes.BadValue, 400, undefined, requestId)
        }
        body = JSON.parse(text) as RpcRequest
      } catch {
        return errorResponse('Invalid JSON body', ErrorCodes.BadValue, 400, undefined, requestId)
      }

      // Validate method
      if (!body.method) {
        return errorResponse('Missing required field: method', ErrorCodes.BadValue, 400, undefined, requestId)
      }

      if (!SUPPORTED_METHODS.has(body.method)) {
        return errorResponse(
          `Unknown method: ${body.method}`,
          ErrorCodes.CommandNotFound,
          400,
          undefined,
          requestId
        )
      }

      // Rate limiting check (if hook is configured)
      let rateLimitResult: RateLimitResult | undefined
      if (env.rateLimitHook) {
        const clientId = request.headers.get('Authorization') ?? request.headers.get('CF-Connecting-IP') ?? undefined
        rateLimitResult = await env.rateLimitHook(request, body.method, clientId)

        if (!rateLimitResult.allowed) {
          return errorResponse(
            'Rate limit exceeded',
            { code: 429, name: 'TooManyRequests' },
            429,
            rateLimitResult,
            requestId
          )
        }
      }

      // Validate db parameter for methods that require it
      if (DB_METHODS.has(body.method) || COLLECTION_METHODS.has(body.method)) {
        if (!isValidDbName(body.db)) {
          return errorResponse(
            'Missing required field: db',
            ErrorCodes.BadValue,
            400,
            rateLimitResult,
            requestId
          )
        }
      }

      // Validate collection parameter for methods that require it
      if (COLLECTION_METHODS.has(body.method)) {
        if (!isValidCollectionName(body.collection)) {
          return errorResponse(
            'Missing required field: collection',
            ErrorCodes.BadValue,
            400,
            rateLimitResult,
            requestId
          )
        }

        // Check for writes to system collections
        if (WRITE_METHODS.has(body.method) && isSystemCollection(body.collection)) {
          return errorResponse(
            `Cannot write to system collection: ${body.collection}`,
            ErrorCodes.Unauthorized,
            403,
            rateLimitResult,
            requestId
          )
        }
      }

      // Validate method-specific parameters
      const validationError = validateMethodParams(body, rateLimitResult, requestId)
      if (validationError) {
        return validationError
      }

      // Route to Durable Object
      try {
        const result = await routeToDurableObject(env, body)
        return successResponse(result, body.method, rateLimitResult, requestId)
      } catch (error) {
        return handleError(error, rateLimitResult, requestId)
      }
    },
  }
}

/**
 * Validate method-specific parameters
 */
function validateMethodParams(
  body: RpcRequest,
  rateLimitResult?: RateLimitResult,
  requestId?: string
): Response | null {
  switch (body.method) {
    case 'insertMany':
      if (!body.documents || !Array.isArray(body.documents)) {
        return errorResponse(
          'Missing required field: documents',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break

    case 'updateOne':
    case 'updateMany':
      if (!body.filter || typeof body.filter !== 'object') {
        return errorResponse(
          'Missing required field: filter',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      if (!body.update || typeof body.update !== 'object') {
        return errorResponse(
          'Missing required field: update',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break

    case 'deleteOne':
    case 'deleteMany':
      if (!body.filter || typeof body.filter !== 'object') {
        return errorResponse(
          'Missing required field: filter',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break

    case 'aggregate':
      if (!body.pipeline) {
        return errorResponse(
          'Missing required field: pipeline',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      if (!Array.isArray(body.pipeline)) {
        return errorResponse(
          'pipeline must be an array',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break

    case 'distinct':
      if (!body.field || typeof body.field !== 'string') {
        return errorResponse(
          'Missing required field: field',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break

    case 'find':
      // filter is optional for find, but if provided must be an object
      if (body.filter !== undefined && typeof body.filter !== 'object') {
        return errorResponse(
          'filter must be an object',
          ErrorCodes.BadValue,
          400,
          rateLimitResult,
          requestId
        )
      }
      break
  }

  return null
}

/**
 * Route request to the appropriate Durable Object
 */
async function routeToDurableObject(
  env: RpcEnv,
  body: RpcRequest
): Promise<unknown> {
  // Get the Durable Object stub for the database
  const dbName = body.db || 'admin'
  const id = env.MONDO_DATABASE.idFromName(dbName)
  const stub = env.MONDO_DATABASE.get(id)

  // Build the internal request based on method
  const internalPath = `http://internal/${body.method}`
  const internalBody = buildInternalBody(body)

  const response = await stub.fetch(internalPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(internalBody),
  })

  // Check for errors from the Durable Object
  if (!response.ok) {
    const errorData = await response.json().catch(() => null) as {
      error?: string
      code?: number
    } | null
    if (errorData?.error) {
      const error = new Error(errorData.error) as Error & { code?: number }
      if (errorData.code !== undefined) {
        error.code = errorData.code
      }
      throw error
    }
    throw new Error(`Durable Object returned status ${response.status}`)
  }

  return response.json()
}

/**
 * Build the internal request body for the Durable Object
 */
function buildInternalBody(body: RpcRequest): Record<string, unknown> {
  const internalBody: Record<string, unknown> = {}

  if (body.collection) {
    internalBody.collection = body.collection
  }

  if (body.filter) {
    internalBody.filter = body.filter
  }

  if (body.update) {
    internalBody.update = body.update
  }

  if (body.document) {
    internalBody.document = body.document
  }

  if (body.documents) {
    internalBody.documents = body.documents
  }

  if (body.pipeline) {
    internalBody.pipeline = body.pipeline
  }

  if (body.options) {
    // Merge options into the body
    Object.assign(internalBody, body.options)
  }

  if (body.field) {
    internalBody.field = body.field
  }

  if (body.query) {
    internalBody.query = body.query
  }

  return internalBody
}

/**
 * Handle errors and convert to appropriate responses
 */
function handleError(
  error: unknown,
  rateLimitResult?: RateLimitResult,
  requestId?: string
): Response {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: number }

    // Map error codes to MongoDB error codes
    if (errorWithCode.code === 26) {
      return errorResponse(
        error.message,
        ErrorCodes.NamespaceNotFound,
        404,
        rateLimitResult,
        requestId
      )
    }

    if (errorWithCode.code === 11000) {
      return errorResponse(
        error.message,
        ErrorCodes.DuplicateKey,
        409,
        rateLimitResult,
        requestId
      )
    }

    if (errorWithCode.code === 13) {
      return errorResponse(
        error.message,
        ErrorCodes.Unauthorized,
        401,
        rateLimitResult,
        requestId
      )
    }

    // Default to internal error
    return errorResponse(
      error.message,
      ErrorCodes.InternalError,
      500,
      rateLimitResult,
      requestId
    )
  }

  return errorResponse(
    'Unknown error',
    ErrorCodes.InternalError,
    500,
    rateLimitResult,
    requestId
  )
}

// ============================================================================
// JSON-RPC 2.0 Handler
// ============================================================================

/**
 * JSON-RPC 2.0 Handler interface
 *
 * This handler implements the JSON-RPC 2.0 specification:
 * - Request: { jsonrpc: "2.0", id: string|number, method: string, params: object|array }
 * - Response: { jsonrpc: "2.0", id: string|number, result: any }
 * - Error: { jsonrpc: "2.0", id: string|number|null, error: { code, message, data? } }
 */
export interface JsonRpcHandler {
  fetch(request: Request): Promise<Response>
}

/**
 * JSON-RPC 2.0 Standard Error Codes
 */
const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Server error range for application-specific errors
  SERVER_ERROR_AUTH: -32000, // Authentication error
} as const

/**
 * JSON-RPC 2.0 Request structure
 */
interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown> | unknown[]
}

/**
 * JSON-RPC 2.0 Success Response
 */
interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

/**
 * JSON-RPC 2.0 Error Response
 */
interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: string | number | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

/**
 * Create a JSON-RPC success response
 */
function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

/**
 * Create a JSON-RPC error response
 */
function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined && { data }),
    },
  }
}

/**
 * Create a JSON-RPC 2.0 handler for the given environment
 *
 * Implements JSON-RPC 2.0 protocol support:
 * - Parse JSON-RPC formatted requests
 * - Return JSON-RPC formatted responses
 * - Handle batch requests
 * - Support notifications (requests without id)
 * - Return standard JSON-RPC error codes:
 *   - -32700: Parse error
 *   - -32600: Invalid Request
 *   - -32601: Method not found
 *   - -32602: Invalid params
 *   - -32603: Internal error
 */
export function createJsonRpcHandler(env: RpcEnv, _ctx: ExecutionContext): JsonRpcHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      // Handle OPTIONS preflight request
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        })
      }

      // Only accept POST requests
      if (request.method !== 'POST') {
        return jsonRpcErrorResponse(
          jsonRpcError(null, JsonRpcErrorCodes.INVALID_REQUEST, 'Method not allowed. Use POST.'),
          405
        )
      }

      // Check content type
      const contentType = request.headers.get('Content-Type')
      if (!contentType?.includes('application/json')) {
        return jsonRpcErrorResponse(
          jsonRpcError(null, JsonRpcErrorCodes.INVALID_REQUEST, 'Invalid Content-Type. Expected application/json.'),
          400
        )
      }

      // Parse request body
      let body: JsonRpcRequest | JsonRpcRequest[]
      try {
        const text = await request.text()
        if (!text) {
          return jsonRpcErrorResponse(
            jsonRpcError(null, JsonRpcErrorCodes.PARSE_ERROR, 'Parse error: Empty request body'),
            400
          )
        }
        body = JSON.parse(text) as JsonRpcRequest | JsonRpcRequest[]
      } catch {
        return jsonRpcErrorResponse(
          jsonRpcError(null, JsonRpcErrorCodes.PARSE_ERROR, 'Parse error: Invalid JSON'),
          400
        )
      }

      // Authenticate if auth token is configured
      if (env.MONDO_AUTH_TOKEN) {
        const authHeader = request.headers.get('Authorization')
        const tokenHeader = request.headers.get('X-Mondo-Token')

        let token: string | null = null

        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.slice(7)
        } else if (tokenHeader) {
          token = tokenHeader
        }

        if (!token || !safeCompare(token, env.MONDO_AUTH_TOKEN)) {
          return jsonRpcErrorResponse(
            jsonRpcError(null, JsonRpcErrorCodes.SERVER_ERROR_AUTH, 'Unauthorized'),
            401
          )
        }
      }

      // Handle batch requests
      if (Array.isArray(body)) {
        return handleBatchRequest(env, body)
      }

      // Handle single request
      return handleSingleRequest(env, body)
    },
  }
}

/**
 * Handle a single JSON-RPC request
 */
async function handleSingleRequest(env: RpcEnv, body: JsonRpcRequest): Promise<Response> {
  const id = body.id ?? null
  const isNotification = body.id === undefined

  // Validate jsonrpc version
  if (body.jsonrpc !== '2.0') {
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return jsonRpcErrorResponse(
      jsonRpcError(id, JsonRpcErrorCodes.INVALID_REQUEST, 'Invalid Request: Missing or invalid jsonrpc version'),
      200
    )
  }

  // Validate method
  if (!body.method || typeof body.method !== 'string') {
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return jsonRpcErrorResponse(
      jsonRpcError(id, JsonRpcErrorCodes.INVALID_REQUEST, 'Invalid Request: Missing method'),
      200
    )
  }

  // Validate params - must be object or array, but also check if required params are provided
  // For most methods, params is required and must be an object
  const methodsRequiringParams = new Set([
    'find', 'insertOne', 'insertMany', 'updateOne', 'updateMany',
    'deleteOne', 'deleteMany', 'aggregate', 'count', 'distinct',
    'listCollections', 'createIndexes', 'listIndexes', 'dropIndex',
    'getMore', 'killCursors'
  ])

  if (body.params !== undefined && typeof body.params !== 'object') {
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return jsonRpcErrorResponse(
      jsonRpcError(id, JsonRpcErrorCodes.INVALID_PARAMS, 'Invalid params: Must be object or array'),
      200
    )
  }

  if (methodsRequiringParams.has(body.method) && body.params === undefined) {
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return jsonRpcErrorResponse(
      jsonRpcError(id, JsonRpcErrorCodes.INVALID_PARAMS, 'Invalid params: params is required for this method'),
      200
    )
  }

  // Check if method is supported
  // Also support 'insertOne' which is similar to insertMany but with a single document
  const allSupportedMethods = new Set([...SUPPORTED_METHODS, 'insertOne'])
  if (!allSupportedMethods.has(body.method)) {
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return jsonRpcErrorResponse(
      jsonRpcError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Method not found: ${body.method}`),
      200
    )
  }

  // Execute the method
  try {
    const result = await executeJsonRpcMethod(env, body.method, body.params as Record<string, unknown> | undefined)

    // For notifications, don't return a response
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    return jsonRpcSuccessResponse(jsonRpcSuccess(id, result))
  } catch (error) {
    // For notifications, don't return error responses either
    if (isNotification) {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    return handleJsonRpcError(id, error)
  }
}

/**
 * Handle a batch of JSON-RPC requests
 */
async function handleBatchRequest(env: RpcEnv, batch: JsonRpcRequest[]): Promise<Response> {
  const responses: JsonRpcResponse[] = []

  for (const request of batch) {
    const id = request.id ?? null
    const isNotification = request.id === undefined

    // Validate jsonrpc version
    if (request.jsonrpc !== '2.0') {
      if (!isNotification) {
        responses.push(
          jsonRpcError(id, JsonRpcErrorCodes.INVALID_REQUEST, 'Invalid Request: Missing or invalid jsonrpc version')
        )
      }
      continue
    }

    // Validate method
    if (!request.method || typeof request.method !== 'string') {
      if (!isNotification) {
        responses.push(
          jsonRpcError(id, JsonRpcErrorCodes.INVALID_REQUEST, 'Invalid Request: Missing method')
        )
      }
      continue
    }

    // Check if method is supported
    const allSupportedMethods = new Set([...SUPPORTED_METHODS, 'insertOne'])
    if (!allSupportedMethods.has(request.method)) {
      if (!isNotification) {
        responses.push(
          jsonRpcError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Method not found: ${request.method}`)
        )
      }
      continue
    }

    // Execute the method
    try {
      const result = await executeJsonRpcMethod(env, request.method, request.params as Record<string, unknown> | undefined)

      // Only add response for non-notifications
      if (!isNotification) {
        responses.push(jsonRpcSuccess(id, result))
      }
    } catch (error) {
      // Only add error response for non-notifications
      if (!isNotification) {
        if (error instanceof Error) {
          const errorWithCode = error as Error & { code?: number; data?: unknown }
          responses.push(
            jsonRpcError(
              id,
              mapMongoErrorToJsonRpcCode(errorWithCode.code),
              error.message,
              errorWithCode.data
            )
          )
        } else {
          responses.push(
            jsonRpcError(id, JsonRpcErrorCodes.INTERNAL_ERROR, 'Internal error')
          )
        }
      }
    }
  }

  return new Response(JSON.stringify(responses), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}

/**
 * Execute a JSON-RPC method
 */
async function executeJsonRpcMethod(
  env: RpcEnv,
  method: string,
  params: Record<string, unknown> | undefined
): Promise<unknown> {
  // Get the Durable Object stub for the database
  const dbName = (params?.db as string) || 'admin'
  const id = env.MONDO_DATABASE.idFromName(dbName)
  const stub = env.MONDO_DATABASE.get(id)

  // Build the internal request
  const internalPath = `http://internal/${method}`
  const internalBody = buildJsonRpcInternalBody(params)

  const response = await stub.fetch(internalPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(internalBody),
  })

  // Check for errors from the Durable Object
  if (!response.ok) {
    const errorData = await response.json().catch(() => null) as {
      error?: string
      code?: number
    } | null
    if (errorData?.error) {
      const error = new Error(errorData.error) as Error & { code?: number; data?: unknown }
      if (errorData.code !== undefined) {
        error.code = errorData.code
      }
      error.data = errorData
      throw error
    }
    throw new Error(`Durable Object returned status ${response.status}`)
  }

  return response.json()
}

/**
 * Build the internal request body for JSON-RPC
 */
function buildJsonRpcInternalBody(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) {
    return {}
  }

  const internalBody: Record<string, unknown> = {}

  // Copy relevant params to internal body
  if (params.collection) {
    internalBody.collection = params.collection
  }

  if (params.filter) {
    internalBody.filter = params.filter
  }

  if (params.update) {
    internalBody.update = params.update
  }

  if (params.document) {
    internalBody.document = params.document
  }

  if (params.documents) {
    internalBody.documents = params.documents
  }

  if (params.pipeline) {
    internalBody.pipeline = params.pipeline
  }

  if (params.options) {
    // Merge options into the body
    Object.assign(internalBody, params.options)
  }

  if (params.field) {
    internalBody.field = params.field
  }

  if (params.query) {
    internalBody.query = params.query
  }

  return internalBody
}

/**
 * Map MongoDB error codes to JSON-RPC error codes
 */
function mapMongoErrorToJsonRpcCode(_mongoCode: number | undefined): number {
  // For backend errors, use the internal error code
  // But preserve the original code in the data field
  return JsonRpcErrorCodes.INTERNAL_ERROR
}

/**
 * Handle JSON-RPC errors
 */
function handleJsonRpcError(id: string | number | null, error: unknown): Response {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: number; data?: unknown }

    return jsonRpcErrorResponse(
      jsonRpcError(
        id,
        JsonRpcErrorCodes.INTERNAL_ERROR,
        error.message,
        errorWithCode.data
      ),
      200
    )
  }

  return jsonRpcErrorResponse(
    jsonRpcError(id, JsonRpcErrorCodes.INTERNAL_ERROR, 'Internal error'),
    200
  )
}

/**
 * Create a JSON-RPC response
 */
function jsonRpcSuccessResponse(body: JsonRpcSuccessResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}

/**
 * Create a JSON-RPC error response
 */
function jsonRpcErrorResponse(body: JsonRpcErrorResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}
