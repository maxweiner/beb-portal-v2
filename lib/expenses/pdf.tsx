// React-PDF document for an expense report. Three sections:
//   1. Cover page — header, buyer/event metadata, totals by category,
//      grand total, optional e-signature footer.
//   2. Itemized expenses — grouped by category, sorted by date.
//   3. Receipt appendix (only if any expenses have a receipt_url) —
//      grid of receipt thumbnails captioned with vendor/date/amount.
//
// Uses Helvetica (built into the renderer) — no external font loading
// to keep the Vercel cold start fast.

import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'
import type { Expense, ExpenseCategory, ExpenseReport } from '@/types'
import { fmtMoney } from '@/lib/format'

const COLORS = {
  ink:       '#1F2937',
  ash:       '#4B5563',
  mist:      '#9CA3AF',
  pearl:     '#E5E7EB',
  cream:     '#FAF7F0',
  cream2:    '#F3EFE6',
  green:     '#1D6B44',
  greenDark: '#11432B',
}

const styles = StyleSheet.create({
  page:       { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: COLORS.ink },
  hRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  // Logo box. Wide enough for a 2.16:1 wordmark AND tall enough for a
  // square emblem (Liberty's logo is ~1:1) — objectFit: contain keeps
  // both undistorted. objectPosition pins to the left so a square logo
  // doesn't float in centered whitespace inside a wide box.
  logoLg:     { width: 220, height: 110, objectFit: 'contain', objectPosition: 'left center' },
  logoSm:     { width: 120, height: 60,  objectFit: 'contain', objectPosition: 'left center' },

  // Diagonal "PAID" rubber stamp. Centered on a LETTER page (612×792pt)
  // with a hard rotation. The double border + ALL-CAPS text + spaced
  // letters mimic a real ink stamp.
  paidStamp:  {
    position: 'absolute',
    top: 320, left: 96, width: 420, height: 160,
    borderWidth: 6, borderColor: '#C0392B', borderStyle: 'solid',
    padding: 18, transform: 'rotate(-22deg)',
    alignItems: 'center', justifyContent: 'center',
  },
  paidStampText: {
    fontSize: 88, fontWeight: 700, color: '#C0392B',
    letterSpacing: 12, textAlign: 'center',
    fontFamily: 'Helvetica-Bold',
  },
  brandSub:   { fontSize: 14, fontWeight: 700, color: COLORS.ink, marginTop: 8, letterSpacing: 0.5 },
  hMetaLine:  { fontSize: 9, color: COLORS.mist },
  title:      { fontSize: 22, fontWeight: 700, color: COLORS.greenDark, marginBottom: 8 },
  meta:       { marginTop: 12 },
  metaRow:    { flexDirection: 'row', marginBottom: 4 },
  metaLabel:  { width: 90, color: COLORS.mist, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue:  { color: COLORS.ink, fontSize: 11, fontWeight: 700 },

  sectionHdr: { fontSize: 11, fontWeight: 700, color: COLORS.greenDark, textTransform: 'uppercase', letterSpacing: 1, marginTop: 22, marginBottom: 8, borderBottom: `1pt solid ${COLORS.pearl}`, paddingBottom: 4 },

  totalsTable: { marginTop: 8 },
  totalsRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottom: `0.5pt solid ${COLORS.pearl}` },
  totalsLabel: { color: COLORS.ink, fontSize: 11 },
  totalsValue: { color: COLORS.ink, fontSize: 11, fontWeight: 700 },
  grandRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 6, borderTop: `1pt solid ${COLORS.greenDark}`, borderBottom: `1pt solid ${COLORS.greenDark}` },
  grandLabel:  { color: COLORS.greenDark, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 },
  grandValue:  { color: COLORS.greenDark, fontSize: 13, fontWeight: 700 },

  catHdr:     { fontSize: 11, fontWeight: 700, color: COLORS.greenDark, marginTop: 16, marginBottom: 6 },
  itemRow:    { flexDirection: 'row', paddingVertical: 4, borderBottom: `0.5pt solid ${COLORS.pearl}` },
  itemDate:   { width: 64, color: COLORS.ash, fontSize: 10 },
  itemVendor: { flex: 1, color: COLORS.ink, fontSize: 10 },
  itemNotes:  { width: 160, color: COLORS.mist, fontSize: 9, fontStyle: 'italic' },
  itemAmount: { width: 80, textAlign: 'right', color: COLORS.ink, fontSize: 10, fontWeight: 700 },
  catSubRow:  { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 4, paddingRight: 0 },
  catSubLbl:  { color: COLORS.mist, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 },
  catSubVal:  { color: COLORS.ink, fontSize: 10, fontWeight: 700, width: 80, textAlign: 'right' },

  recGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  recCard:    { width: '48%', borderTop: `0.5pt solid ${COLORS.pearl}`, paddingTop: 8, marginBottom: 8 },
  recImage:   { width: '100%', height: 220, objectFit: 'contain' },
  recCap:     { marginTop: 6, fontSize: 9, color: COLORS.ash, textAlign: 'center' },

  footer:     { position: 'absolute', bottom: 24, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `0.5pt solid ${COLORS.pearl}`, paddingTop: 6 },
  footerNote: { fontSize: 8, color: COLORS.mist },
  signImage:  { width: 120, height: 36, objectFit: 'contain' },
})

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  flight: 'Flight',
  rental_car: 'Rental car',
  rideshare: 'Rideshare / Taxi',
  hotel: 'Hotel',
  meals: 'Meals',
  shipping_supplies: 'Shipping supplies',
  jewelry_lots_cash: 'Jewelry lots (cash)',
  mileage: 'Mileage',
  custom: 'Custom',
}
const CATEGORY_ORDER: ExpenseCategory[] = [
  'flight','rental_car','rideshare','hotel','meals',
  'shipping_supplies','jewelry_lots_cash','mileage','custom',
]

function categoryLabel(c: ExpenseCategory, customLabel: string | null): string {
  if (c === 'custom' && customLabel) return customLabel
  return CATEGORY_LABELS[c] ?? c
}

const fmt$ = (n: number | string | null | undefined) => fmtMoney(n, { cents: true })
const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtDateLong = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const titleCase = (s: string) =>
  s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')

export interface PdfReceipt {
  id: string
  url: string
  vendor: string | null
  date: string
  amount: number
}

export interface PdfData {
  report: ExpenseReport
  expenses: Expense[]
  event: { store_name: string; start_date: string } | null
  owner: { name: string }
  receipts: PdfReceipt[]
  signatureUrl?: string | null
  /** Brand wordmark + the encoding format detected from the bytes.
   *  format must match the actual encoding or @react-pdf renders nothing. */
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
}

export function ExpenseReportPdf({ report, expenses, event, owner, receipts, signatureUrl, logo }: PdfData) {
  // Group + sum by category, in canonical order so the cover totals
  // and the itemized section line up.
  const byCat = new Map<ExpenseCategory, Expense[]>()
  for (const e of expenses) {
    const arr = byCat.get(e.category) ?? []
    arr.push(e)
    byCat.set(e.category, arr)
  }
  for (const arr of byCat.values()) arr.sort((a, b) => a.expense_date.localeCompare(b.expense_date))

  const catTotals = CATEGORY_ORDER
    .map(c => ({
      cat: c,
      label: c === 'custom'
        ? 'Custom'  // cover page uses the generic "Custom" total; itemized page uses each line's custom_category_label
        : CATEGORY_LABELS[c],
      total: (byCat.get(c) ?? []).reduce((s, e) => s + Number(e.amount || 0), 0),
    }))
    .filter(r => r.total > 0)

  const isPaid = report.status === 'paid'
  const PaidStamp = () => (
    <View style={styles.paidStamp} fixed>
      <Text style={styles.paidStampText}>PAID</Text>
    </View>
  )

  return (
    <Document title={`Expense report — ${owner.name} — ${event?.store_name ?? 'event'}`}>
      {/* COVER PAGE */}
      <Page size="LETTER" style={styles.page}>
        {isPaid && <PaidStamp />}
        <View style={styles.hRow}>
          <View>
            {logo
              ? <Image style={styles.logoLg} src={{ data: logo.data, format: logo.format }} />
              : <Text style={{ fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 }}>BENEFICIAL ESTATE BUYERS</Text>}
            <Text style={styles.brandSub}>Expense Report</Text>
          </View>
          <View>
            <Text style={{ fontSize: 9, color: COLORS.mist, textAlign: 'right' }}>
              Generated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={{ fontSize: 8, color: COLORS.mist, textAlign: 'right' }}>Report #{report.id.slice(0, 8)}</Text>
          </View>
        </View>

        <Text style={styles.title}>{event?.store_name ?? '(unknown event)'}</Text>

        <View style={styles.meta}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Buyer</Text><Text style={styles.metaValue}>{owner.name}</Text></View>
          {event?.start_date && (
            <View style={styles.metaRow}><Text style={styles.metaLabel}>Event date</Text><Text style={styles.metaValue}>{fmtDateLong(event.start_date)}</Text></View>
          )}
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Status</Text><Text style={styles.metaValue}>{titleCase(report.status.replace(/_/g, ' '))}</Text></View>
          {report.submitted_at && (
            <View style={styles.metaRow}><Text style={styles.metaLabel}>Submitted</Text><Text style={styles.metaValue}>{fmtDateLong(report.submitted_at.slice(0, 10))}</Text></View>
          )}
        </View>

        <Text style={styles.sectionHdr}>Totals by Category</Text>
        <View style={styles.totalsTable}>
          {catTotals.length === 0 ? (
            <Text style={{ color: COLORS.mist, fontSize: 10, fontStyle: 'italic' }}>No expenses on this report.</Text>
          ) : catTotals.map(r => (
            <View key={r.cat} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{r.label}</Text>
              <Text style={styles.totalsValue}>{fmt$(r.total)}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Compensation</Text>
            <Text style={styles.totalsValue}>{fmt$(report.total_compensation)}</Text>
          </View>
          {Number(report.bonus_amount || 0) > 0 && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>
                Bonus{report.bonus_note ? ` — ${report.bonus_note}` : ''}
              </Text>
              <Text style={styles.totalsValue}>{fmt$(report.bonus_amount)}</Text>
            </View>
          )}
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Grand Total</Text>
            <Text style={styles.grandValue}>{fmt$(report.grand_total)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>Reimbursable expenses · personal cards only</Text>
          {signatureUrl
            ? <Image style={styles.signImage} src={signatureUrl} />
            : <Text style={styles.footerNote}>Page 1</Text>}
        </View>
      </Page>

      {/* ITEMIZED PAGE */}
      <Page size="LETTER" style={styles.page}>
        {isPaid && <PaidStamp />}
        <View style={styles.hRow}>
          {logo
            ? <Image style={styles.logoSm} src={{ data: logo.data, format: logo.format }} />
            : <Text style={{ fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 }}>BENEFICIAL ESTATE BUYERS</Text>}
          <Text style={styles.hMetaLine}>{owner.name} · {event?.store_name ?? ''}</Text>
        </View>

        <Text style={styles.sectionHdr}>Itemized Expenses</Text>

        {CATEGORY_ORDER.map(cat => {
          const rows = byCat.get(cat) ?? []
          if (rows.length === 0) return null
          const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0)
          // For 'custom' rows, label per-line.
          return (
            <View key={cat} wrap={false}>
              <Text style={styles.catHdr}>{cat === 'custom' ? 'Custom' : CATEGORY_LABELS[cat]}</Text>
              {rows.map(e => (
                <View key={e.id} style={styles.itemRow}>
                  <Text style={styles.itemDate}>{fmtDate(e.expense_date)}</Text>
                  <Text style={styles.itemVendor}>{categoryLabel(e.category, e.custom_category_label) === CATEGORY_LABELS[e.category] ? (e.vendor || '—') : `${categoryLabel(e.category, e.custom_category_label)} · ${e.vendor || '—'}`}</Text>
                  <Text style={styles.itemNotes}>{e.notes ?? ''}</Text>
                  <Text style={styles.itemAmount}>{fmt$(e.amount)}</Text>
                </View>
              ))}
              <View style={styles.catSubRow}>
                <Text style={styles.catSubLbl}>{cat === 'custom' ? 'Custom subtotal' : `${CATEGORY_LABELS[cat]} subtotal`}</Text>
                <Text style={styles.catSubVal}>{fmt$(total)}</Text>
              </View>
            </View>
          )
        })}

        <View style={styles.grandRow}>
          <Text style={styles.grandLabel}>Grand Total</Text>
          <Text style={styles.grandValue}>{fmt$(report.grand_total)}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>Page 2</Text>
          <Text style={styles.footerNote}>Report #{report.id.slice(0, 8)}</Text>
        </View>
      </Page>

      {/* RECEIPT APPENDIX (only when receipts exist) */}
      {receipts.length > 0 && (
        <Page size="LETTER" style={styles.page} wrap>
          {isPaid && <PaidStamp />}
          <View style={styles.hRow}>
            {logo
              ? <Image style={styles.logoSm} src={{ data: logo.data, format: logo.format }} />
              : <Text style={{ fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 }}>BENEFICIAL ESTATE BUYERS</Text>}
            <Text style={styles.hMetaLine}>{owner.name} · receipts ({receipts.length})</Text>
          </View>
          <Text style={styles.sectionHdr}>Receipt Appendix</Text>
          <View style={styles.recGrid}>
            {receipts.map(r => (
              <View key={r.id} style={styles.recCard} wrap={false}>
                <Image style={styles.recImage} src={r.url} />
                <Text style={styles.recCap}>{(r.vendor || '—')} · {fmtDate(r.date)} · {fmt$(r.amount)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.footer} fixed>
            <Text style={styles.footerNote}>Receipt appendix</Text>
            <Text style={styles.footerNote}>Report #{report.id.slice(0, 8)}</Text>
          </View>
        </Page>
      )}
    </Document>
  )
}
