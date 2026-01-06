/**
 * VectorizeStorageAdapter
 *
 * Wraps Cloudflare Vectorize in the VectorStorageAdapter interface,
 * enabling consistent vector storage operations across different backends.
 */

import type { VectorizeIndex, VectorizeVector, VectorizeMatch } from '../../types/vectorize'
import type { VectorStorageAdapter, VectorSearchOptions, VectorMatch } from '../vector-types'

/**
 * Adapter that wraps Cloudflare Vectorize to implement VectorStorageAdapter
 */
export class VectorizeStorageAdapter implements VectorStorageAdapter {
  private vectorize: VectorizeIndex

  constructor(vectorize: VectorizeIndex) {
    if (!vectorize) {
      throw new Error('VectorizeIndex binding is required')
    }
    this.vectorize = vectorize
  }

  /**
   * Generate a unique vector ID from collection and document ID
   * Format: collection:documentId
   */
  private generateVectorId(collection: string, documentId: string): string {
    return `${collection}:${documentId}`
  }

  /**
   * Parse a vector ID into its components
   */
  private parseVectorId(vectorId: string): { collection: string; documentId: string } {
    const colonIndex = vectorId.indexOf(':')
    if (colonIndex === -1) {
      return { collection: '', documentId: vectorId }
    }
    return {
      collection: vectorId.substring(0, colonIndex),
      documentId: vectorId.substring(colonIndex + 1),
    }
  }

  /**
   * Upsert a vector for a document
   */
  async upsertVector(
    collection: string,
    documentId: string,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const vectorId = this.generateVectorId(collection, documentId)

    const vectorData: VectorizeVector = {
      id: vectorId,
      values: vector,
      metadata: {
        ...metadata,
        _collection: collection,
        _documentId: documentId,
      },
    }

    await this.vectorize.upsert([vectorData])
  }

  /**
   * Delete a vector for a document
   */
  async deleteVector(collection: string, documentId: string): Promise<void> {
    const vectorId = this.generateVectorId(collection, documentId)
    await this.vectorize.deleteByIds([vectorId])
  }

  /**
   * Search for similar vectors
   */
  async vectorSearch(
    collection: string,
    queryVector: number[],
    options: VectorSearchOptions = { limit: 10 }
  ): Promise<VectorMatch[]> {
    const result = await this.vectorize.query(queryVector, {
      topK: options.limit,
      returnMetadata: 'all',
    })

    const collectionPrefix = `${collection}:`

    return result.matches
      .filter((match) => match.id.startsWith(collectionPrefix))
      .map((match) => this.mapVectorizeMatch(match))
  }

  /**
   * Map a Vectorize match to our VectorMatch format
   */
  private mapVectorizeMatch(match: VectorizeMatch): VectorMatch {
    const { documentId } = this.parseVectorId(match.id)

    // Extract metadata, removing internal fields
    const metadata = match.metadata ? { ...match.metadata } : {}
    delete metadata._collection
    delete metadata._documentId

    return {
      documentId: (match.metadata?._documentId as string) || documentId,
      score: match.score,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
  }

  /**
   * Check if vectorize is available
   */
  isAvailable(): boolean {
    return !!this.vectorize
  }

  /**
   * Get the underlying VectorizeIndex (for advanced operations)
   */
  getVectorize(): VectorizeIndex {
    return this.vectorize
  }
}

/**
 * Create a VectorizeStorageAdapter from a VectorizeIndex binding
 */
export function createVectorizeAdapter(vectorize: VectorizeIndex): VectorizeStorageAdapter {
  return new VectorizeStorageAdapter(vectorize)
}
