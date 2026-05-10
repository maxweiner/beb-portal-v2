// Item tag PDF — small label, item # rendered large in monospace
// (placeholder for a real CODE128 barcode + QR; install bwip-js +
// qrcode and swap in PNG buffers when ready). Designed for a 2"×1"
// dymo-ish label; one tag per page so you can print on roll labels.

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

export interface ItemTagPdfData {
  brand: string
  brandShortName: string
  items: Array<{
    item_number: string
    short_label: string         // category + key spec (e.g., "💎 D-1.05ct GIA 1234567")
    price_cents?: number | null // optional retail / wholesale to print
    qr_data_url?: string | null // future: scan-to-open
    barcode_data_url?: string | null // future: CODE128 of item_number
  }>
}

const styles = StyleSheet.create({
  page:        { padding: 12, fontFamily: 'Helvetica', color: '#000' },
  tag:         { width: 280, height: 130, borderWidth: 1, borderColor: '#000', padding: 8, marginBottom: 6 },
  brandSm:     { fontSize: 7, color: '#444', textTransform: 'uppercase', letterSpacing: 1 },
  itemNum:     { fontSize: 24, fontWeight: 700, fontFamily: 'Courier', marginVertical: 2 },
  short:       { fontSize: 9, marginVertical: 2 },
  price:       { fontSize: 14, fontWeight: 700, marginTop: 2 },
  placeholder: { fontSize: 8, color: '#888', marginTop: 4 },
})

const fmtMoney = (c: number | null | undefined) =>
  c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ItemTagPdfDoc({ data }: { data: ItemTagPdfData }) {
  return (
    <Document>
      <Page size={[290, 145]} style={styles.page}>
        {data.items.map((it, i) => (
          <View key={i} style={styles.tag}>
            <Text style={styles.brandSm}>{data.brandShortName}</Text>
            <Text style={styles.itemNum}>{it.item_number}</Text>
            <Text style={styles.short}>{it.short_label}</Text>
            {it.price_cents != null ? <Text style={styles.price}>{fmtMoney(it.price_cents)}</Text> : null}
            <Text style={styles.placeholder}>* scan code: install bwip-js + qrcode to print real barcodes here</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}
