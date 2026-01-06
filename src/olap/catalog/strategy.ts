/**
 * Multi-Table Maintenance Strategy
 *
 * Coordinates maintenance operations across multiple Iceberg tables
 * with configurable scheduling and prioritization strategies.
 */

import type { R2CatalogClient } from './client'
import type { MaintenanceClient } from './maintenance'
import type { CompactionManager, AutoCompactionConfig } from './compaction'
import type { SchemaEvolutionManager, SchemaEvolutionConfig } from './evolution'
import { CatalogError } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Priority levels for maintenance operations
 */
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'critical'

/**
 * Strategy for ordering maintenance across tables
 */
export type MaintenanceOrderStrategy =
  | 'round-robin'
  | 'priority-based'
  | 'size-based'
  | 'age-based'

/**
 * Table maintenance policy
 */
export interface TableMaintenancePolicy {
  /** Table identifier (namespace.table) */
  tableId: string
  /** Maintenance priority */
  priority: MaintenancePriority
  /** Auto-compaction configuration */
  compaction?: AutoCompactionConfig
  /** Schema evolution configuration */
  schemaEvolution?: SchemaEvolutionConfig
  /** Whether table is actively being maintained */
  enabled: boolean
  /** Custom tags for grouping */
  tags?: string[]
}

/**
 * Multi-table strategy configuration
 */
export interface MultiTableStrategyConfig {
  /** Maximum concurrent maintenance tasks across all tables */
  maxConcurrentTasks: number
  /** Strategy for ordering maintenance */
  orderStrategy: MaintenanceOrderStrategy
  /** Interval between strategy evaluations (ms) */
  evaluationIntervalMs: number
  /** Whether to pause on errors */
  pauseOnError: boolean
  /** Maximum retries per table before skipping */
  maxRetriesPerTable: number
}

/**
 * Table health status
 */
export interface TableHealth {
  /** Table identifier */
  tableId: string
  /** Overall health score (0-100) */
  healthScore: number
  /** Number of small files */
  smallFileCount: number
  /** Total file count */
  totalFileCount: number
  /** Average file size in bytes */
  averageFileSizeBytes: number
  /** Days since last compaction */
  daysSinceCompaction: number
  /** Pending schema evolutions */
  pendingSchemaChanges: number
  /** Recommendation */
  recommendation: 'healthy' | 'needs_attention' | 'critical'
}

/**
 * Strategy execution status
 */
export interface StrategyExecutionStatus {
  /** Whether strategy is currently running */
  running: boolean
  /** Tables currently being processed */
  activeTables: string[]
  /** Tables queued for processing */
  queuedTables: string[]
  /** Tables that have completed in current cycle */
  completedTables: string[]
  /** Tables that failed in current cycle */
  failedTables: Array<{ tableId: string; error: string }>
  /** Last evaluation timestamp */
  lastEvaluation?: Date
  /** Next scheduled evaluation */
  nextEvaluation?: Date
}

// =============================================================================
// Multi-Table Strategy Manager
// =============================================================================

/**
 * Manages maintenance operations across multiple tables
 */
export class MultiTableStrategyManager {
  private _catalogClient: R2CatalogClient
  private _maintenanceClient: MaintenanceClient
  private _compactionManagers = new Map<string, CompactionManager>()
  private _evolutionManagers = new Map<string, SchemaEvolutionManager>()
  private _policies = new Map<string, TableMaintenancePolicy>()
  private _config: MultiTableStrategyConfig
  private _status: StrategyExecutionStatus
  private _evaluationTimer?: ReturnType<typeof setInterval>
  private _retryCount = new Map<string, number>()

  constructor(
    catalogClient: R2CatalogClient,
    maintenanceClient: MaintenanceClient,
    config: Partial<MultiTableStrategyConfig> = {}
  ) {
    this._catalogClient = catalogClient
    this._maintenanceClient = maintenanceClient
    this._config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 3,
      orderStrategy: config.orderStrategy ?? 'priority-based',
      evaluationIntervalMs: config.evaluationIntervalMs ?? 60000,
      pauseOnError: config.pauseOnError ?? false,
      maxRetriesPerTable: config.maxRetriesPerTable ?? 3,
    }
    this._status = {
      running: false,
      activeTables: [],
      queuedTables: [],
      completedTables: [],
      failedTables: [],
    }
  }

  /**
   * Register a table for multi-table maintenance
   */
  registerTable(policy: TableMaintenancePolicy): void {
    this._policies.set(policy.tableId, policy)
    this._retryCount.set(policy.tableId, 0)
  }

  /**
   * Unregister a table from maintenance
   */
  unregisterTable(tableId: string): void {
    this._policies.delete(tableId)
    this._compactionManagers.get(tableId)?.dispose()
    this._compactionManagers.delete(tableId)
    this._evolutionManagers.delete(tableId)
    this._retryCount.delete(tableId)
  }

  /**
   * Update a table's maintenance policy
   */
  updatePolicy(tableId: string, updates: Partial<TableMaintenancePolicy>): void {
    const existing = this._policies.get(tableId)
    if (!existing) {
      throw new CatalogError(`Table ${tableId} not registered`, 'TABLE_NOT_FOUND')
    }

    this._policies.set(tableId, { ...existing, ...updates })
  }

  /**
   * Get all registered tables
   */
  getRegisteredTables(): TableMaintenancePolicy[] {
    return Array.from(this._policies.values())
  }

  /**
   * Get tables by tag
   */
  getTablesByTag(tag: string): TableMaintenancePolicy[] {
    return Array.from(this._policies.values()).filter((p) =>
      p.tags?.includes(tag)
    )
  }

  /**
   * Start the multi-table strategy
   */
  start(): void {
    if (this._status.running) {
      return
    }

    this._status.running = true
    this._evaluateAndExecute()

    this._evaluationTimer = setInterval(() => {
      this._evaluateAndExecute()
    }, this._config.evaluationIntervalMs)
  }

  /**
   * Stop the multi-table strategy
   */
  stop(): void {
    this._status.running = false
    if (this._evaluationTimer) {
      clearInterval(this._evaluationTimer)
      this._evaluationTimer = undefined
    }
  }

  /**
   * Get current execution status
   */
  getStatus(): StrategyExecutionStatus {
    return { ...this._status }
  }

  /**
   * Get health status for all tables
   */
  async getFleetHealth(): Promise<TableHealth[]> {
    const healthReports: TableHealth[] = []
    const entries = Array.from(this._policies.entries())

    for (const [tableId, policy] of entries) {
      if (!policy.enabled) continue

      try {
        const health = await this._getTableHealth(tableId)
        healthReports.push(health)
      } catch {
        healthReports.push({
          tableId,
          healthScore: 0,
          smallFileCount: 0,
          totalFileCount: 0,
          averageFileSizeBytes: 0,
          daysSinceCompaction: -1,
          pendingSchemaChanges: 0,
          recommendation: 'critical',
        })
      }
    }

    return healthReports.sort((a, b) => a.healthScore - b.healthScore)
  }

  /**
   * Manually trigger maintenance for a specific table
   */
  async triggerTableMaintenance(tableId: string): Promise<void> {
    const policy = this._policies.get(tableId)
    if (!policy) {
      throw new CatalogError(`Table ${tableId} not registered`, 'TABLE_NOT_FOUND')
    }

    if (!policy.enabled) {
      throw new CatalogError(`Table ${tableId} is disabled`, 'TABLE_DISABLED')
    }

    await this._executeTableMaintenance(tableId, policy)
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop()
    Array.from(this._compactionManagers.values()).forEach((manager) => {
      manager.dispose()
    })
    this._compactionManagers.clear()
    this._evolutionManagers.clear()
    this._policies.clear()
    this._retryCount.clear()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async _evaluateAndExecute(): Promise<void> {
    this._status.lastEvaluation = new Date()
    this._status.nextEvaluation = new Date(
      Date.now() + this._config.evaluationIntervalMs
    )

    // Get enabled tables sorted by strategy
    const tablesToProcess = this._getOrderedTables()

    // Update queued status
    this._status.queuedTables = tablesToProcess.map((t) => t.tableId)

    // Process tables up to max concurrent
    const availableSlots =
      this._config.maxConcurrentTasks - this._status.activeTables.length

    for (let i = 0; i < Math.min(availableSlots, tablesToProcess.length); i++) {
      const policy = tablesToProcess[i]
      if (this._status.activeTables.includes(policy.tableId)) {
        continue
      }

      this._processTable(policy)
    }
  }

  private _getOrderedTables(): TableMaintenancePolicy[] {
    const enabled = Array.from(this._policies.values()).filter(
      (p) =>
        p.enabled &&
        !this._status.activeTables.includes(p.tableId) &&
        !this._hasExceededRetries(p.tableId)
    )

    switch (this._config.orderStrategy) {
      case 'priority-based':
        return this._sortByPriority(enabled)
      case 'round-robin':
        return this._sortRoundRobin(enabled)
      case 'size-based':
        return enabled // Would need size info
      case 'age-based':
        return enabled // Would need last maintenance time
      default:
        return enabled
    }
  }

  private _sortByPriority(
    tables: TableMaintenancePolicy[]
  ): TableMaintenancePolicy[] {
    const priorityOrder: Record<MaintenancePriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    return [...tables].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    )
  }

  private _sortRoundRobin(
    tables: TableMaintenancePolicy[]
  ): TableMaintenancePolicy[] {
    // Prioritize tables not yet completed in this cycle
    const notCompleted = tables.filter(
      (t) => !this._status.completedTables.includes(t.tableId)
    )
    const completed = tables.filter((t) =>
      this._status.completedTables.includes(t.tableId)
    )

    return [...notCompleted, ...completed]
  }

  private _hasExceededRetries(tableId: string): boolean {
    const retries = this._retryCount.get(tableId) ?? 0
    return retries >= this._config.maxRetriesPerTable
  }

  private async _processTable(policy: TableMaintenancePolicy): Promise<void> {
    this._status.activeTables.push(policy.tableId)
    this._status.queuedTables = this._status.queuedTables.filter(
      (t) => t !== policy.tableId
    )

    try {
      await this._executeTableMaintenance(policy.tableId, policy)
      this._status.completedTables.push(policy.tableId)
      this._retryCount.set(policy.tableId, 0)
    } catch (error) {
      const retries = (this._retryCount.get(policy.tableId) ?? 0) + 1
      this._retryCount.set(policy.tableId, retries)

      this._status.failedTables.push({
        tableId: policy.tableId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      if (this._config.pauseOnError) {
        this.stop()
      }
    } finally {
      this._status.activeTables = this._status.activeTables.filter(
        (t) => t !== policy.tableId
      )
    }
  }

  private async _executeTableMaintenance(
    tableId: string,
    policy: TableMaintenancePolicy
  ): Promise<void> {
    // Trigger compaction if configured
    if (policy.compaction) {
      await this._maintenanceClient.triggerMaintenance(tableId, 'compaction')
    }

    // Trigger snapshot expiration
    await this._maintenanceClient.triggerMaintenance(
      tableId,
      'snapshot-expiration'
    )

    // Trigger orphan cleanup
    await this._maintenanceClient.triggerMaintenance(tableId, 'orphan-cleanup')
  }

  private async _getTableHealth(tableId: string): Promise<TableHealth> {
    // In a real implementation, this would query actual table metrics
    // For now, return placeholder values
    return {
      tableId,
      healthScore: 75,
      smallFileCount: 25,
      totalFileCount: 100,
      averageFileSizeBytes: 256 * 1024 * 1024,
      daysSinceCompaction: 3,
      pendingSchemaChanges: 0,
      recommendation: 'healthy',
    }
  }
}

/**
 * Create a multi-table strategy manager
 */
export function createMultiTableStrategyManager(
  catalogClient: R2CatalogClient,
  maintenanceClient: MaintenanceClient,
  config?: Partial<MultiTableStrategyConfig>
): MultiTableStrategyManager {
  return new MultiTableStrategyManager(catalogClient, maintenanceClient, config)
}
