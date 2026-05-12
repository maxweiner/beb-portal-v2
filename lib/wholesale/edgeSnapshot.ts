// Builds the immutable per-item snapshot stored in edge_batch_items.
//
// Why a snapshot: the CSV we send to The Edge must stay reproducible
// even if the underlying inventory_items row is later edited, sold, or
// deleted. Snapshotting freezes the values at send time so a "view past
// batch" or "resend identical CSV" action gives byte-identical output.
//
// Shape mirrors `EdgeBatchItemSnapshot` in types/wholesale.ts and the
// column order in lib/wholesale/edgeCsv.ts. Keep all three in sync.

import type {
  InventoryItem, InventoryItemStone, WholesaleVendor, EdgeBatchItemSnapshot,
} from '@/types/wholesale'

export interface SnapshotInput {
  item: InventoryItem
  vendor: WholesaleVendor | null
  stones: InventoryItemStone[]
}

export function buildSnapshot({ item, vendor, stones }: SnapshotInput): EdgeBatchItemSnapshot {
  const sorted = [...stones].sort((a, b) => {
    // Diamonds always first (matches the auto-description convention used
    // elsewhere in the wholesale module), then by sort_order.
    const aD = (a.stone_type || '').toLowerCase() === 'diamond' ? 0 : 1
    const bD = (b.stone_type || '').toLowerCase() === 'diamond' ? 0 : 1
    if (aD !== bD) return aD - bD
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })

  const primary = sorted[0] ?? null
  const stones_summary = sorted.length
    ? sorted.map(s => formatStone(s)).filter(Boolean).join('; ')
    : null

  return {
    item_number: item.item_number,
    category: item.category,
    description: buildDescription({ item, primary, vendor }),
    vendor_name: vendor?.company_name ?? null,
    vendor_stock_number: item.vendor_stock_number ?? null,
    cost_cents: item.cost_cents ?? null,
    edge_price_cents: item.edge_price_cents ?? null,
    retail_price_cents: item.retail_price_cents ?? null,
    metal_type: item.jewelry_metal_type ?? null,
    metal_color: item.jewelry_metal_color ?? null,
    metal_karat: item.jewelry_metal_karat ?? null,
    metal_dwt: item.jewelry_metal_dwt ?? null,
    stones_summary,
    primary_stone: primary?.stone_type ?? null,
    primary_stone_ct: primary?.total_ct ?? null,
    gender: item.gender ?? null,
    size: item.jewelry_size ?? null,
    length: item.jewelry_length ?? null,
    designer: item.jewelry_designer ?? null,
    period: item.jewelry_period ?? null,
    hallmarks: item.jewelry_hallmarks ?? null,
    date_acquired: item.date_acquired ?? null,
    public_notes: item.public_notes ?? null,
  }
}

function formatStone(s: InventoryItemStone): string {
  const parts: string[] = []
  if (s.count && s.count > 1) parts.push(`${s.count}×`)
  if (s.stone_type) parts.push(s.stone_type)
  if (s.shape) parts.push(s.shape)
  if (s.total_ct != null) parts.push(`${s.total_ct.toFixed(2)}ct`)
  return parts.join(' ').trim()
}

function buildDescription({
  item, primary, vendor,
}: {
  item: InventoryItem
  primary: InventoryItemStone | null
  vendor: WholesaleVendor | null
}): string | null {
  // If the user wrote public_notes, prefer that — it's the curated
  // description they want on a wholesale list.
  if (item.public_notes?.trim()) return item.public_notes.trim()

  // Otherwise auto-compose from structured fields. Pattern:
  //   "14kt Yellow Gold Ladies Ring with 0.50 ct Diamond"
  const bits: string[] = []
  if (item.jewelry_metal_karat) bits.push(item.jewelry_metal_karat)
  if (item.jewelry_metal_color) bits.push(item.jewelry_metal_color)
  if (item.jewelry_metal_type) bits.push(item.jewelry_metal_type)
  if (item.gender) bits.push(item.gender === 'Female' ? 'Ladies' : item.gender === 'Male' ? 'Mens' : 'Unisex')
  if (item.jewelry_type) bits.push(item.jewelry_type)
  if (item.category === 'watch' && item.jewelry_type == null) bits.push('Watch')
  if (item.category === 'diamond' && item.jewelry_type == null) bits.push('Diamond')

  let s = bits.join(' ').trim()
  if (primary && primary.stone_type) {
    const ct = primary.total_ct != null ? `${primary.total_ct.toFixed(2)} ct ` : ''
    const count = primary.count && primary.count > 1 ? `${primary.count}× ` : ''
    const shape = primary.shape ? `${primary.shape} ` : ''
    s = `${s} with ${count}${ct}${shape}${primary.stone_type}`.trim()
  }
  if (item.jewelry_designer) s = `${s} by ${item.jewelry_designer}`
  if (vendor?.company_name && !s) s = vendor.company_name
  return s || null
}
