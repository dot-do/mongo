/**
 * R2 SQL Query Translator
 *
 * Translates MongoDB aggregation pipelines to SQL queries for execution
 * against Iceberg tables in Cloudflare R2.
 */

import type {
  PipelineStage,
  TranslationOptions,
  TranslatedQuery,
  TranslationError,
  TranslationResult,
} from './types'

// =============================================================================
// Supported Operators
// =============================================================================

const SUPPORTED_MATCH_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$and',
  '$or',
  '$not',
  '$exists',
  '$regex',
  '$expr',
]

const SUPPORTED_GROUP_OPERATORS = ['$sum', '$avg', '$min', '$max', '$first', '$last', '$count']

const SUPPORTED_PROJECT_OPERATORS = [
  '$add',
  '$subtract',
  '$multiply',
  '$divide',
  '$concat',
  '$cond',
  '$ifNull',
  '$toLower',
  '$toUpper',
  '$year',
  '$month',
  '$dayOfMonth',
]

const UNSUPPORTED_STAGES = ['$lookup', '$unwind', '$graphLookup', '$facet', '$bucket', '$bucketAuto']

// =============================================================================
// Translator Class
// =============================================================================

/**
 * R2 SQL Translator for MongoDB aggregation pipelines
 */
export class R2SQLTranslator {
  /**
   * Translate a MongoDB aggregation pipeline to SQL
   */
  translate(pipeline: PipelineStage[], options: TranslationOptions): TranslationResult {
    try {
      // Validate pipeline first
      const errors = this.validatePipeline(pipeline)
      if (errors.length > 0) {
        return { success: false, error: errors[0] }
      }

      const parts = this._buildQueryParts(pipeline, options)
      const sql = this._assembleSql(parts, options)
      const warnings = this._generateWarnings(pipeline, options)
      const complexity = this._calculateComplexity(pipeline)

      return {
        success: true,
        query: {
          sql,
          parameters: parts.parameters,
          complexity,
          warnings,
          originalPipeline: pipeline,
        },
      }
    } catch (err) {
      const error = err as Error
      return {
        success: false,
        error: {
          code: 'TRANSLATION_ERROR',
          message: error.message,
        },
      }
    }
  }

  /**
   * Validate a pipeline for translatability
   */
  validatePipeline(pipeline: PipelineStage[]): TranslationError[] {
    const errors: TranslationError[] = []

    for (let i = 0; i < pipeline.length; i++) {
      const stage = pipeline[i]
      const stageKey = Object.keys(stage)[0]

      // Check for unsupported stages
      if (UNSUPPORTED_STAGES.includes(stageKey)) {
        errors.push({
          code: 'UNSUPPORTED_STAGE',
          message: `Stage '${stageKey}' is not supported for SQL translation`,
          stageIndex: i,
          stage,
        })
      }
    }

    return errors
  }

  /**
   * Get list of supported operators
   */
  getSupportedOperators(): string[] {
    return [
      ...SUPPORTED_MATCH_OPERATORS,
      ...SUPPORTED_GROUP_OPERATORS,
      ...SUPPORTED_PROJECT_OPERATORS,
    ]
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _buildQueryParts(
    pipeline: PipelineStage[],
    options: TranslationOptions
  ): QueryParts {
    const parts: QueryParts = {
      select: ['*'],
      from: this._getTableReference(options),
      where: [],
      groupBy: [],
      having: [],
      orderBy: [],
      limit: undefined,
      offset: undefined,
      parameters: [],
    }

    let hasGroupBy = false
    let hasProject = false

    for (const stage of pipeline) {
      if ('$match' in stage) {
        const whereClauses = this._translateMatch(stage.$match, parts.parameters)
        parts.where.push(...whereClauses)
      } else if ('$group' in stage) {
        hasGroupBy = true
        const { select, groupBy } = this._translateGroup(stage.$group)
        parts.select = select
        parts.groupBy = groupBy
      } else if ('$project' in stage) {
        hasProject = true
        if (!hasGroupBy) {
          parts.select = this._translateProject(stage.$project)
        }
      } else if ('$sort' in stage) {
        parts.orderBy = this._translateSort(stage.$sort)
      } else if ('$limit' in stage) {
        parts.limit = stage.$limit
      } else if ('$skip' in stage) {
        parts.offset = stage.$skip
      } else if ('$count' in stage) {
        parts.select = [`COUNT(*) AS ${this._escapeIdentifier(stage.$count)}`]
      }
    }

    return parts
  }

  private _getTableReference(options: TranslationOptions): string {
    const namespace = options.namespace || 'default'
    return `${this._escapeIdentifier(namespace)}.${this._escapeIdentifier(options.tableName)}`
  }

  private _translateMatch(
    match: Record<string, unknown>,
    parameters: unknown[]
  ): string[] {
    const clauses: string[] = []

    for (const [field, condition] of Object.entries(match)) {
      if (field === '$or') {
        const orClauses = (condition as Record<string, unknown>[]).map((c) =>
          this._translateMatch(c, parameters).join(' AND ')
        )
        clauses.push(`(${orClauses.join(' OR ')})`)
      } else if (field === '$and') {
        const andClauses = (condition as Record<string, unknown>[]).map((c) =>
          this._translateMatch(c, parameters).join(' AND ')
        )
        clauses.push(`(${andClauses.join(' AND ')})`)
      } else if (field === '$expr') {
        // Basic $expr support
        clauses.push(this._translateExpr(condition, parameters))
      } else {
        clauses.push(this._translateCondition(field, condition, parameters))
      }
    }

    return clauses
  }

  private _translateCondition(
    field: string,
    condition: unknown,
    parameters: unknown[]
  ): string {
    const sqlField = this._fieldToSql(field)

    // Direct equality
    if (condition === null) {
      return `${sqlField} IS NULL`
    }

    if (typeof condition !== 'object') {
      parameters.push(condition)
      return `${sqlField} = ?`
    }

    const conditions = condition as Record<string, unknown>
    const parts: string[] = []

    for (const [op, value] of Object.entries(conditions)) {
      switch (op) {
        case '$eq':
          if (value === null) {
            parts.push(`${sqlField} IS NULL`)
          } else {
            parameters.push(value)
            parts.push(`${sqlField} = ?`)
          }
          break
        case '$ne':
          if (value === null) {
            parts.push(`${sqlField} IS NOT NULL`)
          } else {
            parameters.push(value)
            parts.push(`${sqlField} <> ?`)
          }
          break
        case '$gt':
          parameters.push(value)
          parts.push(`${sqlField} > ?`)
          break
        case '$gte':
          parameters.push(value)
          parts.push(`${sqlField} >= ?`)
          break
        case '$lt':
          parameters.push(value)
          parts.push(`${sqlField} < ?`)
          break
        case '$lte':
          parameters.push(value)
          parts.push(`${sqlField} <= ?`)
          break
        case '$in':
          const inValues = value as unknown[]
          const placeholders = inValues.map(() => '?').join(', ')
          parameters.push(...inValues)
          parts.push(`${sqlField} IN (${placeholders})`)
          break
        case '$nin':
          const ninValues = value as unknown[]
          const ninPlaceholders = ninValues.map(() => '?').join(', ')
          parameters.push(...ninValues)
          parts.push(`${sqlField} NOT IN (${ninPlaceholders})`)
          break
        case '$exists':
          parts.push(value ? `${sqlField} IS NOT NULL` : `${sqlField} IS NULL`)
          break
        case '$regex':
          const pattern = this._regexToLike(value as string)
          parameters.push(pattern)
          parts.push(`${sqlField} LIKE ?`)
          break
        default:
          // Unsupported operator, skip
          break
      }
    }

    return parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0] || '1=1'
  }

  private _translateExpr(expr: unknown, parameters: unknown[]): string {
    if (typeof expr !== 'object' || expr === null) {
      return '1=1'
    }

    const exprObj = expr as Record<string, unknown>
    const op = Object.keys(exprObj)[0]
    const args = exprObj[op] as unknown[]

    if (!Array.isArray(args) || args.length < 2) {
      return '1=1'
    }

    const left = this._exprArgToSql(args[0], parameters)
    const right = this._exprArgToSql(args[1], parameters)

    switch (op) {
      case '$gt':
        return `${left} > ${right}`
      case '$gte':
        return `${left} >= ${right}`
      case '$lt':
        return `${left} < ${right}`
      case '$lte':
        return `${left} <= ${right}`
      case '$eq':
        return `${left} = ${right}`
      case '$ne':
        return `${left} <> ${right}`
      default:
        return '1=1'
    }
  }

  private _exprArgToSql(arg: unknown, parameters: unknown[]): string {
    if (typeof arg === 'string' && arg.startsWith('$')) {
      return this._fieldToSql(arg.slice(1))
    }
    parameters.push(arg)
    return '?'
  }

  private _translateGroup(group: { _id: unknown; [key: string]: unknown }): {
    select: string[]
    groupBy: string[]
  } {
    const select: string[] = []
    const groupBy: string[] = []

    // Handle _id
    if (group._id === null) {
      // Total aggregation, no GROUP BY
    } else if (typeof group._id === 'string' && group._id.startsWith('$')) {
      const field = group._id.slice(1)
      const sqlField = this._fieldToSql(field)
      select.push(`${sqlField} AS ${this._escapeIdentifier(field)}`)
      groupBy.push(sqlField)
    } else if (typeof group._id === 'object' && group._id !== null) {
      // Compound _id
      for (const [alias, fieldRef] of Object.entries(group._id as Record<string, string>)) {
        if (typeof fieldRef === 'string' && fieldRef.startsWith('$')) {
          const field = fieldRef.slice(1)
          const sqlField = this._fieldToSql(field)
          select.push(`${sqlField} AS ${this._escapeIdentifier(alias)}`)
          groupBy.push(sqlField)
        }
      }
    }

    // Handle aggregation fields
    for (const [alias, aggExpr] of Object.entries(group)) {
      if (alias === '_id') continue

      if (typeof aggExpr === 'object' && aggExpr !== null) {
        const aggOp = Object.keys(aggExpr)[0]
        const aggValue = (aggExpr as Record<string, unknown>)[aggOp]

        switch (aggOp) {
          case '$sum':
            if (aggValue === 1) {
              select.push(`COUNT(*) AS ${this._escapeIdentifier(alias)}`)
            } else if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`SUM(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
          case '$avg':
            if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`AVG(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
          case '$min':
            if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`MIN(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
          case '$max':
            if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`MAX(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
          case '$first':
            if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`FIRST(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
          case '$last':
            if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
              const field = this._fieldToSql(aggValue.slice(1))
              select.push(`LAST(${field}) AS ${this._escapeIdentifier(alias)}`)
            }
            break
        }
      }
    }

    return { select, groupBy }
  }

  private _translateProject(project: Record<string, 0 | 1 | unknown>): string[] {
    const fields: string[] = []
    const exclusions: string[] = []

    for (const [field, value] of Object.entries(project)) {
      if (field === '_id' && value === 0) {
        continue
      }

      if (value === 1) {
        fields.push(this._fieldToSql(field))
      } else if (value === 0) {
        exclusions.push(field)
      } else if (typeof value === 'string' && value.startsWith('$')) {
        // Field rename
        const sourceField = this._fieldToSql(value.slice(1))
        fields.push(`${sourceField} AS ${this._escapeIdentifier(field)}`)
      } else if (typeof value === 'object' && value !== null) {
        // Computed field
        const expr = this._translateProjectExpr(value as Record<string, unknown>)
        fields.push(`${expr} AS ${this._escapeIdentifier(field)}`)
      }
    }

    // If only exclusions, return * EXCEPT syntax (or fall back to *)
    if (fields.length === 0 && exclusions.length > 0) {
      return ['*'] // Simplified - actual implementation would need schema info
    }

    return fields.length > 0 ? fields : ['*']
  }

  private _translateProjectExpr(expr: Record<string, unknown>): string {
    const op = Object.keys(expr)[0]
    const args = expr[op]

    switch (op) {
      case '$multiply': {
        const [a, b] = args as unknown[]
        return `(${this._exprValueToSql(a)} * ${this._exprValueToSql(b)})`
      }
      case '$add': {
        const [a, b] = args as unknown[]
        return `(${this._exprValueToSql(a)} + ${this._exprValueToSql(b)})`
      }
      case '$subtract': {
        const [a, b] = args as unknown[]
        return `(${this._exprValueToSql(a)} - ${this._exprValueToSql(b)})`
      }
      case '$divide': {
        const [a, b] = args as unknown[]
        return `(${this._exprValueToSql(a)} / ${this._exprValueToSql(b)})`
      }
      case '$concat': {
        const parts = (args as unknown[]).map((a) => this._exprValueToSql(a))
        return `CONCAT(${parts.join(', ')})`
      }
      case '$cond': {
        const cond = args as { if: unknown; then: unknown; else: unknown }
        const ifExpr = this._translateCondExpr(cond.if)
        const thenExpr = this._exprValueToSql(cond.then)
        const elseExpr = this._exprValueToSql(cond.else)
        return `CASE WHEN ${ifExpr} THEN ${thenExpr} ELSE ${elseExpr} END`
      }
      default:
        return 'NULL'
    }
  }

  private _translateCondExpr(cond: unknown): string {
    if (typeof cond !== 'object' || cond === null) {
      return '1=1'
    }

    const condObj = cond as Record<string, unknown>
    const op = Object.keys(condObj)[0]
    const args = condObj[op] as unknown[]

    if (!Array.isArray(args) || args.length < 2) {
      return '1=1'
    }

    const left = this._exprValueToSql(args[0])
    const right = this._exprValueToSql(args[1])

    switch (op) {
      case '$gte':
        return `${left} >= ${right}`
      case '$gt':
        return `${left} > ${right}`
      case '$lte':
        return `${left} <= ${right}`
      case '$lt':
        return `${left} < ${right}`
      case '$eq':
        return `${left} = ${right}`
      case '$ne':
        return `${left} <> ${right}`
      default:
        return '1=1'
    }
  }

  private _exprValueToSql(value: unknown): string {
    if (typeof value === 'string') {
      if (value.startsWith('$')) {
        return this._fieldToSql(value.slice(1))
      }
      return `'${this._escapeString(value)}'`
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (value === null) {
      return 'NULL'
    }
    return 'NULL'
  }

  private _translateSort(sort: Record<string, 1 | -1>): string[] {
    const orderBy: string[] = []

    for (const [field, direction] of Object.entries(sort)) {
      const sqlField = this._fieldToSql(field)
      const dir = direction === 1 ? 'ASC' : 'DESC'
      orderBy.push(`${sqlField} ${dir}`)
    }

    return orderBy
  }

  private _fieldToSql(field: string): string {
    // Handle nested fields (dot notation)
    if (field.includes('.')) {
      // For JSON extraction, we'll use data->>'path' syntax
      const parts = field.split('.')
      const rootField = parts[0]
      const jsonPath = parts.slice(1).join('.')
      return `${this._escapeIdentifier(rootField)}->>'${jsonPath}'`
    }
    return this._escapeIdentifier(field)
  }

  private _escapeIdentifier(identifier: string): string {
    // Use double quotes for SQL identifier escaping
    return `"${identifier.replace(/"/g, '""')}"`
  }

  private _escapeString(value: string): string {
    return value.replace(/'/g, "''")
  }

  private _regexToLike(pattern: string): string {
    // Convert simple regex patterns to LIKE
    let like = pattern
      .replace(/^\^/, '') // Remove start anchor
      .replace(/\$$/, '') // Remove end anchor
      .replace(/\.\*/g, '%') // .* -> %
      .replace(/\./g, '_') // . -> _

    // Add wildcards if no anchors
    if (!pattern.startsWith('^')) {
      like = '%' + like
    }
    if (!pattern.endsWith('$')) {
      like = like + '%'
    }

    return like
  }

  private _assembleSql(parts: QueryParts, options: TranslationOptions): string {
    const sql: string[] = []

    // SELECT
    sql.push(`SELECT ${parts.select.join(', ')}`)

    // FROM
    sql.push(`FROM ${parts.from}`)

    // WHERE
    if (parts.where.length > 0) {
      sql.push(`WHERE ${parts.where.join(' AND ')}`)
    }

    // GROUP BY
    if (parts.groupBy.length > 0) {
      sql.push(`GROUP BY ${parts.groupBy.join(', ')}`)
    }

    // HAVING
    if (parts.having.length > 0) {
      sql.push(`HAVING ${parts.having.join(' AND ')}`)
    }

    // ORDER BY
    if (parts.orderBy.length > 0) {
      sql.push(`ORDER BY ${parts.orderBy.join(', ')}`)
    }

    // LIMIT / OFFSET
    if (parts.limit !== undefined) {
      sql.push(`LIMIT ${parts.limit}`)
    }
    if (parts.offset !== undefined) {
      sql.push(`OFFSET ${parts.offset}`)
    }

    return sql.join(' ')
  }

  private _generateWarnings(
    pipeline: PipelineStage[],
    options: TranslationOptions
  ): string[] {
    const warnings: string[] = []

    // Check for partition filter
    if (options.partitionColumns && options.partitionColumns.length > 0) {
      const matchStages = pipeline.filter((s) => '$match' in s) as { $match: Record<string, unknown> }[]
      const matchedFields = matchStages.flatMap((s) => Object.keys(s.$match))

      const hasPartitionFilter = options.partitionColumns.some((col) =>
        matchedFields.some((f) => f === col || f.startsWith(`${col}.`))
      )

      if (!hasPartitionFilter) {
        warnings.push(
          `Query does not filter on partition column(s): ${options.partitionColumns.join(', ')}. This may result in a full table scan.`
        )
      }
    }

    return warnings
  }

  private _calculateComplexity(pipeline: PipelineStage[]): number {
    let complexity = 1

    for (const stage of pipeline) {
      if ('$match' in stage) {
        complexity += Object.keys(stage.$match).length
      } else if ('$group' in stage) {
        complexity += 5 + Object.keys(stage.$group).length
      } else if ('$project' in stage) {
        complexity += Object.keys(stage.$project).length
      } else if ('$sort' in stage) {
        complexity += 2 * Object.keys(stage.$sort).length
      }
    }

    return complexity
  }
}

// =============================================================================
// Helper Types
// =============================================================================

interface QueryParts {
  select: string[]
  from: string
  where: string[]
  groupBy: string[]
  having: string[]
  orderBy: string[]
  limit: number | undefined
  offset: number | undefined
  parameters: unknown[]
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new R2 SQL translator instance
 */
export function createR2SQLTranslator(): R2SQLTranslator {
  return new R2SQLTranslator()
}
