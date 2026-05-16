// CSV writer for Edge wholesale-export batches.
//
// Column order + names match The Edge Marketplace's official import
// spec (84 columns) — see /Users/maxweiner/Desktop/reedgemarketplace/
// ColumnNamesCSV.csv for the source. Maps our `EdgeBatchItemSnapshot`
// fields onto Edge's columns; fields we don't track are emitted blank.
//
// Important: the COLUMN ORDER and HEADER NAMES are the public contract
// with Mary's importer. Don't reorder casually — Edge expects them in
// this exact sequence.

import type { EdgeBatchItemSnapshot } from '@/types/wholesale'

interface RowInput {
  position: number
  batch_code: string
  snapshot: EdgeBatchItemSnapshot
  /** Per-photo filenames as they appear in the media folder Mary
   *  receives — already renamed to {batch_code}_{sku}_{n}.{ext}. */
  photo_filenames: string[]
}

// The 84 official Edge columns, IN ORDER.
const HEADERS = [
  'Cost', 'Description', 'Vendor Style Code', 'Vendor Syb Style Code',
  'Vendor Item Key', 'Edge Category', 'Vendor Category', 'Lead Time',
  'Memo Item', 'Notes', 'Retail Price', 'Vendor Barcode', 'Master Item',
  'Variation Name', 'Item Style', 'Length', 'Manufacture',
  'Millimeter Width', 'Metal Color', 'Metal Finish', 'Metal Type',
  'Metal Weight', 'Serial Number', 'Size', 'Watch Bracelet or Strap',
  'Watch Clasp', 'Item Style 2', 'Length 2', 'Metal Color 2',
  'Metal Finish 2', 'Metal Type 2', 'Metal Weight 2', 'Size 2',
  'Image 1', 'Image 2', 'Image 3', 'Image 4', 'Image 5',
  'Stone Type', 'Shape', 'Stone Weight', 'Total Weight', 'Sizing Parse',
  'CertId', 'Clarity', 'Count', 'Crown Mm', 'Crown Pct', 'Culet', 'Cut',
  'Depth', 'Depth Pct', 'Diamond Color Grade', 'Dir', 'Enhancement',
  'Finish', 'Floor Mm', 'Floor Pct', 'Fluorecence', 'Girdle Min',
  'Girdle Max', 'Hue', 'Identification', 'Inscription', 'Lab',
  'Stone Length', 'Luster', 'Make', 'Major Symmetry', 'Matching',
  'Minor Symmetry', 'Nacre', 'Pattern', 'Pavillion Mm', 'Pavillion Pct',
  'Polish', 'Saturation', 'Surface', 'Table Mm', 'Table Pct',
  'Texture', 'Tone', 'Uniformity', 'Variation', 'Width Max', 'Width Min',
] as const

// Edge expects specific category strings. Map our internal category.
const EDGE_CATEGORY: Record<string, string> = {
  jewelry: 'Jewelry',
  watch: 'Watch',
  diamond: 'Diamond',
}

export function buildCsv(rows: RowInput[]): string {
  const lines: string[] = []
  lines.push(HEADERS.join(','))
  for (const r of rows) {
    lines.push(buildRow(r).join(','))
  }
  // Excel + most POS importers prefer CRLF.
  return lines.join('\r\n') + '\r\n'
}

function buildRow(r: RowInput): string[] {
  const s = r.snapshot
  const photo = (i: number) => csvField(r.photo_filenames[i] || null)
  const isJewelry = s.category === 'jewelry'
  const isWatch   = s.category === 'watch'
  const isDiamond = s.category === 'diamond'

  // The CSV writer is mostly a flat dictionary lookup; we just have
  // to remember which fields belong to which category (e.g. Stone
  // Weight is the primary-stone weight for jewelry/watch but the
  // diamond_carat for loose diamonds).

  return [
    csvField(centsToDollars(s.edge_price_cents)),                  // Cost
    csvField(s.description),                                       // Description
    // ── Vendor info intentionally NOT exported (spec 2026-05-15) ──
    // Edge's importer treats blank Vendor Style Code / Item Key /
    // Category as "no vendor metadata" — fine for our use case
    // (Mary doesn't resell by our vendor; the line just gets
    // associated to The Edge's own vendor record on import).
    csvField(null),                                                // Vendor Style Code (was s.vendor_stock_number; scrubbed)
    csvField(null),                                                // Vendor Syb Style Code (n/a)
    csvField(null),                                                // Vendor Item Key (was s.item_number; scrubbed — Master Item below still carries it for import identity)
    csvField(s.category ? EDGE_CATEGORY[s.category] : null),       // Edge Category (kept — Edge's own taxonomy)
    csvField(null),                                                // Vendor Category (was s.category; scrubbed)
    csvField(null),                                                // Lead Time (n/a)
    csvField(s.memo_in ? 'Yes' : 'No'),                            // Memo Item
    csvField(buildNotes(s)),                                       // Notes
    // Retail Price intentionally NOT exported (spec 2026-05-15) —
    // Mary sets her own retail downstream.
    csvField(null),                                                // Retail Price (was s.retail_price_cents; scrubbed)
    csvField(null),                                                // Vendor Barcode (n/a)
    csvField(s.item_number),                                       // Master Item (kept — Edge's import identity)
    csvField(s.gender ? humanGender(s.gender) : null),             // Variation Name
    csvField(s.item_style),                                        // Item Style
    csvField(s.length),                                            // Length
    // Manufacture drops the vendor_name fallback per the vendor-info
    // scrub. Falls back to blank if no designer / watch brand.
    csvField(s.designer || s.watch_brand),                         // Manufacture
    csvField(null),                                                // Millimeter Width (n/a)
    csvField(s.metal_color),                                       // Metal Color
    csvField(null),                                                // Metal Finish (n/a)
    csvField(s.metal_type_label || s.metal_type),                  // Metal Type
    csvField(s.metal_dwt),                                         // Metal Weight (dwt)
    csvField(s.watch_serial),                                      // Serial Number
    csvField(s.size),                                              // Size
    csvField(s.watch_band),                                        // Watch Bracelet or Strap
    csvField(null),                                                // Watch Clasp (n/a)

    // Two-tone secondary metal — we don't track separately. Blank.
    csvField(null), csvField(null), csvField(null), csvField(null),
    csvField(null), csvField(null), csvField(null),

    photo(0), photo(1), photo(2), photo(3), photo(4),              // Image 1–5

    // Stone Type / Shape / Stone Weight / Total Weight — primary
    // stone for jewelry+watch; the loose diamond fields take over
    // for category=diamond rows.
    csvField(isDiamond ? 'Diamond' : s.primary_stone),              // Stone Type
    csvField(isDiamond ? s.diamond_shape : s.primary_stone_shape),  // Shape
    csvField(isDiamond ? s.diamond_carat : s.primary_stone_ct),     // Stone Weight
    csvField(s.total_stone_ct ?? s.primary_stone_ct ?? s.diamond_carat), // Total Weight
    csvField(null),                                                // Sizing Parse (n/a)

    // Diamond block. For loose diamonds these have data; for
    // jewelry/watch they're blank unless the primary stone is a
    // graded diamond.
    csvField(s.diamond_cert_id),                                   // CertId
    csvField(s.diamond_clarity),                                   // Clarity
    csvField(isDiamond ? null : s.primary_stone_count),            // Count
    csvField(null),                                                // Crown Mm (n/a)
    csvField(null),                                                // Crown Pct (n/a)
    csvField(null),                                                // Culet (n/a)
    csvField(s.diamond_cut),                                       // Cut
    csvField(null),                                                // Depth (n/a — mm)
    csvField(s.diamond_depth_pct),                                 // Depth Pct
    csvField(s.diamond_color),                                     // Diamond Color Grade
    csvField(null),                                                // Dir (n/a)
    csvField(null),                                                // Enhancement (n/a)
    csvField(null),                                                // Finish (n/a)
    csvField(null),                                                // Floor Mm (n/a)
    csvField(null),                                                // Floor Pct (n/a)
    csvField(s.diamond_fluorescence),                              // Fluorecence (sic — Edge typo)
    csvField(null),                                                // Girdle Min (n/a)
    csvField(null),                                                // Girdle Max (n/a)
    csvField(null),                                                // Hue (n/a)
    csvField(null),                                                // Identification (n/a)
    csvField(null),                                                // Inscription (n/a)
    csvField(s.diamond_lab),                                       // Lab
    csvField(null),                                                // Stone Length (n/a)
    csvField(null),                                                // Luster (n/a)
    csvField(null),                                                // Make (n/a)
    csvField(s.diamond_symmetry),                                  // Major Symmetry
    csvField(null),                                                // Matching (n/a)
    csvField(null),                                                // Minor Symmetry (n/a)
    csvField(null),                                                // Nacre (n/a)
    csvField(null),                                                // Pattern (n/a)
    csvField(null),                                                // Pavillion Mm (n/a)
    csvField(null),                                                // Pavillion Pct (n/a)
    csvField(s.diamond_polish),                                    // Polish
    csvField(null),                                                // Saturation (n/a)
    csvField(null),                                                // Surface (n/a)
    csvField(null),                                                // Table Mm (n/a)
    csvField(s.diamond_table_pct),                                 // Table Pct
    csvField(null),                                                // Texture (n/a)
    csvField(null),                                                // Tone (n/a)
    csvField(null),                                                // Uniformity (n/a)
    csvField(null),                                                // Variation (n/a)
    csvField(null),                                                // Width Max (n/a — pull from measurements? skip for now)
    csvField(null),                                                // Width Min (n/a)
  ]
}

function buildNotes(s: EdgeBatchItemSnapshot): string | null {
  // Stack any "extras" we have into the Notes field — Edge's spec
  // only gives us free text for these, so consolidate hallmarks,
  // period, and the stones-summary when there's >1 stone.
  const bits: string[] = []
  if (s.public_notes) bits.push(s.public_notes)
  if (s.hallmarks) bits.push(`Hallmarks: ${s.hallmarks}`)
  if (s.period) bits.push(`Period: ${s.period}`)
  if (s.stones_summary && s.primary_stone && s.stones_summary !== formatPrimaryOnly(s)) {
    // Only add stones_summary if there's more than just the primary
    // stone (avoid duplicating Stone Type / Stone Weight).
    bits.push(`Stones: ${s.stones_summary}`)
  }
  return bits.length ? bits.join(' · ') : null
}

function formatPrimaryOnly(s: EdgeBatchItemSnapshot): string {
  // Recreate the single-stone summary form to compare against the
  // full stones_summary — if they match, no extra stones beyond
  // the primary, so we don't repeat in Notes.
  const parts: string[] = []
  if (s.primary_stone_count && s.primary_stone_count > 1) parts.push(`${s.primary_stone_count}×`)
  if (s.primary_stone) parts.push(s.primary_stone)
  if (s.primary_stone_shape) parts.push(s.primary_stone_shape)
  if (s.primary_stone_ct != null) parts.push(`${s.primary_stone_ct.toFixed(2)}ct`)
  return parts.join(' ').trim()
}

function humanGender(g: 'Female' | 'Male' | 'Unisex'): string {
  return g === 'Female' ? 'Ladies' : g === 'Male' ? 'Mens' : 'Unisex'
}

function centsToDollars(cents: number | null | undefined): string | null {
  if (cents == null) return null
  return (cents / 100).toFixed(2)
}

function csvField(v: string | number | null | undefined): string {
  if (v == null || v === '') return ''
  const s = String(v)
  // RFC-4180 quoting: fields with comma / quote / CR / LF get wrapped
  // in double quotes; inner quotes doubled.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
