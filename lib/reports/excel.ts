// Server-only XLSX builder for custom reports. Lives outside output.ts
// so the ~1MB exceljs dependency only ships into serverless function
// bundles, not the browser. Both the email route and the export route
// import this.

import ExcelJS from 'exceljs'
import { deriveOutputColumns } from './output'
import { getValue } from './runQuery'
import type { ReportConfig } from './schema'

/** Render the report's output rows as an XLSX workbook and return the
 *  raw bytes. Header row is bold; numeric/date columns get matching
 *  cell types so Excel sums + sorts them correctly. */
export async function buildXlsx(
  source: string, config: ReportConfig, rows: any[],
  reportName?: string,
): Promise<Buffer> {
  const cols = deriveOutputColumns(source, config)
  const isGrouped = (config.groupBy?.length ?? 0) > 0

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BEB Portal'
  wb.created = new Date()

  // Sheet name: max 31 chars, no special chars per Excel.
  const sheetName = (reportName || 'Report').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31) || 'Report'
  const sheet = wb.addWorksheet(sheetName)

  // Header row.
  sheet.columns = cols.map(c => ({
    header: c.label,
    key: c.key,
    // exceljs auto-sizes if width omitted; set a reasonable default.
    width: Math.min(40, Math.max(12, c.label.length + 4)),
  }))
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).alignment = { vertical: 'middle' }

  // Data rows.
  for (const row of rows) {
    const out: Record<string, any> = {}
    for (const c of cols) {
      const v = isGrouped ? row[c.key] : getValue(row, c.key)
      out[c.key] = coerceForCell(v, c.type)
    }
    const r = sheet.addRow(out)
    // Apply per-column number/date formats once per row (cheap).
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1)
      if (c.type === 'number' && typeof cell.value === 'number') {
        cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.##'
      } else if (c.type === 'date' && cell.value instanceof Date) {
        cell.numFmt = 'yyyy-mm-dd'
      } else if (c.type === 'datetime' && cell.value instanceof Date) {
        cell.numFmt = 'yyyy-mm-dd hh:mm'
      }
    })
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const arrBuf = await wb.xlsx.writeBuffer()
  return Buffer.from(arrBuf as ArrayBuffer)
}

/** Map raw report values to native cell-friendly forms. Strings stay
 *  strings; numerics that arrive as strings get coerced; date-typed
 *  ISO strings become Date objects so cell formatting kicks in. */
function coerceForCell(v: any, type?: string): any {
  if (v == null) return null
  if (type === 'number') {
    if (typeof v === 'number') return v
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  if (type === 'date' || type === 'datetime') {
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
  }
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}
