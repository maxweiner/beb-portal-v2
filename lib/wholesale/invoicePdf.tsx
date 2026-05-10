// Invoice PDF — Liberty-branded. Lines + trade-in credit + payments
// + balance. No sales tax (wholesale only).

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

export interface InvoicePdfData {
  brand: string
  brandFullName: string
  brandAddress?: string | null
  brandPhone?: string | null
  brandEmail?: string | null
  invoice_number: string
  invoice_date: string
  payment_terms?: string | null
  notes?: string | null
  customer: {
    company_name: string
    contact_name?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
    resale_certificate_number?: string | null
  }
  lines: Array<{
    item_number: string
    description: string
    sale_price_cents: number
    photo_data_url?: string | null
  }>
  tradeins: Array<{
    description: string
    agreed_price_cents: number
    category: string
  }>
  payments: Array<{
    paid_on: string
    amount_cents: number
    method?: string | null
    reference?: string | null
  }>
  subtotal_cents: number
  tradein_credit_cents: number
  total_due_cents: number
  paid_cents: number
}

const styles = StyleSheet.create({
  page:        { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a16' },
  hdrRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  brandBlock:  { flexDirection: 'column' },
  brandName:   { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  brandLine:   { fontSize: 9, color: '#444' },
  metaBlock:   { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle:    { fontSize: 22, fontWeight: 700, color: '#10261c', marginBottom: 4 },
  metaLine:    { fontSize: 10 },
  toBlock:     { marginTop: 8, marginBottom: 12, padding: 8, backgroundColor: '#f5f5f0', borderRadius: 4 },
  toLabel:     { fontSize: 8, color: '#888', textTransform: 'uppercase', marginBottom: 2 },
  toName:      { fontSize: 12, fontWeight: 700 },
  table:       { borderWidth: 1, borderColor: '#000', marginBottom: 8 },
  trh:         { flexDirection: 'row', backgroundColor: '#eaeaea', borderBottomWidth: 1, borderBottomColor: '#000' },
  th:          { padding: 6, fontSize: 9, fontWeight: 700 },
  tr:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999' },
  td:          { padding: 6, fontSize: 10 },
  cPhoto:      { width: 56 },
  cItem:       { width: 70 },
  cDesc:       { flex: 1 },
  cPrice:      { width: 80, textAlign: 'right' },
  photoImg:    { width: 44, height: 44, objectFit: 'cover' },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalLbl:    { width: '60%', textAlign: 'right', paddingRight: 8 },
  totalVal:    { width: '40%', textAlign: 'right' },
  block:       { marginTop: 10, fontSize: 9 },
  blockHd:     { fontWeight: 700, marginBottom: 4, color: '#10261c' },
  notesBlock:  { marginTop: 14, fontSize: 9, color: '#444' },
})

const fmtMoney = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate  = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

export function InvoicePdfDoc({ data }: { data: InvoicePdfData }) {
  const balance = data.total_due_cents - data.paid_cents
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{data.brandFullName}</Text>
            {data.brandAddress ? <Text style={styles.brandLine}>{data.brandAddress}</Text> : null}
            {data.brandPhone   ? <Text style={styles.brandLine}>{data.brandPhone}</Text>   : null}
            {data.brandEmail   ? <Text style={styles.brandLine}>{data.brandEmail}</Text>   : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>INVOICE</Text>
            <Text style={styles.metaLine}><Text style={{ color: '#888' }}>No.   </Text>{data.invoice_number}</Text>
            <Text style={styles.metaLine}><Text style={{ color: '#888' }}>Date  </Text>{fmtDate(data.invoice_date)}</Text>
            {data.payment_terms ? <Text style={styles.metaLine}><Text style={{ color: '#888' }}>Terms </Text>{data.payment_terms}</Text> : null}
          </View>
        </View>

        <View style={styles.toBlock}>
          <Text style={styles.toLabel}>Bill to</Text>
          <Text style={styles.toName}>{data.customer.company_name}</Text>
          {data.customer.contact_name ? <Text style={styles.brandLine}>{data.customer.contact_name}</Text> : null}
          {data.customer.address      ? <Text style={styles.brandLine}>{data.customer.address}</Text>      : null}
          {data.customer.phone        ? <Text style={styles.brandLine}>{data.customer.phone}</Text>        : null}
          {data.customer.email        ? <Text style={styles.brandLine}>{data.customer.email}</Text>        : null}
          {data.customer.resale_certificate_number
            ? <Text style={[styles.brandLine, { marginTop: 2 }]}>Resale cert: {data.customer.resale_certificate_number}</Text>
            : null}
        </View>

        <View style={styles.table}>
          <View style={styles.trh}>
            <Text style={[styles.th, styles.cPhoto]}> </Text>
            <Text style={[styles.th, styles.cItem]}>Item #</Text>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cPrice]}>Price</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tr}>
              <View style={[styles.td, styles.cPhoto]}>
                {l.photo_data_url ? <Image src={l.photo_data_url} style={styles.photoImg} /> : <Text> </Text>}
              </View>
              <Text style={[styles.td, styles.cItem]}>{l.item_number}</Text>
              <Text style={[styles.td, styles.cDesc]}>{l.description}</Text>
              <Text style={[styles.td, styles.cPrice]}>{fmtMoney(l.sale_price_cents)}</Text>
            </View>
          ))}
        </View>

        {data.tradeins.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockHd}>Trade-in credit</Text>
            {data.tradeins.map((t, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={styles.totalLbl}>{t.description} ({t.category})</Text>
                <Text style={styles.totalVal}>−{fmtMoney(t.agreed_price_cents)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.block, { marginTop: 12 }]}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Subtotal</Text>
            <Text style={styles.totalVal}>{fmtMoney(data.subtotal_cents)}</Text>
          </View>
          {data.tradein_credit_cents > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLbl}>Trade-in credit</Text>
              <Text style={styles.totalVal}>−{fmtMoney(data.tradein_credit_cents)}</Text>
            </View>
          ) : null}
          <View style={[styles.totalRow, { paddingTop: 6, borderTopWidth: 0.5, borderTopColor: '#000' }]}>
            <Text style={[styles.totalLbl, { fontWeight: 700 }]}>Total due</Text>
            <Text style={[styles.totalVal, { fontWeight: 700 }]}>{fmtMoney(data.total_due_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Payments received</Text>
            <Text style={styles.totalVal}>−{fmtMoney(data.paid_cents)}</Text>
          </View>
          <View style={[styles.totalRow, { paddingTop: 6, borderTopWidth: 0.5, borderTopColor: '#000' }]}>
            <Text style={[styles.totalLbl, { fontWeight: 700 }]}>Balance</Text>
            <Text style={[styles.totalVal, { fontWeight: 700 }]}>{fmtMoney(balance)}</Text>
          </View>
        </View>

        {data.payments.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockHd}>Payments</Text>
            {data.payments.map((p, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={styles.totalLbl}>{fmtDate(p.paid_on)} — {p.method || '—'} {p.reference ? `(${p.reference})` : ''}</Text>
                <Text style={styles.totalVal}>{fmtMoney(p.amount_cents)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.notes ? (
          <View style={styles.notesBlock}>
            <Text style={{ fontWeight: 700 }}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
