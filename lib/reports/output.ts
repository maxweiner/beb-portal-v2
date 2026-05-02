// Shared helpers for turning a saved report + run result into output
// columns and rendered formats. Used by both the client runner (table +
// CSV download) and the server email route.

import {
  allColumns, aggregateKey, aggregateLabel, type ReportConfig,
} from './schema'
import { displayKey, getValue } from './runQuery'

export interface OutputColumn {
  key: string
  label: string
  /** Underlying column type, when known. Used to format dates / numbers. */
  type?: string
}

/** Output columns derived from a report's source + config. In grouping
 *  mode this is `[...groupBy, ...aggregateKeys]` with friendly labels;
 *  otherwise it's the configured `columns` list. */
export function deriveOutputColumns(source: string, config: ReportConfig): OutputColumn[] {
  const catalog = allColumns(source)
  const byKey = new Map(catalog.map(c => [c.column.key, c.column]))
  const isGrouped = (config.groupBy?.length ?? 0) > 0

  if (!isGrouped) {
    return config.columns.map(k => {
      const cd = byKey.get(k)
      return { key: k, label: cd?.label || displayKey(k), type: cd?.type }
    })
  }

  const out: OutputColumn[] = []
  for (const gk of config.groupBy ?? []) {
    const cd = byKey.get(gk)
    out.push({ key: gk, label: cd?.label || displayKey(gk), type: cd?.type })
  }
  ;(config.aggregates ?? []).forEach((a, i) => {
    const fl = a.field ? byKey.get(a.field)?.label : undefined
    out.push({ key: aggregateKey(i), label: aggregateLabel(a, fl), type: 'number' })
  })
  return out
}

/** CSV-friendly cell formatter. Prefers raw ISO for dates so spreadsheets
 *  parse them correctly rather than US-locale strings. */
function fmtCellForCsv(v: any, _type?: string): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Build a CSV string from the report's run result. Header row uses the
 *  derived OutputColumn labels; cells use either nested-key lookup
 *  (ungrouped) or own-property access (grouped output rows). */
export function buildCsv(source: string, config: ReportConfig, rows: any[]): string {
  const cols = deriveOutputColumns(source, config)
  const isGrouped = (config.groupBy?.length ?? 0) > 0
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = [cols.map(c => escape(c.label)).join(',')]
  for (const row of rows) {
    lines.push(cols.map(c => {
      const v = isGrouped ? row[c.key] : getValue(row, c.key)
      return escape(fmtCellForCsv(v, c.type))
    }).join(','))
  }
  return lines.join('\n')
}
