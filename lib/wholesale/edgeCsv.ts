// CSV writer for Edge wholesale-export batches.
//
// Renders one row per `edge_batch_items.snapshot` plus a header row.
// The Edge has no published import spec — these columns are a best
// guess based on common jewelry POS bulk-import shapes; iterate after
// Mary's first reject.
//
// Important: the COLUMN ORDER and HEADER NAMES are the public contract
// with Mary's importer. Don't reorder casually.

import type { EdgeBatchItemSnapshot } from '@/types/wholesale'

interface RowInput {
  position: number
  batch_code: string
  snapshot: EdgeBatchItemSnapshot
  /** Per-photo filenames *as they appear in the media folder Mary will
   *  see* — already renamed to {batch_code}_{sku}_{n}.{ext}. */
  photo_filenames: string[]
}

const HEADERS = [
  'batch_code',
  'position',
  'sku',
  'category',
  'description',
  'vendor',
  'vendor_stock_number',
  'cost',
  'edge_price',
  'retail_price',
  'metal_type',
  'metal_color',
  'metal_karat',
  'metal_weight_dwt',
  'primary_stone',
  'primary_stone_ct',
  'stones_summary',
  'gender',
  'size',
  'length',
  'designer',
  'period',
  'hallmarks',
  'date_acquired',
  'public_notes',
  'photo_filenames',
  'photo_count',
] as const

export function buildCsv(rows: RowInput[]): string {
  const lines: string[] = []
  lines.push(HEADERS.join(','))
  for (const r of rows) {
    const s = r.snapshot
    const fields: (string | number | null)[] = [
      r.batch_code,
      r.position,
      s.item_number,
      s.category,
      s.description,
      s.vendor_name,
      s.vendor_stock_number,
      centsToDollars(s.cost_cents),
      centsToDollars(s.edge_price_cents),
      centsToDollars(s.retail_price_cents),
      s.metal_type,
      s.metal_color,
      s.metal_karat,
      s.metal_dwt,
      s.primary_stone,
      s.primary_stone_ct,
      s.stones_summary,
      s.gender,
      s.size,
      s.length,
      s.designer,
      s.period,
      s.hallmarks,
      s.date_acquired,
      s.public_notes,
      r.photo_filenames.join('; '),
      r.photo_filenames.length,
    ]
    lines.push(fields.map(csvField).join(','))
  }
  // Excel and most POS importers are happiest with CRLF.
  return lines.join('\r\n') + '\r\n'
}

function centsToDollars(cents: number | null | undefined): string | null {
  if (cents == null) return null
  return (cents / 100).toFixed(2)
}

function csvField(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  // RFC-4180 quoting: any field containing comma, quote, CR, or LF
  // gets wrapped in quotes and inner quotes doubled.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
