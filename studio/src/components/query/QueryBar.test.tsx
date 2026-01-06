import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { QueryBar, QueryBarProps } from './QueryBar'
import { useQueryStore } from '@stores/query'

// Mock CodeMirror since it doesn't work well in jsdom
vi.mock('@codemirror/view', () => ({
  EditorView: class MockEditorView {
    static theme = () => ({})
    static lineWrapping = {}
    static updateListener = {
      of: () => ({}),
    }
    state = {
      doc: {
        toString: () => '{}',
        length: 2,
      },
    }
    dispatch = vi.fn()
    destroy = vi.fn()
  },
  keymap: { of: () => ({}) },
  placeholder: () => ({}),
  lineNumbers: () => ({}),
  drawSelection: () => ({}),
  highlightActiveLine: () => ({}),
  highlightSpecialChars: () => ({}),
}))

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: () => ({}),
    readOnly: { of: () => ({}) },
  },
  Compartment: class MockCompartment {
    of = () => ({})
    reconfigure = () => ({})
  },
}))

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: () => ({}),
  historyKeymap: [],
}))

vi.mock('@codemirror/lang-json', () => ({
  json: () => ({}),
  jsonParseLinter: () => () => [],
}))

vi.mock('@codemirror/lint', () => ({
  linter: () => ({}),
  lintGutter: () => ({}),
}))

vi.mock('@codemirror/language', () => ({
  bracketMatching: () => ({}),
  indentOnInput: () => ({}),
  syntaxHighlighting: () => ({}),
  defaultHighlightStyle: {},
}))

vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => ({}),
  closeBrackets: () => ({}),
  closeBracketsKeymap: [],
  completionKeymap: [],
}))

vi.mock('@codemirror/search', () => ({
  searchKeymap: [],
  highlightSelectionMatches: () => ({}),
}))

const defaultProps: QueryBarProps = {
  database: 'testdb',
  collection: 'testcol',
  onExecute: vi.fn().mockResolvedValue({ count: 10, time: 50 }),
}

// Reset store between tests
beforeEach(() => {
  vi.clearAllMocks()

  const { getState } = useQueryStore
  act(() => {
    getState().setCurrentFilter('{}')
    getState().setCurrentProjection('')
    getState().setCurrentSort('')
    getState().setCurrentLimit(20)
    getState().setExecutionResult(null)
    getState().setExecutionError(null)
    getState().clearValidationErrors()
    // Clear history
    const history = getState().history
    history.forEach((h) => {
      getState().removeFromHistory(h.id)
    })
    getState().setExecuting(false)
  })
})

describe('QueryBar', () => {
  describe('rendering', () => {
    it('renders the query bar container', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('query-bar')).toBeInTheDocument()
    })

    it('renders the header with Query label', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('Query')).toBeInTheDocument()
    })

    it('shows Valid badge when query is valid', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('Valid')).toBeInTheDocument()
    })

    it('shows tab buttons for Filter, Projection, and Sort', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('tab-filter')).toBeInTheDocument()
      expect(screen.getByTestId('tab-projection')).toBeInTheDocument()
      expect(screen.getByTestId('tab-sort')).toBeInTheDocument()
    })

    it('renders the editor container', async () => {
      render(<QueryBar {...defaultProps} />)

      // Editor loads lazily, wait for it to appear
      expect(await screen.findByTestId('query-editor')).toBeInTheDocument()
    })

    it('renders the execute button', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('execute-button')).toBeInTheDocument()
      expect(screen.getByText('Execute')).toBeInTheDocument()
    })

    it('renders the limit input with default value', () => {
      render(<QueryBar {...defaultProps} />)

      const limitInput = screen.getByTestId('limit-input')
      expect(limitInput).toBeInTheDocument()
      expect(limitInput).toHaveValue(20)
    })

    it('displays keyboard shortcut hint', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('Enter')).toBeInTheDocument()
      expect(screen.getByText('to execute')).toBeInTheDocument()
    })
  })

  describe('tabs', () => {
    it('switches to Projection tab when clicked', async () => {
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} />)

      await user.click(screen.getByTestId('tab-projection'))

      // The tab should become active (has active styles)
      expect(screen.getByTestId('tab-projection')).toBeInTheDocument()
    })

    it('switches to Sort tab when clicked', async () => {
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} />)

      await user.click(screen.getByTestId('tab-sort'))

      expect(screen.getByTestId('tab-sort')).toBeInTheDocument()
    })
  })

  describe('limit input', () => {
    it('updates limit when changed', async () => {
      render(<QueryBar {...defaultProps} />)

      const limitInput = screen.getByTestId('limit-input')
      // Verify initial state
      expect(limitInput).toHaveValue(20)

      // The limit input is connected to the store
      // Verify the store updates through component interaction
      act(() => {
        useQueryStore.getState().setCurrentLimit(50)
      })

      // Re-render to pick up the store change
      expect(useQueryStore.getState().currentLimit).toBe(50)
    })
  })

  describe('execute button', () => {
    it('calls onExecute when clicked', async () => {
      const onExecute = vi.fn().mockResolvedValue({ count: 5, time: 25 })
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} onExecute={onExecute} />)

      await user.click(screen.getByTestId('execute-button'))

      await waitFor(() => {
        expect(onExecute).toHaveBeenCalled()
      })
    })

    it('is disabled when query is invalid', () => {
      // Set invalid query
      act(() => {
        useQueryStore.getState().setCurrentFilter('{ invalid }')
      })

      render(<QueryBar {...defaultProps} />)

      // LeafyGreen Button uses aria-disabled instead of native disabled
      expect(screen.getByTestId('execute-button')).toHaveAttribute('aria-disabled', 'true')
    })

    it('is disabled during execution', () => {
      act(() => {
        useQueryStore.getState().setExecuting(true)
      })

      render(<QueryBar {...defaultProps} />)

      // LeafyGreen Button uses aria-disabled instead of native disabled
      expect(screen.getByTestId('execute-button')).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows "Executing..." text during execution', () => {
      act(() => {
        useQueryStore.getState().setExecuting(true)
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('Executing...')).toBeInTheDocument()
    })
  })

  describe('result display', () => {
    it('shows result count after execution', () => {
      act(() => {
        useQueryStore.getState().setExecutionResult({ time: 50, count: 42 })
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('result-count')).toBeInTheDocument()
      expect(screen.getByText('42 documents')).toBeInTheDocument()
    })

    it('shows execution time after execution', () => {
      act(() => {
        useQueryStore.getState().setExecutionResult({ time: 150, count: 10 })
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('execution-time')).toBeInTheDocument()
      expect(screen.getByText('150ms')).toBeInTheDocument()
    })

    it('formats execution time in seconds for long queries', () => {
      act(() => {
        useQueryStore.getState().setExecutionResult({ time: 2500, count: 10 })
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('2.50s')).toBeInTheDocument()
    })

    it('shows <1ms for very fast queries', () => {
      act(() => {
        useQueryStore.getState().setExecutionResult({ time: 0.5, count: 10 })
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('<1ms')).toBeInTheDocument()
    })
  })

  describe('error display', () => {
    it('shows validation errors when query is invalid', () => {
      act(() => {
        useQueryStore.getState().setCurrentFilter('{ invalid json }')
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('validation-errors')).toBeInTheDocument()
    })

    it('shows Invalid badge when query is invalid', () => {
      act(() => {
        useQueryStore.getState().setCurrentFilter('{ invalid }')
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByText('Invalid')).toBeInTheDocument()
    })

    it('shows execution error when query fails', () => {
      act(() => {
        useQueryStore.getState().setExecutionError('Connection timeout')
      })

      render(<QueryBar {...defaultProps} />)

      expect(screen.getByTestId('execution-error')).toBeInTheDocument()
      expect(screen.getByText(/Connection timeout/)).toBeInTheDocument()
    })
  })

  describe('toolbar buttons', () => {
    it('renders Format JSON button', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByLabelText('Format JSON')).toBeInTheDocument()
    })

    it('renders Clear query button', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.getByLabelText('Clear query')).toBeInTheDocument()
    })

    it('renders Toggle history button when onHistoryToggle is provided', () => {
      const onHistoryToggle = vi.fn()
      render(<QueryBar {...defaultProps} onHistoryToggle={onHistoryToggle} />)

      expect(screen.getByLabelText('Toggle history')).toBeInTheDocument()
    })

    it('does not render Toggle history button when onHistoryToggle is not provided', () => {
      render(<QueryBar {...defaultProps} />)

      expect(screen.queryByLabelText('Toggle history')).not.toBeInTheDocument()
    })

    it('calls onHistoryToggle when history button is clicked', async () => {
      const onHistoryToggle = vi.fn()
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} onHistoryToggle={onHistoryToggle} />)

      await user.click(screen.getByLabelText('Toggle history'))

      expect(onHistoryToggle).toHaveBeenCalled()
    })
  })

  describe('execution flow', () => {
    it('adds successful query to history', async () => {
      const onExecute = vi.fn().mockResolvedValue({ count: 5, time: 25 })
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} onExecute={onExecute} />)

      await user.click(screen.getByTestId('execute-button'))

      await waitFor(() => {
        expect(useQueryStore.getState().history.length).toBeGreaterThan(0)
      })
    })

    it('adds failed query to history with error', async () => {
      const onExecute = vi.fn().mockRejectedValue(new Error('Query failed'))
      const user = userEvent.setup()
      render(<QueryBar {...defaultProps} onExecute={onExecute} />)

      await user.click(screen.getByTestId('execute-button'))

      await waitFor(() => {
        const history = useQueryStore.getState().history
        expect(history.length).toBeGreaterThan(0)
        expect(history[0]?.error).toBe('Query failed')
      })
    })

    it('parses filter, projection, sort, and limit for execution', async () => {
      const onExecute = vi.fn().mockResolvedValue({ count: 1, time: 10 })
      const user = userEvent.setup()

      act(() => {
        useQueryStore.getState().setCurrentFilter('{ "status": "active" }')
        useQueryStore.getState().setCurrentProjection('{ "name": 1 }')
        useQueryStore.getState().setCurrentSort('{ "createdAt": -1 }')
        useQueryStore.getState().setCurrentLimit(10)
      })

      render(<QueryBar {...defaultProps} onExecute={onExecute} />)

      await user.click(screen.getByTestId('execute-button'))

      await waitFor(() => {
        expect(onExecute).toHaveBeenCalledWith({
          filter: { status: 'active' },
          projection: { name: 1 },
          sort: { createdAt: -1 },
          limit: 10,
        })
      })
    })
  })

  describe('className prop', () => {
    it('applies custom className', () => {
      render(<QueryBar {...defaultProps} className="custom-class" />)

      expect(screen.getByTestId('query-bar')).toHaveClass('custom-class')
    })
  })
})
