import { useCallback, useEffect, useRef, useState, useMemo, memo, Suspense } from 'react'
import { css, keyframes } from '@leafygreen-ui/emotion'
import { palette } from '@leafygreen-ui/palette'
import { Body } from '@leafygreen-ui/typography'
import Button from '@leafygreen-ui/button'
import IconButton from '@leafygreen-ui/icon-button'
import Icon from '@leafygreen-ui/icon'
import Tooltip from '@leafygreen-ui/tooltip'
import Badge from '@leafygreen-ui/badge'
import { useQueryStore } from '@stores/query'

// Lazy load CodeMirror modules for better initial load performance
let codeMirrorModulesPromise: Promise<CodeMirrorModules> | null = null

interface CodeMirrorModules {
  EditorView: typeof import('@codemirror/view').EditorView
  EditorState: typeof import('@codemirror/state').EditorState
  Compartment: typeof import('@codemirror/state').Compartment
  keymap: typeof import('@codemirror/view').keymap
  placeholder: typeof import('@codemirror/view').placeholder
  lineNumbers: typeof import('@codemirror/view').lineNumbers
  drawSelection: typeof import('@codemirror/view').drawSelection
  highlightActiveLine: typeof import('@codemirror/view').highlightActiveLine
  highlightSpecialChars: typeof import('@codemirror/view').highlightSpecialChars
  defaultKeymap: typeof import('@codemirror/commands').defaultKeymap
  history: typeof import('@codemirror/commands').history
  historyKeymap: typeof import('@codemirror/commands').historyKeymap
  json: typeof import('@codemirror/lang-json').json
  jsonParseLinter: typeof import('@codemirror/lang-json').jsonParseLinter
  linter: typeof import('@codemirror/lint').linter
  lintGutter: typeof import('@codemirror/lint').lintGutter
  bracketMatching: typeof import('@codemirror/language').bracketMatching
  indentOnInput: typeof import('@codemirror/language').indentOnInput
  syntaxHighlighting: typeof import('@codemirror/language').syntaxHighlighting
  defaultHighlightStyle: typeof import('@codemirror/language').defaultHighlightStyle
  autocompletion: typeof import('@codemirror/autocomplete').autocompletion
  closeBrackets: typeof import('@codemirror/autocomplete').closeBrackets
  closeBracketsKeymap: typeof import('@codemirror/autocomplete').closeBracketsKeymap
  completionKeymap: typeof import('@codemirror/autocomplete').completionKeymap
  searchKeymap: typeof import('@codemirror/search').searchKeymap
  highlightSelectionMatches: typeof import('@codemirror/search').highlightSelectionMatches
}

async function loadCodeMirrorModules(): Promise<CodeMirrorModules> {
  if (!codeMirrorModulesPromise) {
    codeMirrorModulesPromise = Promise.all([
      import('@codemirror/view'),
      import('@codemirror/state'),
      import('@codemirror/commands'),
      import('@codemirror/lang-json'),
      import('@codemirror/lint'),
      import('@codemirror/language'),
      import('@codemirror/autocomplete'),
      import('@codemirror/search'),
    ]).then(([view, state, commands, langJson, lint, language, autocomplete, search]) => ({
      EditorView: view.EditorView,
      EditorState: state.EditorState,
      Compartment: state.Compartment,
      keymap: view.keymap,
      placeholder: view.placeholder,
      lineNumbers: view.lineNumbers,
      drawSelection: view.drawSelection,
      highlightActiveLine: view.highlightActiveLine,
      highlightSpecialChars: view.highlightSpecialChars,
      defaultKeymap: commands.defaultKeymap,
      history: commands.history,
      historyKeymap: commands.historyKeymap,
      json: langJson.json,
      jsonParseLinter: langJson.jsonParseLinter,
      linter: lint.linter,
      lintGutter: lint.lintGutter,
      bracketMatching: language.bracketMatching,
      indentOnInput: language.indentOnInput,
      syntaxHighlighting: language.syntaxHighlighting,
      defaultHighlightStyle: language.defaultHighlightStyle,
      autocompletion: autocomplete.autocompletion,
      closeBrackets: autocomplete.closeBrackets,
      closeBracketsKeymap: autocomplete.closeBracketsKeymap,
      completionKeymap: autocomplete.completionKeymap,
      searchKeymap: search.searchKeymap,
      highlightSelectionMatches: search.highlightSelectionMatches,
    }))
  }
  return codeMirrorModulesPromise
}

// Animations
const pulseAnimation = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`

const spinAnimation = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

// Styles
const containerStyles = css`
  display: flex;
  flex-direction: column;
  border: 1px solid ${palette.gray.light2};
  border-radius: 8px;
  background: ${palette.white};
  overflow: hidden;
`

const containerErrorStyles = css`
  border-color: ${palette.red.base};
`

const headerStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: ${palette.gray.light3};
  border-bottom: 1px solid ${palette.gray.light2};
`

const headerLeftStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`

const headerRightStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`

const editorContainerStyles = css`
  position: relative;
  min-height: 80px;
  max-height: 300px;
  overflow-y: auto;

  .cm-editor {
    height: 100%;
    font-family: 'Source Code Pro', Menlo, Monaco, 'Courier New', monospace;
    font-size: 13px;
  }

  .cm-scroller {
    overflow: auto;
  }

  .cm-content {
    padding: 12px;
  }

  .cm-line {
    padding: 0 2px;
  }

  .cm-focused {
    outline: none;
  }

  .cm-editor.cm-focused {
    outline: none;
  }

  .cm-gutters {
    background: ${palette.gray.light3};
    border-right: 1px solid ${palette.gray.light2};
  }

  .cm-gutter-lint {
    width: 10px;
  }

  .cm-lint-marker-error {
    content: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="%23CF4747"/></svg>');
  }

  .cm-placeholder {
    color: ${palette.gray.base};
    font-style: italic;
  }
`

const footerStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: ${palette.gray.light3};
  border-top: 1px solid ${palette.gray.light2};
  gap: 12px;
`

const footerLeftStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
`

const footerRightStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`

const errorContainerStyles = css`
  padding: 8px 12px;
  background: ${palette.red.light3};
  border-top: 1px solid ${palette.red.light2};
`

const errorTextStyles = css`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: ${palette.red.dark2};
  font-size: 13px;
`

const errorLocationStyles = css`
  font-family: 'Source Code Pro', Menlo, Monaco, 'Courier New', monospace;
  font-size: 11px;
  color: ${palette.red.base};
`

const statsStyles = css`
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: ${palette.gray.dark1};
`

const statItemStyles = css`
  display: flex;
  align-items: center;
  gap: 4px;
`

const loadingStyles = css`
  display: inline-flex;
  animation: ${spinAnimation} 1s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const shortcutStyles = css`
  font-size: 11px;
  color: ${palette.gray.base};
  display: flex;
  align-items: center;
  gap: 4px;
`

const kbdStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  font-family: 'Source Code Pro', Menlo, Monaco, 'Courier New', monospace;
  font-size: 11px;
  background: ${palette.gray.light2};
  border: 1px solid ${palette.gray.light1};
  border-radius: 4px;
  color: ${palette.gray.dark1};
`

const tabsContainerStyles = css`
  display: flex;
  gap: 2px;
  padding: 0 12px 8px;
  border-bottom: 1px solid ${palette.gray.light2};
  background: ${palette.gray.light3};
`

const tabButtonStyles = css`
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: ${palette.gray.dark1};
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  transition: all 0.15s ease;
  border-bottom: 2px solid transparent;

  &:hover {
    background: ${palette.gray.light2};
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const tabButtonActiveStyles = css`
  background: ${palette.white};
  color: ${palette.green.dark2};
  border-bottom-color: ${palette.green.dark1};

  &:hover {
    background: ${palette.white};
  }
`

const limitInputStyles = css`
  width: 70px;
  padding: 4px 8px;
  border: 1px solid ${palette.gray.light2};
  border-radius: 4px;
  font-size: 13px;
`

const labelStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
`

const editorLoadingStyles = css`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  background: ${palette.gray.light3};
  color: ${palette.gray.dark1};
  font-size: 13px;
  gap: 8px;
`

const skeletonLineStyles = css`
  height: 16px;
  background: linear-gradient(90deg, ${palette.gray.light2} 25%, ${palette.gray.light3} 50%, ${palette.gray.light2} 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  margin: 4px 12px;
  animation: shimmer 1.5s infinite;

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`

// Types
export interface QueryBarProps {
  database: string
  collection: string
  onExecute: (query: QueryOptions) => Promise<{ count: number; time: number }>
  onQueryChange?: (query: string) => void
  initialQuery?: string
  showHistory?: boolean
  onHistoryToggle?: () => void
  className?: string
}

export interface QueryOptions {
  filter: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  limit?: number
}

type QueryTab = 'filter' | 'projection' | 'sort'

// Editor theme config (created with EditorView once loaded)
const editorThemeConfig = {
  '&': {
    backgroundColor: palette.white,
  },
  '.cm-content': {
    caretColor: palette.green.dark2,
  },
  '.cm-cursor': {
    borderLeftColor: palette.green.dark2,
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: palette.green.light3,
  },
  '.cm-activeLine': {
    backgroundColor: `${palette.gray.light3}50`,
  },
  '.cm-selectionMatch': {
    backgroundColor: palette.yellow.light3,
  },
}

export const QueryBar = memo(function QueryBar({
  database,
  collection,
  onExecute,
  onQueryChange,
  initialQuery = '{}',
  showHistory = false,
  onHistoryToggle,
  className,
}: QueryBarProps) {
  const {
    currentFilter,
    currentProjection,
    currentSort,
    currentLimit,
    validationErrors,
    isValid,
    isExecuting,
    lastExecutionTime,
    lastResultCount,
    lastError,
    setCurrentFilter,
    setCurrentProjection,
    setCurrentSort,
    setCurrentLimit,
    setExecuting,
    setExecutionResult,
    setExecutionError,
    addToHistory,
  } = useQueryStore()

  const [activeTab, setActiveTab] = useState<QueryTab>('filter')
  const [editorLoading, setEditorLoading] = useState(true)
  const [cmModules, setCmModules] = useState<CodeMirrorModules | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<InstanceType<CodeMirrorModules['EditorView']> | null>(null)
  const readOnlyCompartmentRef = useRef<InstanceType<CodeMirrorModules['Compartment']> | null>(null)

  // Get current value based on active tab
  const getCurrentValue = useCallback(() => {
    switch (activeTab) {
      case 'filter':
        return currentFilter
      case 'projection':
        return currentProjection
      case 'sort':
        return currentSort
      default:
        return currentFilter
    }
  }, [activeTab, currentFilter, currentProjection, currentSort])

  // Set current value based on active tab
  const setCurrentValue = useCallback(
    (value: string) => {
      switch (activeTab) {
        case 'filter':
          setCurrentFilter(value)
          break
        case 'projection':
          setCurrentProjection(value)
          break
        case 'sort':
          setCurrentSort(value)
          break
      }
    },
    [activeTab, setCurrentFilter, setCurrentProjection, setCurrentSort]
  )

  // Execute query
  const executeQuery = useCallback(async () => {
    if (!isValid || isExecuting) return

    try {
      // Parse all query parts
      const filter = currentFilter.trim() ? JSON.parse(currentFilter) : {}
      const projection = currentProjection.trim() ? JSON.parse(currentProjection) : undefined
      const sort = currentSort.trim() ? JSON.parse(currentSort) : undefined

      setExecuting(true)
      const startTime = performance.now()

      const result = await onExecute({
        filter,
        projection,
        sort,
        limit: currentLimit,
      })

      const executionTime = performance.now() - startTime
      setExecutionResult({ time: executionTime, count: result.count })

      // Add to history
      addToHistory({
        query: currentFilter,
        database,
        collection,
        executionTime,
        resultCount: result.count,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed'
      setExecutionError(errorMessage)

      // Add error to history
      addToHistory({
        query: currentFilter,
        database,
        collection,
        error: errorMessage,
      })
    } finally {
      setExecuting(false)
    }
  }, [
    isValid,
    isExecuting,
    currentFilter,
    currentProjection,
    currentSort,
    currentLimit,
    onExecute,
    database,
    collection,
    setExecuting,
    setExecutionResult,
    setExecutionError,
    addToHistory,
  ])

  // Load CodeMirror modules lazily
  useEffect(() => {
    let cancelled = false

    loadCodeMirrorModules().then((modules) => {
      if (!cancelled) {
        setCmModules(modules)
        setEditorLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Initialize editor after modules are loaded
  useEffect(() => {
    if (!editorRef.current || viewRef.current || !cmModules) return

    const {
      EditorView,
      EditorState,
      Compartment,
      keymap,
      placeholder,
      lineNumbers,
      drawSelection,
      highlightActiveLine,
      highlightSpecialChars,
      defaultKeymap,
      history,
      historyKeymap,
      json,
      jsonParseLinter,
      linter,
      lintGutter,
      bracketMatching,
      indentOnInput,
      syntaxHighlighting,
      defaultHighlightStyle,
      autocompletion,
      closeBrackets,
      closeBracketsKeymap,
      completionKeymap,
      searchKeymap,
      highlightSelectionMatches,
    } = cmModules

    const readOnlyCompartment = new Compartment()
    readOnlyCompartmentRef.current = readOnlyCompartment

    const editorTheme = EditorView.theme(editorThemeConfig)

    const executeKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          executeQuery()
          return true
        },
      },
      {
        key: 'Shift-Enter',
        run: () => {
          executeQuery()
          return true
        },
      },
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const value = update.state.doc.toString()
        setCurrentValue(value)
        onQueryChange?.(value)
      }
    })

    const state = EditorState.create({
      doc: getCurrentValue() || initialQuery,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle),
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        editorTheme,
        placeholder('Enter MongoDB query...'),
        executeKeymap,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        readOnlyCompartment.of(EditorState.readOnly.of(false)),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [cmModules, executeQuery, getCurrentValue, initialQuery, onQueryChange, setCurrentValue])

  // Update editor content when tab changes or value changes externally
  useEffect(() => {
    if (!viewRef.current) return

    const currentDoc = viewRef.current.state.doc.toString()
    const newValue = getCurrentValue()

    if (currentDoc !== newValue) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: newValue,
        },
      })
    }
  }, [activeTab, getCurrentValue])

  // Update read-only state when executing
  useEffect(() => {
    if (!viewRef.current || !cmModules || !readOnlyCompartmentRef.current) return

    viewRef.current.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        cmModules.EditorState.readOnly.of(isExecuting)
      ),
    })
  }, [isExecuting, cmModules])

  // Format JSON in editor
  const formatQuery = useCallback(() => {
    if (!viewRef.current) return

    try {
      const current = viewRef.current.state.doc.toString()
      if (!current.trim()) return

      const parsed = JSON.parse(current)
      const formatted = JSON.stringify(parsed, null, 2)

      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: current.length,
          insert: formatted,
        },
      })
    } catch {
      // Ignore formatting errors for invalid JSON
    }
  }, [])

  // Clear editor
  const clearQuery = useCallback(() => {
    if (!viewRef.current) return

    viewRef.current.dispatch({
      changes: {
        from: 0,
        to: viewRef.current.state.doc.length,
        insert: '{}',
      },
    })
    setCurrentValue('{}')
  }, [setCurrentValue])

  return (
    <div
      className={`${containerStyles} ${!isValid ? containerErrorStyles : ''} ${className ?? ''}`}
      data-testid="query-bar"
    >
      <div className={headerStyles}>
        <div className={headerLeftStyles}>
          <Body weight="medium">Query</Body>
          <Badge variant={isValid ? 'green' : 'red'}>
            {isValid ? 'Valid' : 'Invalid'}
          </Badge>
        </div>
        <div className={headerRightStyles}>
          <Tooltip
            trigger={
              <IconButton
                aria-label="Format JSON"
                onClick={formatQuery}
                disabled={!isValid}
              >
                <Icon glyph="Edit" />
              </IconButton>
            }
          >
            Format JSON (Shift+Alt+F)
          </Tooltip>
          <Tooltip
            trigger={
              <IconButton aria-label="Clear query" onClick={clearQuery}>
                <Icon glyph="X" />
              </IconButton>
            }
          >
            Clear query
          </Tooltip>
          {onHistoryToggle && (
            <Tooltip
              trigger={
                <IconButton
                  aria-label="Toggle history"
                  onClick={onHistoryToggle}
                  active={showHistory}
                >
                  <Icon glyph="Clock" />
                </IconButton>
              }
            >
              Toggle history panel
            </Tooltip>
          )}
        </div>
      </div>

      <div className={tabsContainerStyles}>
        <button
          className={`${tabButtonStyles} ${activeTab === 'filter' ? tabButtonActiveStyles : ''}`}
          onClick={() => setActiveTab('filter')}
          data-testid="tab-filter"
        >
          Filter
        </button>
        <button
          className={`${tabButtonStyles} ${activeTab === 'projection' ? tabButtonActiveStyles : ''}`}
          onClick={() => setActiveTab('projection')}
          data-testid="tab-projection"
        >
          Projection
        </button>
        <button
          className={`${tabButtonStyles} ${activeTab === 'sort' ? tabButtonActiveStyles : ''}`}
          onClick={() => setActiveTab('sort')}
          data-testid="tab-sort"
        >
          Sort
        </button>
      </div>

      {editorLoading ? (
        <div className={editorLoadingStyles} data-testid="editor-loading">
          <div style={{ width: '100%' }}>
            <div className={skeletonLineStyles} style={{ width: '70%' }} />
            <div className={skeletonLineStyles} style={{ width: '50%' }} />
            <div className={skeletonLineStyles} style={{ width: '60%' }} />
          </div>
        </div>
      ) : (
        <div
          className={editorContainerStyles}
          ref={editorRef}
          data-testid="query-editor"
        />
      )}

      {validationErrors.length > 0 && (
        <div className={errorContainerStyles} data-testid="validation-errors">
          {validationErrors.map((error, index) => (
            <div key={index} className={errorTextStyles}>
              <Icon glyph="Warning" fill={palette.red.base} />
              <div>
                <span>{error.message}</span>
                {error.line !== undefined && (
                  <span className={errorLocationStyles}>
                    {' '}
                    at line {error.line}, column {error.column}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lastError && (
        <div className={errorContainerStyles} data-testid="execution-error">
          <div className={errorTextStyles}>
            <Icon glyph="Warning" fill={palette.red.base} />
            <span>Execution error: {lastError}</span>
          </div>
        </div>
      )}

      <div className={footerStyles}>
        <div className={footerLeftStyles}>
          <div className={statsStyles}>
            {lastResultCount !== null && (
              <span className={statItemStyles} data-testid="result-count">
                <Icon glyph="File" size="small" />
                {lastResultCount} documents
              </span>
            )}
            {lastExecutionTime !== null && (
              <span className={statItemStyles} data-testid="execution-time">
                <Icon glyph="Clock" size="small" />
                {lastExecutionTime < 1
                  ? '<1ms'
                  : lastExecutionTime < 1000
                    ? `${Math.round(lastExecutionTime)}ms`
                    : `${(lastExecutionTime / 1000).toFixed(2)}s`}
              </span>
            )}
          </div>
          <div className={shortcutStyles}>
            <kbd className={kbdStyles}>
              {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}
            </kbd>
            <span>+</span>
            <kbd className={kbdStyles}>Enter</kbd>
            <span>to execute</span>
          </div>
        </div>
        <div className={footerRightStyles}>
          <label className={labelStyles}>
            Limit:
            <input
              type="number"
              value={currentLimit}
              onChange={(e) => setCurrentLimit(parseInt(e.target.value, 10) || 20)}
              min={1}
              max={1000}
              className={limitInputStyles}
              data-testid="limit-input"
            />
          </label>
          <Button
            variant="primary"
            onClick={executeQuery}
            disabled={!isValid || isExecuting}
            leftGlyph={
              isExecuting ? (
                <span className={loadingStyles}>
                  <Icon glyph="Refresh" />
                </span>
              ) : (
                <Icon glyph="Play" />
              )
            }
            data-testid="execute-button"
          >
            {isExecuting ? 'Executing...' : 'Execute'}
          </Button>
        </div>
      </div>
    </div>
  )
})

export default QueryBar
