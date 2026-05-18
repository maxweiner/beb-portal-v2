// Builds the immutable per-item snapshot stored in edge_batch_items.
//
// Why a snapshot: the CSV we send to The Edge must stay reproducible
// even if the underlying inventory_items row is later edited, sold,
// or deleted. Snapshotting freezes the values at send time so a
// "view past batch" or "resend identical CSV" action gives byte-
// identical output.
//
// Shape mirrors `EdgeBatchItemSnapshot` in types/wholesale.ts. The
// CSV writer in `edgeCsv.ts` maps these fields to The Edge's 84
// official import columns.

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
    // Diamonds always first — matches the auto-description convention
    // used elsewhere in the wholesale module.
    const aD = (a.stone_type || '').toLowerCase() === 'diamond' ? 0 : 1
    const bD = (b.stone_type || '').toLowerCase() === 'diamond' ? 0 : 1
    if (aD !== bD) return aD - bD
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })

  const primary = sorted[0] ?? null
  const stonesSummary = sorted.length
    ? sorted.map(s => formatStone(s)).filter(Boolean).join('; ')
    : null
  const totalStoneCt = sorted.reduce((acc, s) => acc + (Number(s.total_ct) || 0), 0)

  return {
    item_number: item.item_number,
    category: item.category,
    description: buildDescription({ item, primary, vendor }),
    // Vendor is scrubbed from Edge sends entirely — CSV (edgeCsv.ts),
    // public batch page, and now the snapshot itself. Kept as a nullable
    // field on the type for legacy snapshots; new sends store null.
    vendor_name: null,
    vendor_stock_number: item.vendor_stock_number ?? null,
    cost_cents: item.cost_cents ?? null,
    edge_price_cents: item.edge_price_cents ?? null,
    retail_price_cents: item.retail_price_cents ?? null,
    memo_in: item.memo_in ?? false,

    item_style: item.jewelry_type ?? null,
    metal_type: item.jewelry_metal_type ?? null,
    metal_color: item.jewelry_metal_color ?? null,
    metal_karat: item.jewelry_metal_karat ?? null,
    metal_type_label: buildMetalLabel(item),
    metal_dwt: item.jewelry_metal_dwt ?? null,
    size: item.jewelry_size ?? null,
    length: item.jewelry_length ?? null,
    designer: item.jewelry_designer ?? null,
    period: item.jewelry_period ?? null,
    hallmarks: item.jewelry_hallmarks ?? null,

    stones_summary: stonesSummary,
    primary_stone: primary?.stone_type ?? null,
    primary_stone_ct: primary?.total_ct ?? null,
    primary_stone_shape: primary?.shape ?? null,
    primary_stone_count: primary?.count ?? null,
    total_stone_ct: totalStoneCt > 0 ? Number(totalStoneCt.toFixed(2)) : null,

    diamond_lab: item.diamond_lab_type ?? null,
    diamond_cert_id: item.diamond_report_number ?? null,
    diamond_carat: item.diamond_carat ?? null,
    diamond_shape: item.diamond_shape ?? null,
    diamond_color: item.diamond_color ?? null,
    diamond_clarity: item.diamond_clarity ?? null,
    diamond_cut: item.diamond_cut ?? null,
    diamond_polish: item.diamond_polish ?? null,
    diamond_symmetry: item.diamond_symmetry ?? null,
    diamond_fluorescence: item.diamond_fluorescence ?? null,
    diamond_depth_pct: item.diamond_depth_pct ?? null,
    diamond_table_pct: item.diamond_table_pct ?? null,
    diamond_measurements: item.diamond_measurements ?? null,

    watch_brand: item.watch_brand ?? null,
    watch_model: item.watch_model ?? null,
    watch_serial: item.watch_serial_number ?? null,
    watch_band: item.watch_band_style ?? null,
    watch_case_material: item.watch_case_material ?? null,

    gender: item.gender ?? null,
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

/** Compose Edge's `Metal Type` field — they expect a single string
 *  like "14kt Yellow Gold" rather than three separate columns. */
function buildMetalLabel(item: InventoryItem): string | null {
  const parts = [item.jewelry_metal_karat, item.jewelry_metal_color, item.jewelry_metal_type]
    .map(p => (p || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

function buildDescription({
  item, primary, vendor,
}: {
  item: InventoryItem
  primary: InventoryItemStone | null
  vendor: WholesaleVendor | null
}): string | null {
  // If the user wrote public_notes, prefer that — curated description
  // for the wholesale listing.
  if (item.public_notes?.trim()) return item.public_notes.trim()

  // Otherwise auto-compose from structured fields.
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
  // Vendor company_name is intentionally NOT used as a fallback — Edge
  // sends are vendor-free. If the auto-compose is empty the caller
  // falls back to item_number in the public renderer.
  return s || null
}
