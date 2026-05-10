// Memo PDF — Liberty-branded, item list with primary photo +
// description + memo price, signature line, and a diagonal
// "MEMO — NOT A SALE" watermark across the page so a faxed copy
// can't be misread as an invoice.

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

export interface MemoPdfData {
  brand: string
  brandFullName: string
  brandAddress?: string | null
  brandPhone?: string | null
  brandEmail?: string | null
  memo_number: string
  date_created: string
  due_date: string
  notes?: string | null
  customer: {
    company_name: string
    contact_name?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
  }
  lines: Array<{
    item_number: string
    description: string
    memo_price_cents: number
    line_status: 'out' | 'returned' | 'sold'
    photo_data_url?: string | null
  }>
  termsAndConditions?: string | null
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

  table:       { borderWidth: 1, borderColor: '#000', marginBottom: 10 },
  trh:         { flexDirection: 'row', backgroundColor: '#eaeaea', borderBottomWidth: 1, borderBottomColor: '#000' },
  th:          { padding: 6, fontSize: 9, fontWeight: 700 },
  tr:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999' },
  td:          { padding: 6, fontSize: 10 },
  cPhoto:      { width: 56 },
  cItem:       { width: 70 },
  cDesc:       { flex: 1 },
  cPrice:      { width: 80, textAlign: 'right' },
  photoImg:    { width: 44, height: 44, objectFit: 'cover' },
  totalsRow:   { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: '#000', backgroundColor: '#fafafa' },

  watermark:   {
    position: 'absolute',
    top: '40%', left: 0, right: 0,
    textAlign: 'center',
    color: 'rgba(220,38,38,0.18)',
    fontSize: 84,
    fontWeight: 700,
    transform: 'rotate(-25deg)',
    letterSpacing: 4,
  },
  notesBlock:  { marginTop: 6, fontSize: 9, color: '#444' },
  termsBlock:  { marginTop: 14, fontSize: 8, color: '#444', lineHeight: 1.4 },
  signRow:     { marginTop: 28, flexDirection: 'row', gap: 12 },
  signCell:    { flex: 1 },
  signLine:    { borderBottomWidth: 0.5, borderBottomColor: '#000', height: 22 },
  signLbl:     { fontSize: 8, color: '#444', marginTop: 4 },
})

const fmtMoney = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate  = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const DEFAULT_TERMS =
  'These goods are received on memorandum only and remain the property of the issuer until paid for in full. ' +
  'They are not sold to the recipient and may be returned at any time. The recipient assumes all risk of loss, ' +
  'damage, or theft from the time of receipt until return. The recipient shall not consign, deliver, or otherwise ' +
  'release the goods to any third party. Title does not pass until full payment is received and cleared.'

export function MemoPdfDoc({ data }: { data: MemoPdfData }) {
  const subtotal = data.lines.reduce((s, l) => s + l.memo_price_cents, 0)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.watermark} fixed>MEMO — NOT A SALE</Text>

        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{data.brandFullName}</Text>
            {data.brandAddress ? <Text style={styles.brandLine}>{data.brandAddress}</Text> : null}
            {data.brandPhone   ? <Text style={styles.brandLine}>{data.brandPhone}</Text>   : null}
            {data.brandEmail   ? <Text style={styles.brandLine}>{data.brandEmail}</Text>   : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>MEMO</Text>
            <Text style={styles.metaLine}><Text style={{ color: '#888' }}>No.  </Text>{data.memo_number}</Text>
            <Text style={styles.metaLine}><Text style={{ color: '#888' }}>Date </Text>{fmtDate(data.date_created)}</Text>
            <Text style={styles.metaLine}><Text style={{ color: '#888' }}>Due  </Text>{fmtDate(data.due_date)}</Text>
          </View>
        </View>

        <View style={styles.toBlock}>
          <Text style={styles.toLabel}>To</Text>
          <Text style={styles.toName}>{data.customer.company_name}</Text>
          {data.customer.contact_name ? <Text style={styles.brandLine}>{data.customer.contact_name}</Text> : null}
          {data.customer.address      ? <Text style={styles.brandLine}>{data.customer.address}</Text>      : null}
          {data.customer.phone        ? <Text style={styles.brandLine}>{data.customer.phone}</Text>        : null}
          {data.customer.email        ? <Text style={styles.brandLine}>{data.customer.email}</Text>        : null}
        </View>

        <View style={styles.table}>
          <View style={styles.trh}>
            <Text style={[styles.th, styles.cPhoto]}> </Text>
            <Text style={[styles.th, styles.cItem]}>Item #</Text>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cPrice]}>Memo Price</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tr}>
              <View style={[styles.td, styles.cPhoto]}>
                {l.photo_data_url ? <Image src={l.photo_data_url} style={styles.photoImg} /> : <Text> </Text>}
              </View>
              <Text style={[styles.td, styles.cItem]}>{l.item_number}</Text>
              <Text style={[styles.td, styles.cDesc]}>
                {l.description}
                {l.line_status !== 'out' ? `  (${l.line_status})` : ''}
              </Text>
              <Text style={[styles.td, styles.cPrice]}>{fmtMoney(l.memo_price_cents)}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={[styles.td, { fontWeight: 700, padding: 8 }]}>Total memo value: {fmtMoney(subtotal)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.notesBlock}>
            <Text style={{ fontWeight: 700 }}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.termsBlock}>
          <Text style={{ fontWeight: 700, marginBottom: 4 }}>Terms &amp; Conditions</Text>
          <Text>{data.termsAndConditions || DEFAULT_TERMS}</Text>
        </View>

        <View style={styles.signRow}>
          <View style={styles.signCell}>
            <View style={styles.signLine} />
            <Text style={styles.signLbl}>Recipient signature</Text>
          </View>
          <View style={styles.signCell}>
            <View style={styles.signLine} />
            <Text style={styles.signLbl}>Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
