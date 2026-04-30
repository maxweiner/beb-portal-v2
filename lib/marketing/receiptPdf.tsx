// React-PDF document for the marketing accountant receipt. One-page
// summary auto-emailed (with PDF attached) when a campaign is marked
// paid. Mirrors the visual style of the expense report PDF for
// consistency.

import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'

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
  logoLg:     { width: 170, height: 79, objectFit: 'contain' },
  brandSub:   { fontSize: 9, color: COLORS.mist, marginTop: 4 },
  hMetaLine:  { fontSize: 9, color: COLORS.mist, textAlign: 'right' },

  title:      { fontSize: 22, fontWeight: 700, color: COLORS.greenDark, marginBottom: 8 },

  meta:       { marginTop: 12 },
  metaRow:    { flexDirection: 'row', marginBottom: 4 },
  metaLabel:  { width: 130, color: COLORS.mist, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue:  { color: COLORS.ink, fontSize: 11, fontWeight: 700, flex: 1 },

  sectionHdr: {
    fontSize: 11, fontWeight: 700, color: COLORS.greenDark,
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 22, marginBottom: 8,
    borderBottom: `1pt solid ${COLORS.pearl}`, paddingBottom: 4,
  },

  amountRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTop: `1pt solid ${COLORS.greenDark}`, borderBottom: `1pt solid ${COLORS.greenDark}`, marginTop: 6 },
  amountLbl:  { color: COLORS.greenDark, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 },
  amountVal:  { color: COLORS.greenDark, fontSize: 13, fontWeight: 700 },

  noteBox:    { marginTop: 12, padding: 10, backgroundColor: COLORS.cream2, borderRadius: 4, borderLeft: `3pt solid ${COLORS.green}` },
  noteLbl:    { fontSize: 9, color: COLORS.mist, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  noteVal:    { fontSize: 11, color: COLORS.ink },

  footer:     { position: 'absolute', bottom: 24, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `0.5pt solid ${COLORS.pearl}`, paddingTop: 6 },
  footerNote: { fontSize: 8, color: COLORS.mist },
})

const fmt$ = (n: number | string | null | undefined) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
const fmtDateRange = (startIso: string): string => {
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(start)
  end.setDate(start.getDate() + 2)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const startLabel = start.toLocaleDateString('en-US', sameMonth
    ? { month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en-US', { month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel}–${endLabel}`
}

export interface MarketingReceiptPdfData {
  campaignId: string
  flowType: 'vdp' | 'postcard' | 'newspaper'
  storeName: string
  storeAddress: string
  eventStart: string  // ISO date 'YYYY-MM-DD'
  budget: number
  paymentMethodLabel: string
  paymentMethodNote: string | null
  approverName: string
  paidAt: string  // ISO timestamp
  paidByName: string
  /** PNG/JPG buffer for the BEB wordmark; rendered in the header. */
  logo?: Buffer | null
}

const FLOW_LABELS: Record<MarketingReceiptPdfData['flowType'], string> = {
  vdp:       'VDP Mailers',
  postcard:  'Postcards',
  newspaper: 'Newspaper',
}

export function MarketingReceiptPdf(d: MarketingReceiptPdfData) {
  return (
    <Document title={`Marketing receipt — ${d.storeName} — ${d.eventStart}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hRow}>
          <View>
            {d.logo
              ? <Image style={styles.logoLg} src={{ data: d.logo, format: 'png' }} />
              : <Text style={{ fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 }}>BENEFICIAL ESTATE BUYERS</Text>}
            <Text style={styles.brandSub}>Marketing receipt</Text>
          </View>
          <View>
            <Text style={styles.hMetaLine}>
              Generated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={styles.hMetaLine}>Receipt #{d.campaignId.slice(0, 8)}</Text>
          </View>
        </View>

        <Text style={styles.title}>{d.storeName}</Text>

        <Text style={styles.sectionHdr}>Event</Text>
        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Store</Text>
            <Text style={styles.metaValue}>{d.storeName}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Address</Text>
            <Text style={styles.metaValue}>{d.storeAddress || '—'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Event dates</Text>
            <Text style={styles.metaValue}>{fmtDateRange(d.eventStart)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Marketing channel</Text>
            <Text style={styles.metaValue}>{FLOW_LABELS[d.flowType]}</Text>
          </View>
        </View>

        <Text style={styles.sectionHdr}>Payment</Text>
        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vendor</Text>
            <Text style={styles.metaValue}>Collected Concepts</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Payment method</Text>
            <Text style={styles.metaValue}>{d.paymentMethodLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Authorized by</Text>
            <Text style={styles.metaValue}>{d.approverName}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date paid</Text>
            <Text style={styles.metaValue}>{fmtDate(d.paidAt)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Marked paid by</Text>
            <Text style={styles.metaValue}>{d.paidByName}</Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text style={styles.amountLbl}>Amount Paid</Text>
          <Text style={styles.amountVal}>{fmt$(d.budget)}</Text>
        </View>

        {d.paymentMethodNote && (
          <View style={styles.noteBox}>
            <Text style={styles.noteLbl}>Approver note</Text>
            <Text style={styles.noteVal}>{d.paymentMethodNote}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>Beneficial Estate Buyers · Marketing receipt</Text>
          <Text style={styles.footerNote}>{d.campaignId}</Text>
        </View>
      </Page>
    </Document>
  )
}
