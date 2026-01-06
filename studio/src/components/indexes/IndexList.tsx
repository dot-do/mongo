import { useState, useCallback, useMemo } from 'react'
import { css, cx } from '@leafygreen-ui/emotion'
import { palette } from '@leafygreen-ui/palette'
import { Body, Subtitle, InlineCode, H3 } from '@leafygreen-ui/typography'
import Button from '@leafygreen-ui/button'
import Icon from '@leafygreen-ui/icon'
import IconButton from '@leafygreen-ui/icon-button'
import Badge from '@leafygreen-ui/badge'
import Tooltip from '@leafygreen-ui/tooltip'
import Modal from '@leafygreen-ui/modal'
import { useIndexesQuery, useDropIndexMutation } from '@hooks/useQueries'
import { SkeletonLoader } from '../SkeletonLoader'
import { CreateIndexDialog } from './CreateIndexDialog'
import type { IndexInfo, IndexUsageStats } from '@lib/rpc-client'

const containerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const headerStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const headerLeftStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
`

const tableContainerStyles = css`
  border: 1px solid ${palette.gray.light2};
  border-radius: 8px;
  overflow: hidden;
`

const tableStyles = css`
  width: 100%;
  border-collapse: collapse;
`

const headerRowStyles = css`
  background: ${palette.gray.light3};
`

const headerCellStyles = css`
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${palette.gray.dark1};
  border-bottom: 1px solid ${palette.gray.light2};
`

const rowStyles = css`
  &:hover {
    background: ${palette.gray.light3};
  }

  &:not(:last-child) {
    border-bottom: 1px solid ${palette.gray.light2};
  }
`

const cellStyles = css`
  padding: 12px 16px;
  vertical-align: middle;
`

const keysCellStyles = css`
  font-family: 'Source Code Pro', monospace;
  font-size: 13px;
`

const badgeContainerStyles = css`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`

const actionsCellStyles = css`
  width: 80px;
  text-align: right;
`

const emptyStateStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: ${palette.gray.dark1};
  border: 1px solid ${palette.gray.light2};
  border-radius: 8px;
`

const errorStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: ${palette.red.base};
  border: 1px solid ${palette.red.light2};
  border-radius: 8px;
  background: ${palette.red.light3};
`

// Format index keys for display
function formatIndexKeys(key: Record<string, 1 | -1 | 'text' | '2dsphere'>): string {
  return Object.entries(key)
    .map(([field, direction]) => {
      if (direction === 1) return `${field}: 1`
      if (direction === -1) return `${field}: -1`
      return `${field}: "${direction}"`
    })
    .join(', ')
}

// Format bytes to human-readable format
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)

  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// Format usage stats
function formatUsageStats(stats: IndexUsageStats | undefined): string {
  if (!stats) return '-'
  return `${stats.accesses.toLocaleString()} hits`
}

export interface IndexListProps {
  database: string
  collection: string
}

export function IndexList({ database, collection }: IndexListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState<IndexInfo | null>(null)

  const { data: indexes, isLoading, error, refetch } = useIndexesQuery(database, collection)
  const dropIndexMutation = useDropIndexMutation(database, collection)

  const handleCreateSuccess = useCallback(() => {
    refetch()
  }, [refetch])

  const handleDropSuccess = useCallback(() => {
    setDropTarget(null)
    refetch()
  }, [refetch])

  if (isLoading) {
    return (
      <div className={containerStyles} data-testid="index-list-loading">
        <div className={headerStyles}>
          <div className={headerLeftStyles}>
            <Subtitle>Indexes</Subtitle>
          </div>
        </div>
        <SkeletonLoader count={3} height={48} />
      </div>
    )
  }

  if (error) {
    return (
      <div className={containerStyles} data-testid="index-list-error">
        <div className={errorStyles}>
          <Icon glyph="Warning" size="xlarge" />
          <Subtitle>Error loading indexes: {error instanceof Error ? error.message : String(error)}</Subtitle>
          <Button
            variant="default"
            onClick={() => refetch()}
            style={{ marginTop: 16 }}
            leftGlyph={<Icon glyph="Refresh" />}
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const indexList = indexes ?? []

  return (
    <div className={containerStyles} data-testid="index-list">
      <div className={headerStyles}>
        <div className={headerLeftStyles}>
          <Subtitle>Indexes</Subtitle>
          <Badge variant="lightgray">
            {indexList.length} {indexList.length === 1 ? 'index' : 'indexes'}
          </Badge>
        </div>
        <div>
          <Button
            variant="primary"
            leftGlyph={<Icon glyph="Plus" />}
            onClick={() => setCreateOpen(true)}
            data-testid="create-index-button"
          >
            Create Index
          </Button>
        </div>
      </div>

      {indexList.length === 0 ? (
        <div className={emptyStateStyles} data-testid="index-list-empty">
          <Icon glyph="Diagram2" size="xlarge" />
          <Subtitle style={{ marginTop: 16 }}>No indexes found</Subtitle>
          <Body>Create an index to improve query performance.</Body>
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            style={{ marginTop: 16 }}
            leftGlyph={<Icon glyph="Plus" />}
          >
            Create Index
          </Button>
        </div>
      ) : !dropTarget ? (
        <div className={tableContainerStyles}>
          <table className={tableStyles} data-testid="index-table" role="table">
            <thead>
              <tr className={headerRowStyles}>
                <th className={headerCellStyles} role="columnheader">Name</th>
                <th className={headerCellStyles} role="columnheader">Keys</th>
                <th className={headerCellStyles} role="columnheader">Properties</th>
                <th className={headerCellStyles} style={{ width: 100 }} role="columnheader">Size</th>
                <th className={headerCellStyles} style={{ width: 120 }} role="columnheader">Usage</th>
                <th className={headerCellStyles} style={{ width: 80 }} role="columnheader">Actions</th>
              </tr>
            </thead>
            <tbody>
              {indexList.map((index) => (
                <tr key={index.name} className={rowStyles} data-testid={`index-row-${index.name}`}>
                  <td className={cellStyles}>
                    <InlineCode>{index.name}</InlineCode>
                  </td>
                  <td className={`${cellStyles} ${keysCellStyles}`}>
                    {'{ '}{formatIndexKeys(index.key)}{' }'}
                  </td>
                  <td className={cellStyles}>
                    <div className={badgeContainerStyles}>
                      {index.unique && (
                        <Badge variant="blue">unique</Badge>
                      )}
                      {index.sparse && (
                        <Badge variant="yellow">sparse</Badge>
                      )}
                      {index.expireAfterSeconds !== undefined && (
                        <Badge variant="green">TTL: {index.expireAfterSeconds}s</Badge>
                      )}
                      {index.name === '_id_' && (
                        <Badge variant="lightgray">default</Badge>
                      )}
                    </div>
                  </td>
                  <td className={cellStyles} data-testid={`index-size-${index.name}`}>
                    {formatBytes(index.sizeBytes)}
                  </td>
                  <td className={cellStyles} data-testid={`index-usage-${index.name}`}>
                    {formatUsageStats(index.usageStats)}
                  </td>
                  <td className={`${cellStyles} ${actionsCellStyles}`}>
                    {index.name !== '_id_' ? (
                      <Tooltip
                        trigger={
                          <IconButton
                            aria-label={`Drop index ${index.name}`}
                            onClick={() => setDropTarget(index)}
                            data-testid={`drop-index-${index.name}`}
                          >
                            <Icon glyph="Trash" />
                          </IconButton>
                        }
                      >
                        Drop index
                      </Tooltip>
                    ) : (
                      <Tooltip
                        trigger={
                          <IconButton
                            aria-label="Cannot drop _id index"
                            disabled
                            data-testid="drop-index-disabled"
                          >
                            <Icon glyph="Lock" />
                          </IconButton>
                        }
                      >
                        Cannot drop the default _id index
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Create Index Dialog */}
      <CreateIndexDialog
        database={database}
        collection={collection}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      {/* Drop Index Dialog */}
      {dropTarget && (
        <DropIndexDialog
          indexName={dropTarget.name}
          open={!!dropTarget}
          onClose={() => setDropTarget(null)}
          onSuccess={handleDropSuccess}
          dropMutation={dropIndexMutation}
        />
      )}
    </div>
  )
}

// Simple drop index dialog component
interface DropIndexDialogProps {
  indexName: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  dropMutation: ReturnType<typeof useDropIndexMutation>
}

function DropIndexDialog({
  indexName,
  open,
  onClose,
  onSuccess,
  dropMutation,
}: DropIndexDialogProps) {
  const [error, setError] = useState<string | null>(null)

  const handleDrop = useCallback(async () => {
    setError(null)
    try {
      await dropMutation.mutateAsync(indexName)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to drop index')
    }
  }, [dropMutation, indexName, onSuccess, onClose])

  return (
    <Modal open={open} setOpen={onClose}>
      <div style={{ padding: 24 }}>
        <H3>Drop Index</H3>
        <Body style={{ marginTop: 16, marginBottom: 16 }}>
          Are you sure you want to drop the index <strong data-testid="drop-index-name">{indexName}</strong>?
          This action cannot be undone.
        </Body>
        {error && (
          <Body style={{ color: palette.red.dark2, marginBottom: 16 }}>{error}</Body>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDrop}
            disabled={dropMutation.isPending}
          >
            {dropMutation.isPending ? 'Dropping...' : 'Drop Index'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default IndexList
