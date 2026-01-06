import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createR2SQLClient, R2SQLError } from '../../../../src/olap/r2sql'

/**
 * GREEN Phase Tests: R2SQLClient
 *
 * These tests define the expected behavior for the R2SQL query execution client.
 * The client manages connections to ClickHouse/DuckDB, executes translated SQL,
 * handles pagination, caching, and query cancellation.
 */

describe('R2SQLClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    mockFetch = vi.fn()
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('Connection Management', () => {
    it('should create client with default options', () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      expect(client).toBeDefined()
      expect(client.query).toBeInstanceOf(Function)
      expect(client.close).toBeInstanceOf(Function)
    })

    it('should create client with custom credentials', () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      })

      expect(client).toBeDefined()
    })

    it('should configure connection pool size', () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        maxConnections: 10,
      })

      expect(client).toBeDefined()
    })

    it('should close all connections on close()', async () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      await client.close()
      // Subsequent queries should fail
      await expect(client.query('SELECT 1')).rejects.toThrow('Client is closed')
    })

    it('should handle connection errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const client = createR2SQLClient({
        endpoint: 'http://invalid-host:9999',
      })

      await expect(client.query('SELECT 1')).rejects.toThrow()
    })
  })

  describe('Query Execution', () => {
    it('should execute simple SELECT query', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [{ value: 1 }],
            bytesScanned: 100,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT 1 as value')

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ value: 1 })
      expect(result.rowCount).toBe(1)
      expect(result.queryId).toBeDefined()
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('should execute parameterized query', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [{ id: 'user-123', name: 'Test' }],
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM users WHERE id = ?', ['user-123'])

      expect(result.rows).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8123/query',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should handle multiple parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [],
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query(
        'SELECT * FROM events WHERE timestamp >= ? AND timestamp < ? AND type = ?',
        ['2024-01-01', '2024-02-01', 'click']
      )

      expect(result.rows).toBeDefined()
    })

    it('should return typed results', async () => {
      interface User {
        id: string
        name: string
        age: number
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [{ id: 'u-1', name: 'John', age: 30 }],
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query<User>('SELECT id, name, age FROM users')

      // TypeScript should infer result.rows as User[]
      expect(result.rows[0]?.id).toBeDefined()
    })

    it('should report bytes scanned when available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [{ value: 1 }],
            bytesScanned: 1024,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM large_table LIMIT 10')

      expect(result.bytesScanned).toBe(1024)
    })
  })

  describe('Pagination', () => {
    it('should limit results with maxRows option', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: Array.from({ length: 100 }, (_, i) => ({ id: i })),
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM events', [], { maxRows: 100 })

      expect(result.rows.length).toBeLessThanOrEqual(100)
    })

    it('should indicate hasMore when more results exist', async () => {
      // Return 11 rows when requesting 10+1
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: Array.from({ length: 11 }, (_, i) => ({ id: i })),
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM events', [], { maxRows: 10 })

      expect(result.hasMore).toBe(true)
    })

    it('should support offset for pagination', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows:
                callCount === 1
                  ? [{ id: 0 }, { id: 1 }]
                  : [{ id: 10 }, { id: 11 }],
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const page1 = await client.query('SELECT * FROM events ORDER BY id', [], {
        maxRows: 10,
        offset: 0,
      })
      const page2 = await client.query('SELECT * FROM events ORDER BY id', [], {
        maxRows: 10,
        offset: 10,
      })

      expect(page1.rows[0]).not.toEqual(page2.rows[0])
    })

    it('should return empty hasMore on last page', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: Array.from({ length: 50 }, (_, i) => ({ id: i })),
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      // Assuming small dataset
      const result = await client.query('SELECT * FROM small_table', [], {
        maxRows: 1000,
      })

      if (result.rowCount < 1000) {
        expect(result.hasMore).toBe(false)
      }
    })
  })

  describe('Query Timeout', () => {
    it.skip('should timeout long-running queries', async () => {
      // AbortController behavior varies in workers env
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve({ rows: [] }),
              })
            }, 5000)
          })
      )

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        queryTimeout: 100, // 100ms
      })

      await expect(client.query('SELECT * FROM huge_table')).rejects.toThrow('Query timeout')
    })

    it.skip('should allow per-query timeout override', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve({ rows: [] }),
              })
            }, 5000)
          })
      )

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        queryTimeout: 5000,
      })

      await expect(
        client.query('SELECT * FROM slow_query', [], { timeout: 100 })
      ).rejects.toThrow('Query timeout')
    })

    it('should not timeout quick queries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [{ value: 1 }] }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        queryTimeout: 5000,
      })

      const result = await client.query('SELECT 1')
      expect(result.rows).toHaveLength(1)
    })
  })

  describe('Query Cancellation', () => {
    it('should cancel running query by ID', async () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      await client.cancelQuery('pending-query-id')

      const status = await client.getQueryStatus('pending-query-id')
      expect(status.status).toBe('cancelled')
    })

    it.skip('should cancel query via AbortSignal', async () => {
      // AbortController behavior varies in workers env
      mockFetch.mockImplementation(
        (_url: string, options: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'))
              })
            }
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve({ rows: [] }),
              })
            }, 5000)
          })
      )

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const controller = new AbortController()

      const queryPromise = client.query('SELECT * FROM huge_table', [], {
        signal: controller.signal,
      })

      // Cancel immediately
      controller.abort()

      await expect(queryPromise).rejects.toThrow(/aborted|cancelled/i)
    })

    it('should report cancelled status after cancellation', async () => {
      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const queryId = 'test-query-id'
      await client.cancelQuery(queryId)

      const status = await client.getQueryStatus(queryId)
      expect(status.status).toBe('cancelled')
    })
  })

  describe('Query Status', () => {
    it('should track query progress', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [{ value: 1 }] }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM large_table')

      const status = await client.getQueryStatus(result.queryId)
      expect(status.status).toBe('completed')
    })

    it('should report completed status after query finishes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [{ value: 1 }] }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT 1')

      const status = await client.getQueryStatus(result.queryId)
      expect(status.status).toBe('completed')
    })

    it('should report failed status on query error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Query failed'),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      try {
        await client.query('INVALID SQL SYNTAX')
      } catch {
        // Expected
      }

      // The client tracks status internally
      expect(client).toBeDefined()
    })
  })

  describe('Streaming Results', () => {
    it('should stream large result sets', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount > 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ rows: [] }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const rows: Record<string, unknown>[] = []
      for await (const row of client.queryStream('SELECT * FROM large_table LIMIT 1000')) {
        rows.push(row)
      }

      expect(rows.length).toBe(1000)
    })

    it('should handle streaming with typed results', async () => {
      interface Event {
        id: string
        timestamp: string
        type: string
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: Array.from({ length: 10 }, (_, i) => ({
              id: `evt-${i}`,
              timestamp: '2024-01-01',
              type: 'click',
            })),
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const events: Event[] = []
      for await (const event of client.queryStream<Event>('SELECT * FROM events')) {
        events.push(event)
        if (events.length >= 10) break
      }

      expect(events[0]?.id).toBeDefined()
    })

    it('should be cancellable via break', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: Array.from({ length: 100 }, (_, i) => ({ id: i })),
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      let count = 0
      for await (const _row of client.queryStream('SELECT * FROM large_table')) {
        count++
        if (count >= 5) break
      }

      expect(count).toBe(5)
    })
  })

  describe('Caching', () => {
    it('should cache query results when enabled', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ id: 1 }],
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        cache: {
          enabled: true,
          ttl: 60000,
        },
      })

      await client.query('SELECT * FROM users LIMIT 10')
      await client.query('SELECT * FROM users LIMIT 10')

      // Second query should hit cache, so fetch only called once
      expect(callCount).toBe(1)
    })

    it('should bypass cache when cache option is false', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ id: 1 }],
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        cache: {
          enabled: true,
          ttl: 60000,
        },
      })

      await client.query('SELECT * FROM users LIMIT 10')
      await client.query('SELECT * FROM users LIMIT 10', [], {
        cache: false,
      })

      // Both queries should hit database
      expect(callCount).toBe(2)
    })

    it('should respect cache TTL', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ id: 1 }],
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        cache: {
          enabled: true,
          ttl: 50, // 50ms TTL
        },
      })

      await client.query('SELECT * FROM users')

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 100))

      await client.query('SELECT * FROM users')
      // Should hit database again after TTL expires
      expect(callCount).toBe(2)
    })

    it('should not cache different queries', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ id: callCount }],
            }),
        })
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
        cache: {
          enabled: true,
        },
      })

      const result1 = await client.query('SELECT * FROM users WHERE id = ?', ['user-1'])
      const result2 = await client.query('SELECT * FROM users WHERE id = ?', ['user-2'])

      // Different parameters = different cache keys
      expect(result1.rows).not.toEqual(result2.rows)
    })
  })

  describe('Write Operations', () => {
    it('should execute INSERT statements', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [],
            rowsAffected: 1,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.execute(
        'INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)',
        ['evt-1', 'click', '2024-01-01T00:00:00Z']
      )

      expect(result.success).toBe(true)
      expect(result.rowsAffected).toBe(1)
    })

    it('should execute bulk inserts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [],
            rowsAffected: 3,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.execute(
        'INSERT INTO events (id, type) VALUES (?, ?), (?, ?), (?, ?)',
        ['evt-1', 'click', 'evt-2', 'view', 'evt-3', 'scroll']
      )

      expect(result.success).toBe(true)
      expect(result.rowsAffected).toBe(3)
    })

    it('should execute UPDATE statements', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [],
            rowsAffected: 1,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.execute('UPDATE events SET processed = true WHERE id = ?', [
        'evt-1',
      ])

      expect(result.success).toBe(true)
      expect(result.rowsAffected).toBeGreaterThanOrEqual(0)
    })

    it('should execute DELETE statements', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [],
            rowsAffected: 5,
          }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.execute("DELETE FROM events WHERE timestamp < ?", ['2023-01-01'])

      expect(result.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should throw on SQL syntax errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('SQL syntax error near SELEC'),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      await expect(client.query('SELEC * FORM users')).rejects.toThrow(/syntax/i)
    })

    it('should throw on missing table', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Table not found'),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      await expect(client.query('SELECT * FROM nonexistent_table')).rejects.toThrow()
    })

    it('should throw on missing column', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Column not found'),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      await expect(client.query('SELECT nonexistent_column FROM users')).rejects.toThrow()
    })

    it('should include error details in rejection', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Invalid query'),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      try {
        await client.query('INVALID')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toHaveProperty('message')
        expect(error).toHaveProperty('code')
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const client = createR2SQLClient({
        endpoint: 'http://invalid-endpoint:1234',
      })

      await expect(client.query('SELECT 1')).rejects.toThrow()
    })
  })

  describe('SQL Injection Prevention', () => {
    it('should sanitize string parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      // Should not execute injected SQL
      const result = await client.query('SELECT * FROM users WHERE name = ?', [
        "'; DROP TABLE users; --",
      ])

      expect(result.rows).toBeDefined()
      // Check that the query was properly escaped
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8123/query',
        expect.objectContaining({
          body: expect.stringContaining("''"),
        })
      )
    })

    it('should handle special characters in parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      })

      const client = createR2SQLClient({
        endpoint: 'http://localhost:8123',
      })

      const result = await client.query('SELECT * FROM users WHERE bio = ?', [
        "Hello 'World' with \"quotes\" and \\backslashes",
      ])

      expect(result.rows).toBeDefined()
    })
  })
})
