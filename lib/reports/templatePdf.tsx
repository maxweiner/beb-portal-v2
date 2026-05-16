// PDF preview for a Reports template draft.
//
// Parallel to lib/communications/templatePdf.tsx but shaped for the
// 5-field report_templates schema (subject + greeting + header_subtitle
// + footer + shoutout_fallback) rather than the comms-template
// 3-fielder (name + subject_line + body).
//
// Used as the "review-before-save" gate in
// components/reports/AiReportTemplateModal.tsx — Save stays disabled
// until the operator hits the PDF route at least once.

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

export interface ReportTemplatePdfData {
  reportTitle: string                  // e.g. "Daily Briefing"
  reportDescription: string
  // The 5 editable template fields, AFTER variable substitution
  // (preview values) — the PDF renderer doesn't try to substitute,
  // we pass it both raw and previewed.
  raw: {
    subject: string
    greeting: string
    header_subtitle: string
    footer: string
    shoutout_fallback: string
  }
  preview: {
    subject: string
    greeting: string
    header_subtitle: string
    footer: string
    shoutout_fallback: string
  }
  varHint: string
  generatedAt: string
  generatedByName?: string | null
  prompt?: string | null
  mode: 'new' | 'refine'
}

const styles = StyleSheet.create({
  page:           { padding: 36, fontSize: 11, fontFamily: 'Helvetica', color: '#1a1a16', lineHeight: 1.4 },
  hdrRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  brandBlock:     { flexDirection: 'column' },
  brandName:      { fontSize: 14, fontWeight: 700, color: '#10261C' },
  brandLine:      { fontSize: 9, color: '#444' },
  metaBlock:      { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle:       { fontSize: 18, fontWeight: 700, color: '#10261C', marginBottom: 2 },
  metaLine:       { fontSize: 9 },
  draftBadge:     { fontSize: 9, fontWeight: 700, backgroundColor: '#FEF3C7', color: '#78350F', padding: '3px 8px', borderRadius: 4, marginTop: 4 },
  fieldBlock:     { marginBottom: 10 },
  fieldLbl:       { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  fieldVal:       { fontSize: 12, fontWeight: 700, color: '#10261C' },
  sectionTitle:   { fontSize: 11, fontWeight: 700, color: '#10261C', marginTop: 12, marginBottom: 8, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: '#cbcbc6' },
  preview:        { backgroundColor: '#F5F0E8', borderRadius: 6, padding: 14, marginTop: 4 },
  previewHint:    { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  previewHeaderBox: { backgroundColor: '#2D3B2D', padding: 14, borderRadius: 4, marginBottom: 10 },
  previewHeaderSubjLbl: { fontSize: 7, color: '#cbb685', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  previewHeaderSubj: { fontSize: 9, color: '#fff', backgroundColor: 'rgba(0,0,0,.3)', padding: '4px 8px', borderRadius: 3, marginBottom: 8, fontFamily: 'Courier' },
  previewGreeting:    { fontSize: 14, fontWeight: 700, color: '#fff' },
  previewSubtitle:    { fontSize: 9, color: 'rgba(255,255,255,.6)', marginTop: 2 },
  previewShoutout:    { fontSize: 9, color: 'rgba(255,255,255,.85)', marginTop: 8, padding: 8, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: 3, lineHeight: 1.5 },
  previewBodyPh:      { textAlign: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 4, color: '#a8a89a', fontSize: 9, fontStyle: 'italic' },
  previewFooter:      { textAlign: 'center', fontSize: 8, color: '#888', marginTop: 8, padding: 6 },
  promptBox:      { marginTop: 14, padding: 10, backgroundColor: '#fff', borderLeftWidth: 3, borderLeftColor: '#1D6B44', borderRadius: 2 },
  promptLbl:      { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  promptText:     { fontSize: 9, color: '#444', lineHeight: 1.4, fontStyle: 'italic' },
  varHintBox:     { marginTop: 10, padding: '8px 12px', backgroundColor: '#fffaf0', borderRadius: 4, borderWidth: 0.5, borderColor: '#f0e3c0' },
  varHintLbl:     { fontSize: 8, color: '#78350F', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  varHintText:    { fontSize: 9, color: '#78350F', fontFamily: 'Courier' },
  footerNote:     { marginTop: 14, fontSize: 8, color: '#888', lineHeight: 1.4 },
})

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function ReportTemplatePdfDoc({ data }: { data: ReportTemplatePdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>Beneficial Estate Buyers</Text>
            <Text style={styles.brandLine}>Reports · Template review</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>{data.mode === 'refine' ? 'REFINED' : 'NEW'} TEMPLATE</Text>
            <Text style={styles.metaLine}>Generated {fmtDateTime(data.generatedAt)}</Text>
            {data.generatedByName ? <Text style={styles.metaLine}>By {data.generatedByName}</Text> : null}
            <Text style={styles.draftBadge}>DRAFT · REVIEW BEFORE SAVING</Text>
          </View>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Report</Text>
          <Text style={styles.fieldVal}>{data.reportTitle}</Text>
        </View>

        <Text style={styles.sectionTitle}>Raw template fields (what gets saved)</Text>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Subject line</Text>
          <Text style={styles.fieldVal}>{data.raw.subject || '—'}</Text>
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Greeting</Text>
          <Text style={styles.fieldVal}>{data.raw.greeting || '—'}</Text>
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Header subtitle</Text>
          <Text style={styles.fieldVal}>{data.raw.header_subtitle || '—'}</Text>
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Shoutout / opening message</Text>
          <Text style={styles.fieldVal}>{data.raw.shoutout_fallback || '—'}</Text>
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLbl}>Footer</Text>
          <Text style={styles.fieldVal}>{data.raw.footer || '—'}</Text>
        </View>

        <View style={styles.varHintBox}>
          <Text style={styles.varHintLbl}>Variables available for this report</Text>
          <Text style={styles.varHintText}>{data.varHint}</Text>
        </View>

        <Text style={styles.sectionTitle}>How a recipient sees it (sample values substituted)</Text>

        <View style={styles.preview}>
          <Text style={styles.previewHint}>Email preview</Text>
          <View style={styles.previewHeaderBox}>
            <Text style={styles.previewHeaderSubjLbl}>Subject</Text>
            <Text style={styles.previewHeaderSubj}>{data.preview.subject}</Text>
            <Text style={styles.previewGreeting}>{data.preview.greeting}</Text>
            <Text style={styles.previewSubtitle}>{data.preview.header_subtitle}</Text>
            {data.preview.shoutout_fallback ? (
              <Text style={styles.previewShoutout}>{data.preview.shoutout_fallback}</Text>
            ) : null}
          </View>
          <Text style={styles.previewBodyPh}>[ Per-event data renders here at send time ]</Text>
          <Text style={styles.previewFooter}>{data.preview.footer}</Text>
        </View>

        {data.prompt ? (
          <View style={styles.promptBox}>
            <Text style={styles.promptLbl}>Your prompt</Text>
            <Text style={styles.promptText}>{data.prompt}</Text>
          </View>
        ) : null}

        <Text style={styles.footerNote}>
          Preview only — this template has NOT been saved yet. Close this PDF and click &quot;Save template&quot; in the modal to commit, or &quot;Re-generate&quot; to try a different prompt. Variable substitution uses representative sample values; real sends pull live data at fire time.
        </Text>
      </Page>
    </Document>
  )
}
