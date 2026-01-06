/**
 * Compaction Manager
 *
 * Enhanced compaction management for Iceberg tables with auto-scheduling,
 * binpack/sort strategies, and status tracking.
 */

import type { R2CatalogClient } from './client'
import type { MaintenanceClient } from './maintenance'
import { CatalogError } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Target file size presets
 */
export type TargetSizePreset = 128 | 256 | 512

/**
 * Compaction schedule options
 */
export type CompactionSchedule = 'hourly' | 'daily' | 'weekly' | 'manual'

/**
 * Auto-compaction configuration
 */
export interface AutoCompactionConfig {
  /** Target file size in MB */
  targetSizeMB: TargetSizePreset
  /** Compaction schedule */
  schedule: CompactionSchedule
  /** Minimum number of small files to trigger compaction */
  minFiles?: number
  /** Maximum concurrent compaction tasks */
  maxConcurrent?: number
  /** Sort order for sorted compaction (optional) */
  sortOrder?: Array<{ field: string; direction: 'asc' | 'desc' }>
}

/**
 * Compaction job information
 */
export interface CompactionJob {
  /** Job ID */
  jobId: string
  /** Table identifier */
  tableId: string
  /** Job status */
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** Creation timestamp */
  createdAt: Date
  /** Start timestamp */
  startedAt?: Date
  /** Completion timestamp */
  completedAt?: Date
  /** Job metrics */
  metrics?: {
    inputFiles: number
    outputFiles: number
    inputSizeBytes: number
    outputSizeBytes: number
    rewrittenRecords: number
    failedRecords: number
  }
  /** Error message if failed */
  error?: string
}

/**
 * Table compaction status
 */
export interface CompactionStatus {
  /** Table identifier */
  tableId: string
  /** Whether auto-compaction is enabled */
  enabled: boolean
  /** Current configuration */
  config?: AutoCompactionConfig
  /** Last compaction job */
  lastJob?: CompactionJob
  /** Next scheduled compaction */
  nextScheduled?: Date
  /** Current file statistics */
  fileStats: {
    totalFiles: number
    smallFiles: number
    averageFileSizeBytes: number
    totalSizeBytes: number
  }
  /** Compaction recommendation */
  recommendation: 'not_needed' | 'recommended' | 'urgent'
}

// =============================================================================
// Compaction Manager Class
// =============================================================================

/**
 * Manages table compaction with scheduling and optimization
 */
export class CompactionManager {
  private _catalogClient: R2CatalogClient
  private _maintenanceClient: MaintenanceClient
  private _autoCompactionConfigs = new Map<string, AutoCompactionConfig>()
  private _activeJobs = new Map<string, CompactionJob>()
  private _scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(catalogClient: R2CatalogClient, maintenanceClient: MaintenanceClient) {
    this._catalogClient = catalogClient
    this._maintenanceClient = maintenanceClient
  }

  /**
   * Enable auto-compaction for a table
   */
  async enableAutoCompaction(tableId: string, config: AutoCompactionConfig): Promise<void> {
    // Validate configuration
    if (![128, 256, 512].includes(config.targetSizeMB)) {
      throw new CatalogError(
        'Invalid target size. Must be 128, 256, or 512 MB',
        'INVALID_CONFIG'
      )
    }

    // Store configuration
    this._autoCompactionConfigs.set(tableId, {
      ...config,
      minFiles: config.minFiles ?? 10,
      maxConcurrent: config.maxConcurrent ?? 2,
    })

    // Enable compaction via maintenance client
    await this._maintenanceClient.enableCompaction(tableId, {
      targetFileSizeBytes: config.targetSizeMB * 1024 * 1024,
      minFilesToCompact: config.minFiles ?? 10,
      strategy: config.sortOrder ? 'sort' : 'binpack',
      sortOrder: config.sortOrder,
    })

    // Schedule next compaction based on schedule
    if (config.schedule !== 'manual') {
      this._scheduleNextCompaction(tableId, config.schedule)
    }
  }

  /**
   * Disable auto-compaction for a table
   */
  async disableAutoCompaction(tableId: string): Promise<void> {
    this._autoCompactionConfigs.delete(tableId)

    // Cancel any scheduled compaction
    const timer = this._scheduledTimers.get(tableId)
    if (timer) {
      clearTimeout(timer)
      this._scheduledTimers.delete(tableId)
    }

    await this._maintenanceClient.disableCompaction(tableId)
  }

  /**
   * Trigger a compaction job manually
   */
  async triggerCompaction(tableId: string): Promise<CompactionJob> {
    // Check if there's already an active job
    const activeJob = this._activeJobs.get(tableId)
    if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
      throw new CatalogError(
        'Compaction already in progress for this table',
        'COMPACTION_IN_PROGRESS'
      )
    }

    // Create a new job
    const job: CompactionJob = {
      jobId: `compact-${tableId}-${Date.now()}`,
      tableId,
      status: 'queued',
      createdAt: new Date(),
    }

    this._activeJobs.set(tableId, job)

    // Trigger via maintenance client
    try {
      const taskStatus = await this._maintenanceClient.triggerMaintenance(tableId, 'compaction')

      // Update job status
      job.status = 'running'
      job.startedAt = new Date()

      return job
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Unknown error'
      throw error
    }
  }

  /**
   * Get compaction status for a table
   */
  async getCompactionStatus(tableId: string): Promise<CompactionStatus> {
    const config = this._autoCompactionConfigs.get(tableId)
    const activeJob = this._activeJobs.get(tableId)

    // Get file statistics (would come from actual table metadata)
    const fileStats = await this._getFileStats(tableId)

    // Determine recommendation
    let recommendation: CompactionStatus['recommendation'] = 'not_needed'
    if (fileStats.smallFiles > 50) {
      recommendation = 'urgent'
    } else if (fileStats.smallFiles > 20) {
      recommendation = 'recommended'
    }

    return {
      tableId,
      enabled: config !== undefined,
      config,
      lastJob: activeJob,
      nextScheduled: this._getNextScheduledTime(tableId),
      fileStats,
      recommendation,
    }
  }

  /**
   * Cancel a running compaction job
   */
  async cancelCompaction(tableId: string): Promise<void> {
    const job = this._activeJobs.get(tableId)
    if (!job) {
      throw new CatalogError('No compaction job found for table', 'JOB_NOT_FOUND')
    }

    if (job.status === 'completed' || job.status === 'failed') {
      throw new CatalogError('Cannot cancel a completed job', 'JOB_COMPLETED')
    }

    job.status = 'cancelled'
    job.completedAt = new Date()
  }

  /**
   * Get active compaction jobs
   */
  getActiveJobs(): CompactionJob[] {
    return Array.from(this._activeJobs.values()).filter(
      (j) => j.status === 'queued' || j.status === 'running'
    )
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    Array.from(this._scheduledTimers.values()).forEach((timer) => {
      clearTimeout(timer)
    })
    this._scheduledTimers.clear()
    this._autoCompactionConfigs.clear()
    this._activeJobs.clear()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _scheduleNextCompaction(tableId: string, schedule: CompactionSchedule): void {
    const delay = this._getScheduleDelayMs(schedule)

    const timer = setTimeout(async () => {
      try {
        await this.triggerCompaction(tableId)
      } catch {
        // Log error but continue scheduling
      }

      // Reschedule next compaction
      this._scheduleNextCompaction(tableId, schedule)
    }, delay)

    this._scheduledTimers.set(tableId, timer)
  }

  private _getScheduleDelayMs(schedule: CompactionSchedule): number {
    switch (schedule) {
      case 'hourly':
        return 60 * 60 * 1000 // 1 hour
      case 'daily':
        return 24 * 60 * 60 * 1000 // 24 hours
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000 // 7 days
      default:
        return 0
    }
  }

  private _getNextScheduledTime(tableId: string): Date | undefined {
    const config = this._autoCompactionConfigs.get(tableId)
    if (!config || config.schedule === 'manual') {
      return undefined
    }

    const delayMs = this._getScheduleDelayMs(config.schedule)
    return new Date(Date.now() + delayMs)
  }

  private async _getFileStats(tableId: string): Promise<CompactionStatus['fileStats']> {
    // In a real implementation, this would query the table metadata
    // For now, return placeholder values
    return {
      totalFiles: 100,
      smallFiles: 30,
      averageFileSizeBytes: 256 * 1024 * 1024,
      totalSizeBytes: 25.6 * 1024 * 1024 * 1024,
    }
  }
}

/**
 * Create a compaction manager
 */
export function createCompactionManager(
  catalogClient: R2CatalogClient,
  maintenanceClient: MaintenanceClient
): CompactionManager {
  return new CompactionManager(catalogClient, maintenanceClient)
}
