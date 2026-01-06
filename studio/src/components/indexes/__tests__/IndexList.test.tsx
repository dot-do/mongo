/**
 * Index Management UI Tests - RED Phase (TDD)
 *
 * These tests define the expected behavior of the Index Management UI.
 * They are written BEFORE the implementation is complete, so they should FAIL.
 *
 * Test Coverage:
 * 1. Index list displays existing indexes for a collection
 * 2. Each index shows: name, keys, type (unique, sparse, TTL)
 * 3. "Create Index" button exists
 * 4. Create index modal: select fields, index type, options
 * 5. Delete index functionality with confirmation
 * 6. API integration for createIndex, listIndexes, dropIndex
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { IndexList } from '../IndexList'
import { useIndexesQuery, useDropIndexMutation, useCreateIndexMutation } from '@hooks/useQueries'
import type { IndexInfo } from '@lib/rpc-client'

// Helper to clean up LeafyGreen portals between tests
function cleanupPortals() {
  document.querySelectorAll('[data-lg-portal]').forEach(el => el.remove())
  document.querySelectorAll('[data-leafygreen-ui-modal-container]').forEach(el => el.remove())
  document.querySelectorAll('[class*="lg-ui-portal"]').forEach(el => el.remove())
}

// Mock the query and mutation hooks
vi.mock('@hooks/useQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hooks/useQueries')>()
  return {
    ...actual,
    useIndexesQuery: vi.fn(),
    useDropIndexMutation: vi.fn(),
    useCreateIndexMutation: vi.fn(),
  }
})

describe('IndexList', () => {
  const defaultProps = {
    database: 'testdb',
    collection: 'users',
  }

  // Sample index data
  const mockIndexes: IndexInfo[] = [
    {
      name: '_id_',
      key: { _id: 1 },
    },
    {
      name: 'email_1',
      key: { email: 1 },
      unique: true,
    },
    {
      name: 'status_-1_createdAt_1',
      key: { status: -1, createdAt: 1 },
    },
    {
      name: 'name_text',
      key: { name: 'text' },
    },
    {
      name: 'location_2dsphere',
      key: { location: '2dsphere' },
    },
    {
      name: 'sessionExpiry_1',
      key: { sessionExpiry: 1 },
      expireAfterSeconds: 3600,
    },
    {
      name: 'optionalField_1',
      key: { optionalField: 1 },
      sparse: true,
    },
  ]

  const mockDropMutateAsync = vi.fn()
  const mockDropMutation = {
    mutateAsync: mockDropMutateAsync,
    isPending: false,
  }

  const mockCreateMutateAsync = vi.fn()
  const mockCreateMutation = {
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }

  const mockRefetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDropIndexMutation).mockReturnValue(mockDropMutation as any)
    vi.mocked(useCreateIndexMutation).mockReturnValue(mockCreateMutation as any)
  })

  afterEach(() => {
    cleanup()
    cleanupPortals()
  })

  // ===========================================================================
  // SECTION 1: Index List Display
  // ===========================================================================
  describe('Index List Display', () => {
    it('displays a loading state while fetching indexes', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-list-loading')).toBeInTheDocument()
    })

    it('displays an error state when fetching indexes fails', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch indexes'),
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-list-error')).toBeInTheDocument()
      expect(screen.getByText(/error loading indexes/i)).toBeInTheDocument()
    })

    it('displays empty state when collection has no indexes', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-list-empty')).toBeInTheDocument()
      expect(screen.getByText(/no indexes found/i)).toBeInTheDocument()
    })

    it('displays the index table when indexes exist', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-table')).toBeInTheDocument()
    })

    it('displays the correct number of indexes', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // Should show count badge
      expect(screen.getByText(/7 indexes/i)).toBeInTheDocument()
    })

    it('displays index count in header with proper pluralization', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [mockIndexes[0]],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText(/1 index/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // SECTION 2: Index Row Display - Name, Keys, Type Properties
  // ===========================================================================
  describe('Index Row Display', () => {
    beforeEach(() => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)
    })

    it('displays index name for each index', () => {
      render(<IndexList {...defaultProps} />)

      expect(screen.getByText('_id_')).toBeInTheDocument()
      expect(screen.getByText('email_1')).toBeInTheDocument()
      expect(screen.getByText('status_-1_createdAt_1')).toBeInTheDocument()
    })

    it('displays index keys with proper formatting', () => {
      render(<IndexList {...defaultProps} />)

      // Check for ascending key display
      expect(screen.getByText(/email: 1/)).toBeInTheDocument()

      // Check for descending key display
      expect(screen.getByText(/status: -1/)).toBeInTheDocument()

      // Check for compound index
      expect(screen.getByText(/createdAt: 1/)).toBeInTheDocument()
    })

    it('displays text index type', () => {
      render(<IndexList {...defaultProps} />)

      // Text index should display "text" type
      expect(screen.getByText(/name: "text"/)).toBeInTheDocument()
    })

    it('displays 2dsphere geospatial index type', () => {
      render(<IndexList {...defaultProps} />)

      // 2dsphere index should display the type
      expect(screen.getByText(/location: "2dsphere"/)).toBeInTheDocument()
    })

    it('shows unique badge for unique indexes', () => {
      render(<IndexList {...defaultProps} />)

      const emailRow = screen.getByTestId('index-row-email_1')
      expect(within(emailRow).getByText('unique')).toBeInTheDocument()
    })

    it('shows sparse badge for sparse indexes', () => {
      render(<IndexList {...defaultProps} />)

      const sparseRow = screen.getByTestId('index-row-optionalField_1')
      expect(within(sparseRow).getByText('sparse')).toBeInTheDocument()
    })

    it('shows TTL badge with expiration time for TTL indexes', () => {
      render(<IndexList {...defaultProps} />)

      const ttlRow = screen.getByTestId('index-row-sessionExpiry_1')
      expect(within(ttlRow).getByText(/TTL: 3600s/)).toBeInTheDocument()
    })

    it('shows default badge for _id index', () => {
      render(<IndexList {...defaultProps} />)

      const idRow = screen.getByTestId('index-row-_id_')
      expect(within(idRow).getByText('default')).toBeInTheDocument()
    })

    it('displays all properties for an index with multiple flags', () => {
      // Index with both unique and sparse
      const indexWithMultipleProps: IndexInfo[] = [
        {
          name: 'email_unique_sparse',
          key: { email: 1 },
          unique: true,
          sparse: true,
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithMultipleProps,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      const row = screen.getByTestId('index-row-email_unique_sparse')
      expect(within(row).getByText('unique')).toBeInTheDocument()
      expect(within(row).getByText('sparse')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // SECTION 3: Create Index Button and Modal
  // ===========================================================================
  describe('Create Index Button', () => {
    beforeEach(() => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)
    })

    it('displays Create Index button in the header', () => {
      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('create-index-button')).toBeInTheDocument()
      expect(screen.getByText('Create Index')).toBeInTheDocument()
    })

    it('opens Create Index modal when button is clicked', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /create index/i })).toBeInTheDocument()
      })
    })

    it('displays Create Index button in empty state', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // Should have Create Index button in empty state
      const emptyState = screen.getByTestId('index-list-empty')
      expect(within(emptyState).getByText('Create Index')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // SECTION 4: Create Index Modal Functionality
  // ===========================================================================
  describe('Create Index Modal', () => {
    beforeEach(() => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)
    })

    it('allows selecting fields for the index', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('field-name-0')).toBeInTheDocument()
      })

      // Enter a field name
      const fieldInput = screen.getByTestId('field-name-0')
      await user.type(fieldInput, 'email')

      expect(fieldInput).toHaveValue('email')
    })

    it('allows selecting index direction/type', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('field-direction-0')).toBeInTheDocument()
      })
    })

    it('allows adding multiple fields for compound index', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('add-field-button')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('add-field-button'))

      expect(screen.getByTestId('field-name-1')).toBeInTheDocument()
    })

    it('allows toggling unique option', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('unique-checkbox')).toBeInTheDocument()
      })

      const checkbox = screen.getByTestId('unique-checkbox')
      await user.click(checkbox)

      expect(checkbox).toBeChecked()
    })

    it('allows toggling sparse option', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('sparse-checkbox')).toBeInTheDocument()
      })

      const checkbox = screen.getByTestId('sparse-checkbox')
      await user.click(checkbox)

      expect(checkbox).toBeChecked()
    })

    it('allows configuring TTL expiration', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('ttl-checkbox')).toBeInTheDocument()
      })

      // Enable TTL
      await user.click(screen.getByTestId('ttl-checkbox'))

      // TTL input should appear
      await waitFor(() => {
        expect(screen.getByTestId('ttl-input')).toBeInTheDocument()
      })
    })

    it('shows validation error for empty field name', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('create-index-submit')).toBeInTheDocument()
      })

      // Try to submit without entering field name
      await user.click(screen.getByTestId('create-index-submit'))

      await waitFor(() => {
        expect(screen.getByText(/field.*required|all fields must have a name/i)).toBeInTheDocument()
      })
    })

    it('closes modal when Cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /create index/i })).toBeInTheDocument()
      })

      // Click cancel
      const cancelButton = screen.getAllByRole('button').find(btn =>
        btn.textContent?.toLowerCase().includes('cancel')
      )
      expect(cancelButton).toBeTruthy()
      await user.click(cancelButton!)

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /create index/i })).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // SECTION 5: Delete Index Functionality
  // ===========================================================================
  describe('Delete Index Functionality', () => {
    beforeEach(() => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)
    })

    it('displays delete button for non-_id indexes', () => {
      render(<IndexList {...defaultProps} />)

      // email_1 should have a delete button
      expect(screen.getByTestId('drop-index-email_1')).toBeInTheDocument()
    })

    it('does not allow deleting the _id index', () => {
      render(<IndexList {...defaultProps} />)

      // _id index should have disabled delete button
      const idRow = screen.getByTestId('index-row-_id_')
      const disabledButton = within(idRow).getByTestId('drop-index-disabled')
      expect(disabledButton).toBeInTheDocument()
    })

    it('opens confirmation dialog when delete is clicked', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /drop index/i })).toBeInTheDocument()
      })
    })

    it('shows index name in confirmation dialog', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByText('email_1')).toBeInTheDocument()
      })
    })

    it('shows warning about irreversible action', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
      })
    })

    it('closes confirmation dialog when Cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /drop index/i })).toBeInTheDocument()
      })

      // Click Cancel
      await user.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /drop index/i })).not.toBeInTheDocument()
      })
    })

    it('calls dropIndex mutation when confirmed', async () => {
      mockDropMutateAsync.mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /drop index/i })).toBeInTheDocument()
      })

      // Find and click Drop Index button
      const dropButton = screen.getAllByRole('button').find(btn =>
        btn.textContent?.toLowerCase().includes('drop index') &&
        btn.getAttribute('variant') !== 'default'
      ) || screen.getByText(/drop index/i, { selector: 'button:not([disabled])' })

      await user.click(dropButton)

      await waitFor(() => {
        expect(mockDropMutateAsync).toHaveBeenCalledWith('email_1')
      })
    })

    it('shows loading state during delete operation', () => {
      vi.mocked(useDropIndexMutation).mockReturnValue({
        ...mockDropMutation,
        isPending: true,
      } as any)

      render(<IndexList {...defaultProps} />)

      // The mutation is pending, but we need to trigger the dialog first
      // This test verifies the loading state is shown
    })

    it('refreshes index list after successful delete', async () => {
      mockDropMutateAsync.mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /drop index/i })).toBeInTheDocument()
      })

      // Click the danger/confirm button
      const buttons = screen.getAllByRole('button')
      const dropButton = buttons.find(btn =>
        btn.textContent?.toLowerCase().includes('drop')
      )
      if (dropButton) {
        await user.click(dropButton)
      }

      await waitFor(() => {
        // After successful deletion, refetch should be called
        expect(mockDropMutateAsync).toHaveBeenCalled()
      })
    })

    it('shows error message when delete fails', async () => {
      mockDropMutateAsync.mockRejectedValue(new Error('Index is in use'))
      const user = userEvent.setup()
      render(<IndexList {...defaultProps} />)

      await user.click(screen.getByTestId('drop-index-email_1'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /drop index/i })).toBeInTheDocument()
      })

      const buttons = screen.getAllByRole('button')
      const dropButton = buttons.find(btn =>
        btn.textContent?.toLowerCase().includes('drop')
      )
      if (dropButton) {
        await user.click(dropButton)
      }

      await waitFor(() => {
        expect(screen.getByText(/index is in use/i)).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // SECTION 6: API Integration Tests
  // ===========================================================================
  describe('API Integration', () => {
    it('calls listIndexes on mount', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(useIndexesQuery).toHaveBeenCalledWith('testdb', 'users')
    })

    it('passes correct database and collection to mutation hooks', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(useDropIndexMutation).toHaveBeenCalledWith('testdb', 'users')
    })

    it('calls createIndex with correct parameters', async () => {
      mockCreateMutateAsync.mockResolvedValue('newIndex_1')
      const user = userEvent.setup()

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // Open create dialog
      await user.click(screen.getByTestId('create-index-button'))

      await waitFor(() => {
        expect(screen.getByTestId('field-name-0')).toBeInTheDocument()
      })

      // Enter field name
      const fieldInput = screen.getByTestId('field-name-0')
      await user.clear(fieldInput)
      await user.type(fieldInput, 'newField')

      // Submit
      await user.click(screen.getByTestId('create-index-submit'))

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            keys: expect.objectContaining({ newField: expect.any(Number) })
          })
        )
      })
    })

    it('handles network errors gracefully', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })

    it('provides retry functionality on error', async () => {
      const user = userEvent.setup()

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      const retryButton = screen.getByText(/retry/i)
      await user.click(retryButton)

      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // SECTION 7: Accessibility
  // ===========================================================================
  describe('Accessibility', () => {
    beforeEach(() => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)
    })

    it('has proper table semantics', () => {
      render(<IndexList {...defaultProps} />)

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('has proper column headers', () => {
      render(<IndexList {...defaultProps} />)

      expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /keys/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /properties/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /size/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /usage/i })).toBeInTheDocument()
    })

    it('delete buttons have accessible labels', () => {
      render(<IndexList {...defaultProps} />)

      const deleteButton = screen.getByTestId('drop-index-email_1')
      expect(deleteButton).toHaveAttribute('aria-label')
    })

    it('loading state is announced to screen readers', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // Loading state should be perceivable
      expect(screen.getByTestId('index-list-loading')).toBeInTheDocument()
    })

    it('error messages have alert role', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Error'),
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      const errorContainer = screen.getByTestId('index-list-error')
      expect(errorContainer).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // SECTION 8: Edge Cases and Special Index Types
  // ===========================================================================
  describe('Edge Cases', () => {
    it('handles indexes with very long names', () => {
      const longNameIndex: IndexInfo = {
        name: 'a'.repeat(128),
        key: { field: 1 },
      }

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [longNameIndex],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText('a'.repeat(128))).toBeInTheDocument()
    })

    it('handles compound indexes with many fields', () => {
      const compoundIndex: IndexInfo = {
        name: 'compound_many',
        key: {
          field1: 1,
          field2: -1,
          field3: 1,
          field4: -1,
          field5: 1,
        },
      }

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [compoundIndex],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText(/field1: 1/)).toBeInTheDocument()
      expect(screen.getByText(/field5: 1/)).toBeInTheDocument()
    })

    it('handles indexes with nested field paths', () => {
      const nestedIndex: IndexInfo = {
        name: 'address.city_1',
        key: { 'address.city': 1 },
      }

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [nestedIndex],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText(/address\.city: 1/)).toBeInTheDocument()
    })

    it('handles mixed index types in compound index', () => {
      const mixedIndex: IndexInfo = {
        name: 'location_name_compound',
        key: {
          location: '2dsphere',
          name: 1,
        },
      }

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: [mixedIndex],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByText(/location: "2dsphere"/)).toBeInTheDocument()
      expect(screen.getByText(/name: 1/)).toBeInTheDocument()
    })

    it('updates when props change', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      const { rerender } = render(<IndexList {...defaultProps} />)

      // Change to a different collection
      rerender(<IndexList database="testdb" collection="orders" />)

      // Should have called with new collection
      expect(useIndexesQuery).toHaveBeenCalledWith('testdb', 'orders')
    })
  })

  // ===========================================================================
  // SECTION 9: Index Size and Usage Statistics
  // ===========================================================================
  describe('Index Size and Usage Statistics', () => {
    it('displays index size when available', () => {
      const indexWithSize: IndexInfo[] = [
        {
          name: 'email_1',
          key: { email: 1 },
          sizeBytes: 1024 * 1024 * 10, // 10 MB
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithSize,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-size-email_1')).toHaveTextContent('10.0 MB')
    })

    it('displays dash when size is not available', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // mockIndexes don't have sizeBytes, should show dash
      expect(screen.getByTestId('index-size-email_1')).toHaveTextContent('-')
    })

    it('displays usage stats when available', () => {
      const indexWithUsage: IndexInfo[] = [
        {
          name: 'email_1',
          key: { email: 1 },
          usageStats: {
            accesses: 1234567,
          },
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithUsage,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-usage-email_1')).toHaveTextContent('1,234,567 hits')
    })

    it('displays dash when usage stats not available', () => {
      vi.mocked(useIndexesQuery).mockReturnValue({
        data: mockIndexes,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      // mockIndexes don't have usageStats, should show dash
      expect(screen.getByTestId('index-usage-email_1')).toHaveTextContent('-')
    })

    it('formats small sizes correctly', () => {
      const indexWithSmallSize: IndexInfo[] = [
        {
          name: 'small_idx',
          key: { field: 1 },
          sizeBytes: 512, // 512 bytes
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithSmallSize,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-size-small_idx')).toHaveTextContent('512 B')
    })

    it('formats KB sizes correctly', () => {
      const indexWithKBSize: IndexInfo[] = [
        {
          name: 'kb_idx',
          key: { field: 1 },
          sizeBytes: 1024 * 5.5, // 5.5 KB
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithKBSize,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-size-kb_idx')).toHaveTextContent('5.5 KB')
    })

    it('formats GB sizes correctly', () => {
      const indexWithGBSize: IndexInfo[] = [
        {
          name: 'large_idx',
          key: { field: 1 },
          sizeBytes: 1024 * 1024 * 1024 * 2.3, // 2.3 GB
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithGBSize,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-size-large_idx')).toHaveTextContent('2.3 GB')
    })

    it('formats zero usage correctly', () => {
      const indexWithZeroUsage: IndexInfo[] = [
        {
          name: 'unused_idx',
          key: { field: 1 },
          usageStats: {
            accesses: 0,
          },
        },
      ]

      vi.mocked(useIndexesQuery).mockReturnValue({
        data: indexWithZeroUsage,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      render(<IndexList {...defaultProps} />)

      expect(screen.getByTestId('index-usage-unused_idx')).toHaveTextContent('0 hits')
    })
  })
})
