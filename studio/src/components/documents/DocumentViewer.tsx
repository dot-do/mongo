import { useState, useCallback, useMemo, memo } from 'react'
import { css } from '@leafygreen-ui/emotion'
import { palette } from '@leafygreen-ui/palette'
import { Body } from '@leafygreen-ui/typography'
import Icon from '@leafygreen-ui/icon'
import IconButton from '@leafygreen-ui/icon-button'
import Tooltip from '@leafygreen-ui/tooltip'

const viewerStyles = css`
  font-family: 'Source Code Pro', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.6;
`

const lineStyles = css`
  display: flex;
  align-items: flex-start;
  padding: 2px 0;

  &:hover {
    background: ${palette.gray.light3};
  }
`

const expandIconStyles = css`
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  margin-right: 4px;
`

const keyStyles = css`
  color: ${palette.purple.base};
  margin-right: 4px;
`

const valueStyles = css`
  color: ${palette.gray.dark3};
`

const stringValueStyles = css`
  color: ${palette.green.dark2};
`

const numberValueStyles = css`
  color: ${palette.blue.base};
`

const booleanValueStyles = css`
  color: ${palette.yellow.dark2};
`

const nullValueStyles = css`
  color: ${palette.gray.base};
  font-style: italic;
`

const bracketStyles = css`
  color: ${palette.gray.dark1};
`

const indentStyles = css`
  display: inline-block;
`

const truncatedStyles = css`
  color: ${palette.gray.base};
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

const copyButtonStyles = css`
  opacity: 0;
  transition: opacity 0.15s;
  margin-left: 4px;
`

const lineWithCopyStyles = css`
  display: flex;
  align-items: flex-start;
  padding: 2px 0;

  &:hover {
    background: ${palette.gray.light3};
  }

  &:hover .copy-btn {
    opacity: 1;
  }
`

const largeDocBannerStyles = css`
  margin-bottom: 12px;
  padding: 8px 12px;
  background: ${palette.yellow.light3};
  border: 1px solid ${palette.yellow.base};
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: ${palette.yellow.dark2};
`

const showMoreStyles = css`
  color: ${palette.blue.base};
  cursor: pointer;
  padding: 8px 16px;
  &:hover {
    text-decoration: underline;
  }
`

// Constants for large document handling
const MAX_STRING_LENGTH = 500
const LARGE_DOC_FIELD_THRESHOLD = 100
const INITIAL_RENDER_LIMIT = 50

interface DocumentViewerProps {
  document: Record<string, unknown>
  expanded?: boolean
  indentLevel?: number
  /** Maximum fields to render initially for large documents */
  initialRenderLimit?: number
  /** Enable copy-to-clipboard for values */
  enableCopy?: boolean
}

// Calculate approximate document size in bytes
function estimateDocumentSize(doc: unknown): number {
  return JSON.stringify(doc).length
}

// Count total fields recursively
function countFields(obj: unknown): number {
  if (obj === null || typeof obj !== 'object') return 0
  if (Array.isArray(obj)) {
    return obj.reduce((acc, item) => acc + 1 + countFields(item), 0)
  }
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [_, value]) => acc + 1 + countFields(value),
    0
  )
}

// Copy text to clipboard
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const DocumentViewer = memo(function DocumentViewer({
  document,
  expanded = false,
  indentLevel = 0,
  initialRenderLimit = INITIAL_RENDER_LIMIT,
  enableCopy = true,
}: DocumentViewerProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    expanded ? new Set(Object.keys(document)) : new Set()
  )
  const [expandedStrings, setExpandedStrings] = useState<Set<string>>(new Set())
  const [renderLimit, setRenderLimit] = useState(initialRenderLimit)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Calculate document statistics
  const docStats = useMemo(() => {
    const fieldCount = countFields(document)
    const sizeBytes = estimateDocumentSize(document)
    const isLarge = fieldCount > LARGE_DOC_FIELD_THRESHOLD
    return { fieldCount, sizeBytes, isLarge }
  }, [document])

  const toggleKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleString = useCallback((key: string) => {
    setExpandedStrings((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleCopy = useCallback(async (value: unknown, key: string) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    const success = await copyToClipboard(text)
    if (success) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }, [])

  const renderCopyButton = (value: unknown, key: string) => {
    if (!enableCopy) return null
    return (
      <Tooltip
        trigger={
          <IconButton
            className={`copy-btn ${copyButtonStyles}`}
            aria-label={`Copy ${key} value`}
            onClick={(e) => {
              e.stopPropagation()
              handleCopy(value, key)
            }}
            size="small"
            data-testid={`copy-${key}`}
          >
            <Icon glyph={copiedKey === key ? 'Checkmark' : 'Copy'} size={12} />
          </IconButton>
        }
      >
        {copiedKey === key ? 'Copied!' : 'Copy value'}
      </Tooltip>
    )
  }

  const renderValue = (value: unknown, key: string): React.ReactNode => {
    if (value === null) {
      return <span className={nullValueStyles}>null</span>
    }

    if (value === undefined) {
      return <span className={nullValueStyles}>undefined</span>
    }

    if (typeof value === 'string') {
      // Handle long strings with truncation
      if (value.length > MAX_STRING_LENGTH && !expandedStrings.has(key)) {
        const truncated = value.slice(0, MAX_STRING_LENGTH)
        return (
          <>
            <span className={stringValueStyles}>"{truncated}</span>
            <span
              className={truncatedStyles}
              onClick={(e) => {
                e.stopPropagation()
                toggleString(key)
              }}
              data-testid={`expand-string-${key}`}
            >
              ...{value.length - MAX_STRING_LENGTH} more chars"
            </span>
            {renderCopyButton(value, key)}
          </>
        )
      }
      return (
        <>
          <span className={stringValueStyles}>"{value}"</span>
          {value.length > MAX_STRING_LENGTH && (
            <span
              className={truncatedStyles}
              onClick={(e) => {
                e.stopPropagation()
                toggleString(key)
              }}
            >
              {' '}(collapse)
            </span>
          )}
          {renderCopyButton(value, key)}
        </>
      )
    }

    if (typeof value === 'number') {
      return (
        <>
          <span className={numberValueStyles}>{value}</span>
          {renderCopyButton(value, key)}
        </>
      )
    }

    if (typeof value === 'boolean') {
      return (
        <>
          <span className={booleanValueStyles}>{String(value)}</span>
          {renderCopyButton(value, key)}
        </>
      )
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className={bracketStyles}>[]</span>
      }

      const isExpanded = expandedKeys.has(key)
      return (
        <>
          <span
            className={expandIconStyles}
            onClick={(e) => {
              e.stopPropagation()
              toggleKey(key)
            }}
          >
            <Icon glyph={isExpanded ? 'ChevronDown' : 'ChevronRight'} size={12} />
          </span>
          <span className={bracketStyles}>[</span>
          {isExpanded ? (
            <>
              {value.map((item, i) => (
                <div key={i} className={lineStyles}>
                  <span
                    className={indentStyles}
                    style={{ width: (indentLevel + 1) * 16 }}
                  />
                  <span className={keyStyles}>{i}:</span>
                  {renderValue(item, `${key}.${i}`)}
                  {i < value.length - 1 && <span>,</span>}
                </div>
              ))}
              <div>
                <span
                  className={indentStyles}
                  style={{ width: indentLevel * 16 }}
                />
                <span className={bracketStyles}>]</span>
              </div>
            </>
          ) : (
            <span className={bracketStyles}>
              ...{value.length} items]
            </span>
          )}
        </>
      )
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) {
        return <span className={bracketStyles}>{'{}'}</span>
      }

      const isExpanded = expandedKeys.has(key)
      return (
        <>
          <span
            className={expandIconStyles}
            onClick={(e) => {
              e.stopPropagation()
              toggleKey(key)
            }}
          >
            <Icon glyph={isExpanded ? 'ChevronDown' : 'ChevronRight'} size={12} />
          </span>
          <span className={bracketStyles}>{'{'}</span>
          {isExpanded ? (
            <>
              {entries.map(([k, v], i) => (
                <div key={k} className={lineStyles}>
                  <span
                    className={indentStyles}
                    style={{ width: (indentLevel + 1) * 16 }}
                  />
                  <span className={keyStyles}>"{k}":</span>
                  {renderValue(v, `${key}.${k}`)}
                  {i < entries.length - 1 && <span>,</span>}
                </div>
              ))}
              <div>
                <span
                  className={indentStyles}
                  style={{ width: indentLevel * 16 }}
                />
                <span className={bracketStyles}>{'}'}</span>
              </div>
            </>
          ) : (
            <span className={bracketStyles}>
              ...{entries.length} fields{'}'}
            </span>
          )}
        </>
      )
    }

    return <span className={valueStyles}>{String(value)}</span>
  }

  const entries = Object.entries(document)
  const displayedEntries = entries.slice(0, renderLimit)
  const hasMore = entries.length > renderLimit

  const handleShowMore = useCallback(() => {
    setRenderLimit((prev) => Math.min(prev + INITIAL_RENDER_LIMIT, entries.length))
  }, [entries.length])

  const handleShowAll = useCallback(() => {
    setRenderLimit(entries.length)
  }, [entries.length])

  return (
    <div className={viewerStyles} data-testid="document-viewer">
      {docStats.isLarge && (
        <div className={largeDocBannerStyles} data-testid="large-doc-banner">
          <Icon glyph="Warning" size={16} />
          <span>
            Large document: {docStats.fieldCount} fields ({Math.round(docStats.sizeBytes / 1024)} KB).
            Some fields may be collapsed for performance.
          </span>
        </div>
      )}
      <span className={bracketStyles}>{'{'}</span>
      {displayedEntries.map(([key, value], i) => (
        <div key={key} className={lineWithCopyStyles} data-testid={`doc-field-${key}`}>
          <span className={indentStyles} style={{ width: 16 }} />
          <span className={keyStyles}>"{key}":</span>
          {renderValue(value, key)}
          {i < entries.length - 1 && <span>,</span>}
        </div>
      ))}
      {hasMore && (
        <div className={showMoreStyles} data-testid="show-more-fields">
          <span onClick={handleShowMore}>
            Show {Math.min(INITIAL_RENDER_LIMIT, entries.length - renderLimit)} more fields
          </span>
          {' | '}
          <span onClick={handleShowAll}>
            Show all ({entries.length - renderLimit} remaining)
          </span>
        </div>
      )}
      <span className={bracketStyles}>{'}'}</span>
    </div>
  )
})
