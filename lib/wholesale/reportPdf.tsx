// Generic report PDF — Liberty / brand-logo header, title, date range,
// then a single table with as many columns as the report has. Used by
// /api/wholesale/report/pdf which accepts the same shape ReportsView
// already builds in the browser.

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

export interface ReportPdfData {
  brand: string
  brandFullName: string
  brandLogoDataUrl?: string | null
  brandAddress?: string | null
  brandPhone?: string | null
  brandEmail?: string | null
  reportLabel: string
  generatedAt: string             // ISO string
  dateRange?: { from: string; to: string } | null
  columns: string[]
  rows: Array<Record<string, any> & { __isTotal?: boolean }>
}

const styles = StyleSheet.create({
  page:        { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a16' },
  hdrRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  brandBlock:  { flexDirection: 'column' },
  brandName:   { fontSize: 14, fontWeight: 700 },
  brandLine:   { fontSize: 8, color: '#444' },
  metaBlock:   { flexDirection: 'column', alignItems: 'flex-end' },
  reportLbl:   { fontSize: 18, fontWeight: 700, color: '#10261c' },
  metaLine:    { fontSize: 9, color: '#444' },

  table:       { borderWidth: 1, borderColor: '#000' },
  trh:         { flexDirection: 'row', backgroundColor: '#eaeaea', borderBottomWidth: 1, borderBottomColor: '#000' },
  th:          { padding: 5, fontSize: 8, fontWeight: 700 },
  tr:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999' },
  trTotal:     { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#000', backgroundColor: '#fafafa' },
  td:          { padding: 5, fontSize: 9 },
  tdTotal:     { padding: 5, fontSize: 9, fontWeight: 700 },
  footer:      { position: 'absolute', bottom: 20, left: 32, right: 32, fontSize: 7, color: '#888', textAlign: 'right' },
})

const fmtDate = (iso: string) => new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

export function ReportPdfDoc({ data }: { data: ReportPdfData }) {
  // Distribute column widths evenly. For known dollar / number columns,
  // align right so totals + amounts read cleanly.
  const colCount = data.columns.length
  const colWidth = `${(100 / colCount).toFixed(2)}%`
  const isNumberCol = (name: string) =>
    /^(cost|wholesale|retail|total|paid|balance|profit|margin %|days|count|invoices|items)$/i.test(name)

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            {data.brandLogoDataUrl ? (
              <Image src={data.brandLogoDataUrl} style={{ width: 140, height: 50, objectFit: 'contain', objectPosition: 'left center', marginBottom: 4 }} />
            ) : null}
            <Text style={styles.brandName}>{data.brandFullName}</Text>
            {data.brandAddress ? <Text style={styles.brandLine}>{data.brandAddress}</Text> : null}
            {data.brandPhone   ? <Text style={styles.brandLine}>{data.brandPhone}</Text>   : null}
            {data.brandEmail   ? <Text style={styles.brandLine}>{data.brandEmail}</Text>   : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.reportLbl}>{data.reportLabel}</Text>
            {data.dateRange ? (
              <Text style={styles.metaLine}>{fmtDate(data.dateRange.from)} — {fmtDate(data.dateRange.to)}</Text>
            ) : null}
            <Text style={styles.metaLine}>Generated {fmtDate(data.generatedAt)}</Text>
            <Text style={styles.metaLine}>{data.rows.filter(r => !r.__isTotal).length} rows</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.trh} fixed>
            {data.columns.map(c => (
              <Text key={c} style={[styles.th, { width: colWidth, textAlign: isNumberCol(c) ? 'right' : 'left' }]}>{c}</Text>
            ))}
          </View>
          {data.rows.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: '100%', textAlign: 'center', color: '#888' }]}>No rows.</Text>
            </View>
          ) : data.rows.map((r, i) => (
            <View key={i} style={r.__isTotal ? styles.trTotal : styles.tr} wrap={false}>
              {data.columns.map(c => (
                <Text key={c} style={[r.__isTotal ? styles.tdTotal : styles.td, { width: colWidth, textAlign: isNumberCol(c) ? 'right' : 'left' }]}>
                  {r[c] == null ? '' : String(r[c])}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${data.brandFullName} · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  )
}
