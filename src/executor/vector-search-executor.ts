/**
 * VectorSearchExecutor - Executes vector similarity searches
 *
 * This class handles:
 * 1. Querying for similar vectors using VectorStorageAdapter or VectorizeIndex
 * 2. Retrieving document data from metadata
 * 3. Adding similarity scores to results
 * 4. Managing vector storage (insert, update, delete)
 */

import type { VectorizeIndex, VectorizeVector, VectorizeMatch } from '../types/vectorize'
import type { VectorStorageAdapter, VectorMatch } from '../storage/vector-types'

/**
 * Translation parameters for vector search execution
 */
export interface VectorSearchTranslation {
  /** The query vector for similarity search */
  queryVector: number[]
  /** Maximum number of results to return */
  limit: number
  /** Field name to store the similarity score */
  scoreField: string
}

/**
 * SQL interface for executing queries
 */
interface SqlInterface {
  exec: (query: string, ...params: unknown[]) => { results: unknown[]; toArray?: () => unknown[] }
}

/**
 * Options for VectorSearchExecutor constructor
 */
interface VectorSearchExecutorOptions {
  /** New abstraction layer adapter (preferred) */
  adapter?: VectorStorageAdapter
  /** Legacy Cloudflare Vectorize binding (for backward compatibility) */
  vectorize?: VectorizeIndex
}

/**
 * Check if an object is a VectorStorageAdapter
 */
function isVectorStorageAdapter(obj: unknown): obj is VectorStorageAdapter {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'vectorSearch' in obj &&
    'isAvailable' in obj &&
    typeof (obj as VectorStorageAdapter).vectorSearch === 'function' &&
    typeof (obj as VectorStorageAdapter).isAvailable === 'function'
  )
}

/**
 * Check if an object is a VectorizeIndex (legacy)
 */
function isVectorizeIndex(obj: unknown): obj is VectorizeIndex {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'query' in obj &&
    typeof (obj as VectorizeIndex).query === 'function'
  )
}

/**
 * Executes vector search operations using VectorStorageAdapter or Cloudflare Vectorize
 */
export class VectorSearchExecutor {
  private adapter?: VectorStorageAdapter
  private vectorize?: VectorizeIndex

  constructor(
    _sql: SqlInterface,
    options?: VectorSearchExecutorOptions | VectorizeIndex
  ) {
    // SQL interface available for potential future use

    if (!options) {
      return
    }

    // Handle both new options format and legacy VectorizeIndex
    if (isVectorizeIndex(options)) {
      // Legacy: passing VectorizeIndex directly
      this.vectorize = options
    } else if (isVectorStorageAdapter(options)) {
      // Direct adapter passed
      this.adapter = options
    } else {
      // Options object with adapter and/or vectorize
      const opts = options as VectorSearchExecutorOptions
      this.adapter = opts.adapter
      this.vectorize = opts.vectorize
    }
  }

  /**
   * Check if vector search is available
   */
  isVectorSearchAvailable(): boolean {
    if (this.adapter) {
      return this.adapter.isAvailable()
    }
    return !!this.vectorize
  }

  /**
   * Execute a vector search query
   *
   * @param translation - The translated vector search parameters
   * @param collection - The collection name
   * @returns Array of documents with similarity scores
   */
  async executeVectorSearch(
    translation: VectorSearchTranslation,
    collection: string
  ): Promise<Record<string, unknown>[]> {
    const { queryVector, limit, scoreField } = translation

    // Prefer adapter over legacy vectorize
    if (this.adapter) {
      return this.executeWithAdapter(queryVector, limit, scoreField, collection)
    }

    // Fall back to legacy Vectorize
    if (this.vectorize) {
      return this.executeWithVectorize(queryVector, limit, scoreField, collection)
    }

    throw new Error('Vectorize is not configured. Add VECTORIZE binding to your worker.')
  }

  /**
   * Execute vector search using VectorStorageAdapter
   */
  private async executeWithAdapter(
    queryVector: number[],
    limit: number,
    scoreField: string,
    collection: string
  ): Promise<Record<string, unknown>[]> {
    const matches = await this.adapter!.vectorSearch(collection, queryVector, { limit })

    return matches.map((match: VectorMatch) => ({
      ...match.metadata,
      _id: match.metadata?._id ?? match.documentId,
      [scoreField]: match.score
    }))
  }

  /**
   * Execute vector search using legacy VectorizeIndex
   */
  private async executeWithVectorize(
    queryVector: number[],
    limit: number,
    scoreField: string,
    collection: string
  ): Promise<Record<string, unknown>[]> {
    const queryResult = await this.vectorize!.query(queryVector, {
      topK: limit,
      returnMetadata: 'all'
    })

    const documents: Record<string, unknown>[] = []
    const collectionPrefix = `${collection}:`

    for (const match of queryResult.matches) {
      // Filter by collection prefix
      if (!match.id.startsWith(collectionPrefix)) {
        continue
      }

      // Extract document from metadata
      const doc = this.extractDocument(match)
      if (doc) {
        // Add similarity score
        doc[scoreField] = match.score
        documents.push(doc)
      }
    }

    return documents
  }

  /**
   * Upsert a vector for a document
   *
   * @param collection - The collection name
   * @param documentId - The document ID
   * @param vector - The embedding vector
   * @param document - The document data to store in metadata
   */
  async upsertVector(
    collection: string,
    documentId: string,
    vector: number[],
    document: Record<string, unknown>
  ): Promise<void> {
    // Prefer adapter over legacy vectorize
    if (this.adapter) {
      await this.adapter.upsertVector(collection, documentId, vector, document)
      return
    }

    if (!this.vectorize) {
      throw new Error('Vectorize is not configured. Add VECTORIZE binding to your worker.')
    }

    const vectorId = this.generateVectorId(collection, documentId)

    const vectorData: VectorizeVector = {
      id: vectorId,
      values: vector,
      metadata: {
        _data: JSON.stringify(document),
        _collection: collection,
        _documentId: documentId
      }
    }

    await this.vectorize.upsert([vectorData])
  }

  /**
   * Delete a vector for a document
   *
   * @param collection - The collection name
   * @param documentId - The document ID
   */
  async deleteVector(
    collection: string,
    documentId: string
  ): Promise<void> {
    // Prefer adapter over legacy vectorize
    if (this.adapter) {
      await this.adapter.deleteVector(collection, documentId)
      return
    }

    if (!this.vectorize) {
      throw new Error('Vectorize is not configured. Add VECTORIZE binding to your worker.')
    }

    const vectorId = this.generateVectorId(collection, documentId)
    await this.vectorize.deleteByIds([vectorId])
  }

  /**
   * Generate a unique vector ID from collection and document ID
   */
  private generateVectorId(collection: string, documentId: string): string {
    return `${collection}:${documentId}`
  }

  /**
   * Extract document from vector match metadata
   */
  private extractDocument(match: VectorizeMatch): Record<string, unknown> | null {
    if (!match.metadata || !match.metadata._data) {
      return null
    }

    try {
      const dataStr = match.metadata._data as string
      return JSON.parse(dataStr) as Record<string, unknown>
    } catch {
      return null
    }
  }
}
