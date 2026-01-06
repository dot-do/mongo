/**
 * Catalog Maintenance Configuration
 *
 * Client for managing Iceberg table maintenance operations:
 * - Compaction configuration
 * - Snapshot expiration
 * - Orphan file cleanup
 * - Data retention policies
 */

import type { R2CatalogClient } from './client'
import {
  type CompactionConfig,
  type SnapshotExpirationConfig,
  type OrphanCleanupConfig,
  type RetentionPolicy,
  type MaintenanceConfig,
  type MaintenanceTaskStatus,
  CatalogError,
} from './types'

/**
 * Maintenance client for managing table maintenance configuration
 */
export class MaintenanceClient {
  private _catalogClient: R2CatalogClient
  private _baseUrl: string

  constructor(catalogClient: R2CatalogClient) {
    this._catalogClient = catalogClient
    const config = catalogClient.getConfig()
    this._baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucketName}/catalog/maintenance`
  }

  /**
   * Get maintenance configuration for a table
   */
  async getConfig(tableId: string): Promise<MaintenanceConfig> {
    const response = await this._request<{ config: MaintenanceConfigResponse }>(
      'GET',
      `/tables/${encodeURIComponent(tableId)}/config`
    )
    return this._mapConfig(response.config)
  }

  /**
   * Update maintenance configuration for a table
   */
  async updateConfig(
    tableId: string,
    config: Partial<MaintenanceConfig>
  ): Promise<MaintenanceConfig> {
    const response = await this._request<{ config: MaintenanceConfigResponse }>(
      'PATCH',
      `/tables/${encodeURIComponent(tableId)}/config`,
      config
    )
    return this._mapConfig(response.config)
  }

  /**
   * Enable compaction for a table
   */
  async enableCompaction(
    tableId: string,
    config?: Partial<CompactionConfig>
  ): Promise<void> {
    // Validate configuration
    if (config?.targetFileSizeBytes !== undefined && config.targetFileSizeBytes <= 0) {
      throw new CatalogError(
        'Invalid target file size',
        'INVALID_CONFIG'
      )
    }

    await this._request('POST', `/tables/${encodeURIComponent(tableId)}/compaction/enable`, {
      ...config,
      enabled: true,
    })
  }

  /**
   * Disable compaction for a table
   */
  async disableCompaction(tableId: string): Promise<void> {
    await this._request('POST', `/tables/${encodeURIComponent(tableId)}/compaction/disable`)
  }

  /**
   * Enable snapshot expiration for a table
   */
  async enableSnapshotExpiration(
    tableId: string,
    config?: Partial<SnapshotExpirationConfig>
  ): Promise<void> {
    // Validate configuration
    if (
      config?.minSnapshotsToRetain !== undefined &&
      config?.maxSnapshotsToRetain !== undefined &&
      config.minSnapshotsToRetain > config.maxSnapshotsToRetain
    ) {
      throw new CatalogError(
        'minSnapshotsToRetain cannot be greater than maxSnapshotsToRetain',
        'INVALID_CONFIG'
      )
    }

    await this._request(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/snapshot-expiration/enable`,
      {
        ...config,
        enabled: true,
      }
    )
  }

  /**
   * Disable snapshot expiration for a table
   */
  async disableSnapshotExpiration(tableId: string): Promise<void> {
    await this._request(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/snapshot-expiration/disable`
    )
  }

  /**
   * Enable orphan file cleanup for a table
   */
  async enableOrphanCleanup(
    tableId: string,
    config?: Partial<OrphanCleanupConfig>
  ): Promise<void> {
    await this._request(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/orphan-cleanup/enable`,
      {
        ...config,
        enabled: true,
      }
    )
  }

  /**
   * Disable orphan file cleanup for a table
   */
  async disableOrphanCleanup(tableId: string): Promise<void> {
    await this._request(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/orphan-cleanup/disable`
    )
  }

  /**
   * Set retention policy for a table
   */
  async setRetentionPolicy(
    tableId: string,
    policy: RetentionPolicy
  ): Promise<void> {
    // Validate policy
    if (policy.retentionDays <= 0) {
      throw new CatalogError(
        'Invalid retention days',
        'INVALID_CONFIG'
      )
    }

    if (policy.action === 'archive' && !policy.archiveLocation) {
      throw new CatalogError(
        'Archive location is required for archive action',
        'INVALID_CONFIG'
      )
    }

    await this._request(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/retention`,
      policy
    )
  }

  /**
   * Remove retention policy from a table
   */
  async removeRetentionPolicy(tableId: string): Promise<void> {
    await this._request(
      'DELETE',
      `/tables/${encodeURIComponent(tableId)}/retention`
    )
  }

  /**
   * Trigger a maintenance task for a table
   */
  async triggerMaintenance(
    tableId: string,
    type: MaintenanceTaskStatus['type']
  ): Promise<MaintenanceTaskStatus> {
    const response = await this._request<{ task: MaintenanceTaskStatusResponse }>(
      'POST',
      `/tables/${encodeURIComponent(tableId)}/trigger`,
      { type }
    )
    return this._mapTaskStatus(response.task)
  }

  /**
   * Get the status of a maintenance task
   */
  async getTaskStatus(taskId: string): Promise<MaintenanceTaskStatus> {
    const response = await this._request<{ task: MaintenanceTaskStatusResponse }>(
      'GET',
      `/tasks/${encodeURIComponent(taskId)}`
    )
    return this._mapTaskStatus(response.task)
  }

  /**
   * List recent maintenance tasks for a table
   */
  async listRecentTasks(
    tableId: string,
    options?: { limit?: number }
  ): Promise<MaintenanceTaskStatus[]> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this._request<{ tasks: MaintenanceTaskStatusResponse[] }>(
      'GET',
      `/tables/${encodeURIComponent(tableId)}/tasks${query ? `?${query}` : ''}`
    )
    return response.tasks.map(this._mapTaskStatus)
  }

  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (this._catalogClient.isClosed()) {
      throw new CatalogError('Client is closed', 'CLIENT_CLOSED')
    }

    const config = this._catalogClient.getConfig()
    const response = await fetch(`${this._baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiToken && {
          Authorization: `Bearer ${config.apiToken}`,
        }),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json()

    if (!response.ok) {
      const error = (data as { error?: { message: string; code: string } }).error
      throw new CatalogError(
        error?.message ?? 'Request failed',
        error?.code ?? 'UNKNOWN_ERROR',
        response.status
      )
    }

    return data as T
  }

  private _mapConfig(response: MaintenanceConfigResponse): MaintenanceConfig {
    return {
      tableId: response.tableId,
      compaction: response.compaction,
      snapshotExpiration: response.snapshotExpiration,
      orphanCleanup: response.orphanCleanup,
      retention: response.retention,
      lastMaintenanceRun: response.lastMaintenanceRun
        ? new Date(response.lastMaintenanceRun)
        : undefined,
      nextMaintenanceRun: response.nextMaintenanceRun
        ? new Date(response.nextMaintenanceRun)
        : undefined,
    }
  }

  private _mapTaskStatus(
    response: MaintenanceTaskStatusResponse
  ): MaintenanceTaskStatus {
    return {
      taskId: response.taskId,
      type: response.type,
      status: response.status,
      startedAt: response.startedAt ? new Date(response.startedAt) : undefined,
      completedAt: response.completedAt
        ? new Date(response.completedAt)
        : undefined,
      error: response.error,
      metrics: response.metrics,
    }
  }
}

interface MaintenanceConfigResponse {
  tableId: string
  compaction: CompactionConfig
  snapshotExpiration: SnapshotExpirationConfig
  orphanCleanup: OrphanCleanupConfig
  retention?: RetentionPolicy
  lastMaintenanceRun?: string
  nextMaintenanceRun?: string
}

interface MaintenanceTaskStatusResponse {
  taskId: string
  type: MaintenanceTaskStatus['type']
  status: MaintenanceTaskStatus['status']
  startedAt?: string
  completedAt?: string
  error?: string
  metrics?: MaintenanceTaskStatus['metrics']
}

/**
 * Create a maintenance client for a catalog
 */
export function createMaintenanceClient(
  catalogClient: R2CatalogClient
): MaintenanceClient {
  return new MaintenanceClient(catalogClient)
}
