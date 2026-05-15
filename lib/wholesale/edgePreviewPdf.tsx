// Edge Send — preview PDF.
//
// Rendered on demand when the user clicks 📄 Preview PDF in the
// Send-to-Edge compose footer. Shows exactly what Mary will receive
// (sans the 84-column CSV, which doesn't print legibly): one row per
// selected item with the primary photo, item #, condensed
// description, metal, stones, and Edge price. Totals strip at the
// bottom.
//
// NOT a send: no edge_batches row, no email, no photo copy — pure
// document generation from the live inventory. Operators get a paper
// review pass before pulling the trigger on a real batch.

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { EdgeBatchItemSnapshot } from '@/types/wholesale'

export interface EdgePreviewPdfLine {
  position: number
  snapshot: EdgeBatchItemSnapshot
  /** Primary photo as a base64 data URL, or null when the item has no
   *  photos. The PDF renderer can't fetch remote URLs reliably — we
   *  inline everything. */
  photo_data_url: string | null
}

export interface EdgePreviewPdfData {
  brand: string
  brandFullName: string
  brandLogoDataUrl?: string | null
  generatedAt: string  // ISO
  generatedByName?: string | null
  generatedByEmail?: string | null
  lines: EdgePreviewPdfLine[]
}

const styles = StyleSheet.create({
  page:        { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a16' },
  hdrRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  brandBlock:  { flexDirection: 'column' },
  brandName:   { fontSize: 14, fontWeight: 700 },
  brandLine:   { fontSize: 8, color: '#444' },
  metaBlock:   { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle:    { fontSize: 20, fontWeight: 700, color: '#10261c', marginBottom: 2 },
  metaLine:    { fontSize: 9 },
  draftBadge:  {
    fontSize: 9, fontWeight: 700,
    backgroundColor: '#FEF3C7', color: '#78350F',
    padding: '3px 8px', borderRadius: 4, marginTop: 4,
    alignSelf: 'flex-end',
  },

  summaryStrip: {
    flexDirection: 'row',
    backgroundColor: '#F5F0E8',
    padding: '10px 12px',
    borderRadius: 4,
    marginBottom: 14,
  },
  summaryCell: { flex: 1 },
  summaryLbl:  { fontSize: 7, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  summaryVal:  { fontSize: 12, fontWeight: 700 },

  table:       { borderWidth: 1, borderColor: '#cbcbc6', borderRadius: 2 },
  trh:         { flexDirection: 'row', backgroundColor: '#eaeaea', borderBottomWidth: 1, borderBottomColor: '#000' },
  th:          { padding: 5, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 },
  tr:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#dcdcd6' },
  trAlt:       { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#dcdcd6', backgroundColor: '#FAFAF6' },
  td:          { padding: 5, fontSize: 9 },

  // Column widths — must sum to ~536pt (letter width 612 − 2*32 padding − borders).
  cIdx:        { width: 22, textAlign: 'right' },
  cPhoto:      { width: 50 },
  cItem:       { width: 78 },
  cDesc:       { flex: 1 },
  cMetal:      { width: 88 },
  cStones:     { width: 88 },
  cPrice:      { width: 60, textAlign: 'right' },

  photoImg:    { width: 40, height: 40, objectFit: 'cover', borderRadius: 2 },

  totalsRow:   {
    flexDirection: 'row', justifyContent: 'flex-end',
    borderTopWidth: 1, borderTopColor: '#000',
    backgroundColor: '#F5F0E8',
    padding: 6,
  },

  footerNote:  { marginTop: 12, fontSize: 7, color: '#888', lineHeight: 1.4 },
})

const fmtMoneyCents = (c: number | null) => c == null
  ? '—'
  : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function condensedStones(s: EdgeBatchItemSnapshot): string {
  // Loose diamond: "1.05ct Round D VS1"
  if (s.category === 'diamond') {
    const bits: string[] = []
    if (s.diamond_carat != null) bits.push(`${s.diamond_carat.toFixed(2)}ct`)
    if (s.diamond_shape) bits.push(s.diamond_shape)
    if (s.diamond_color) bits.push(s.diamond_color)
    if (s.diamond_clarity) bits.push(s.diamond_clarity)
    return bits.join(' ')
  }
  // Otherwise prefer stones_summary; fall back to primary stone fields.
  if (s.stones_summary) return s.stones_summary
  const parts: string[] = []
  if (s.primary_stone_count && s.primary_stone_count > 1) parts.push(`${s.primary_stone_count}×`)
  if (s.primary_stone) parts.push(s.primary_stone)
  if (s.primary_stone_shape) parts.push(s.primary_stone_shape)
  if (s.primary_stone_ct != null) parts.push(`${s.primary_stone_ct.toFixed(2)}ct`)
  return parts.join(' ').trim()
}

function metalLabel(s: EdgeBatchItemSnapshot): string {
  // Prefer the composed Edge label (e.g. "14kt Yellow Gold").
  if (s.metal_type_label) return s.metal_type_label
  const bits: string[] = []
  if (s.metal_karat) bits.push(s.metal_karat)
  if (s.metal_color) bits.push(s.metal_color)
  if (s.metal_type)  bits.push(s.metal_type)
  return bits.join(' ').trim()
}

export function EdgePreviewPdfDoc({ data }: { data: EdgePreviewPdfData }) {
  const total = data.lines.reduce((s, l) => s + (l.snapshot.edge_price_cents || 0), 0)
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.hdrRow} fixed>
          <View style={styles.brandBlock}>
            {data.brandLogoDataUrl ? (
              <Image src={data.brandLogoDataUrl} style={{ width: 140, height: 48, objectFit: 'contain', objectPosition: 'left center', marginBottom: 4 }} />
            ) : null}
            <Text style={styles.brandName}>{data.brandFullName}</Text>
            <Text style={styles.brandLine}>Edge Send · Preview</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>EDGE PREVIEW</Text>
            <Text style={styles.metaLine}>Generated {fmtDateTime(data.generatedAt)}</Text>
            {data.generatedByName ? (
              <Text style={styles.metaLine}>By {data.generatedByName}</Text>
            ) : data.generatedByEmail ? (
              <Text style={styles.metaLine}>By {data.generatedByEmail}</Text>
            ) : null}
            <Text style={styles.draftBadge}>DRAFT · NOT YET SENT</Text>
          </View>
        </View>

        {/* Summary strip */}
        <View style={styles.summaryStrip}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLbl}>Items</Text>
            <Text style={styles.summaryVal}>{data.lines.length}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLbl}>Edge Total</Text>
            <Text style={styles.summaryVal}>{fmtMoneyCents(total)}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLbl}>With Photos</Text>
            <Text style={styles.summaryVal}>{data.lines.filter(l => l.photo_data_url).length}/{data.lines.length}</Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.trh} fixed>
            <Text style={[styles.th, styles.cIdx]}>#</Text>
            <Text style={[styles.th, styles.cPhoto]}> </Text>
            <Text style={[styles.th, styles.cItem]}>Item #</Text>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cMetal]}>Metal</Text>
            <Text style={[styles.th, styles.cStones]}>Stones</Text>
            <Text style={[styles.th, styles.cPrice]}>Edge $</Text>
          </View>
          {data.lines.map((l, i) => {
            const rowStyle = i % 2 === 0 ? styles.tr : styles.trAlt
            const snap = l.snapshot
            return (
              <View key={l.position} style={rowStyle} wrap={false}>
                <Text style={[styles.td, styles.cIdx]}>{l.position}</Text>
                <View style={[styles.td, styles.cPhoto]}>
                  {l.photo_data_url
                    ? <Image src={l.photo_data_url} style={styles.photoImg} />
                    : <Text style={{ fontSize: 7, color: '#bbb' }}>(no photo)</Text>}
                </View>
                <Text style={[styles.td, styles.cItem]}>{snap.item_number}</Text>
                <Text style={[styles.td, styles.cDesc]}>
                  {snap.description || '—'}
                  {snap.designer ? `\n${snap.designer}` : ''}
                </Text>
                <Text style={[styles.td, styles.cMetal]}>{metalLabel(snap) || '—'}</Text>
                <Text style={[styles.td, styles.cStones]}>{condensedStones(snap) || '—'}</Text>
                <Text style={[styles.td, styles.cPrice]}>{fmtMoneyCents(snap.edge_price_cents)}</Text>
              </View>
            )
          })}
          <View style={styles.totalsRow}>
            <Text style={{ fontSize: 10, fontWeight: 700 }}>
              Edge total: {fmtMoneyCents(total)}
            </Text>
          </View>
        </View>

        <Text style={styles.footerNote} fixed>
          Preview only — no batch record has been created and no email has been sent.
          The Edge Marketplace receives a CSV plus per-item photos via the 🚀 Send action.
        </Text>
        <Text
          style={{ position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: '#888' }}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  )
}
