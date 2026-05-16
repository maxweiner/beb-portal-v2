// PDF preview for a buying-communications template. Parallel to
// templatePdf.tsx (trunk-side). Uses BUYING_SAMPLE_FIXTURE so
// merge fields render with real-looking buying-event values
// ({buyer_names} → 'Max, Joe, Rich' etc).

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { applyBuyingMergeFields, BUYING_SAMPLE_FIXTURE } from './buyingMergeFields'

export interface BuyingTemplatePdfData {
  name: string
  subject_line: string
  body: string
  generatedAt: string
  generatedByName?: string | null
  prompt?: string | null
  mode: 'new' | 'refine'
}

const styles = StyleSheet.create({
  page:        { padding: 36, fontSize: 11, fontFamily: 'Helvetica', color: '#1a1a16', lineHeight: 1.4 },
  hdrRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  brandBlock:  { flexDirection: 'column' },
  brandName:   { fontSize: 14, fontWeight: 700, color: '#10261C' },
  brandLine:   { fontSize: 9, color: '#444' },
  metaBlock:   { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle:    { fontSize: 18, fontWeight: 700, color: '#10261C', marginBottom: 2 },
  metaLine:    { fontSize: 9 },
  draftBadge:  { fontSize: 9, fontWeight: 700, backgroundColor: '#FEF3C7', color: '#78350F', padding: '3px 8px', borderRadius: 4, marginTop: 4 },
  fieldBlock:  { marginBottom: 12 },
  fieldLbl:    { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  fieldVal:    { fontSize: 12, fontWeight: 700, color: '#10261C' },
  preview:     { backgroundColor: '#F5F0E8', borderRadius: 6, padding: 14, marginTop: 14 },
  previewHint: { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  previewSubject: { fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#10261C' },
  previewDivider: { borderBottomWidth: 0.5, borderBottomColor: '#cbcbc6', marginBottom: 8 },
  previewBody: { fontSize: 11, lineHeight: 1.5, color: '#1a1a16' },
  promptBox:   { marginTop: 18, padding: 10, backgroundColor: '#fff', borderLeftWidth: 3, borderLeftColor: '#1D6B44', borderRadius: 2 },
  promptLbl:   { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  promptText:  { fontSize: 9, color: '#444', lineHeight: 1.4, fontStyle: 'italic' },
  footerNote:  { marginTop: 18, fontSize: 8, color: '#888', lineHeight: 1.4 },
})

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function BuyingTemplatePdfDoc({ data }: { data: BuyingTemplatePdfData }) {
  const previewSubject = applyBuyingMergeFields(data.subject_line, BUYING_SAMPLE_FIXTURE)
  const previewBody = applyBuyingMergeFields(data.body, BUYING_SAMPLE_FIXTURE)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>Beneficial Estate Buyers</Text>
            <Text style={styles.brandLine}>Buying Communications · Template review</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>{data.mode === 'refine' ? 'REFINED' : 'NEW'} TEMPLATE</Text>
            <Text style={styles.metaLine}>Generated {fmtDateTime(data.generatedAt)}</Text>
            {data.generatedByName ? <Text style={styles.metaLine}>By {data.generatedByName}</Text> : null}
            <Text style={styles.draftBadge}>DRAFT · REVIEW BEFORE SAVING</Text>
          </View>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Internal name</Text>
          <Text style={styles.fieldVal}>{data.name}</Text>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Subject line (raw, with merge fields)</Text>
          <Text style={styles.fieldVal}>{data.subject_line || '—'}</Text>
        </View>

        <View style={styles.preview}>
          <Text style={styles.previewHint}>How a store contact sees it (sample values substituted)</Text>
          <Text style={styles.previewSubject}>Subject: {previewSubject}</Text>
          <View style={styles.previewDivider} />
          <Text style={styles.previewBody}>{previewBody}</Text>
        </View>

        {data.prompt ? (
          <View style={styles.promptBox}>
            <Text style={styles.promptLbl}>Your prompt</Text>
            <Text style={styles.promptText}>{data.prompt}</Text>
          </View>
        ) : null}

        <Text style={styles.footerNote}>
          Preview only — this template has NOT been saved yet. Close this PDF and click &quot;Save template&quot; in the modal to commit, or &quot;Re-generate&quot; to try a different prompt. Merge-field substitution uses representative sample values; real sends pull live data from the buying event + store.
        </Text>
      </Page>
    </Document>
  )
}
