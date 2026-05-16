// PDF preview for a trunk-communications template.
//
// Rendered server-side via @react-pdf/renderer when the user clicks
// "📄 Open PDF preview" in the AI generation modal — the design
// gate keeps anyone from saving a template without first eyeballing
// what it actually looks like on paper.
//
// Substitutes the canonical SAMPLE_FIXTURE for merge fields so the
// preview shows real-looking values ("Sample Jewelers", "March 11,
// 2026") instead of bare {store_name} braces. That way the operator
// reads the template the way a recipient would.

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { applyMergeFields, SAMPLE_FIXTURE } from './mergeFields'

export interface TemplatePdfData {
  name: string
  subject_line: string
  body: string
  generatedAt: string  // ISO
  generatedByName?: string | null
  /** The prompt the user typed to generate this. Surfaced in a
   *  footnote so the reviewer can confirm the intent matches what
   *  came out. */
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
  draftBadge:  {
    fontSize: 9, fontWeight: 700,
    backgroundColor: '#FEF3C7', color: '#78350F',
    padding: '3px 8px', borderRadius: 4, marginTop: 4,
  },

  fieldBlock:  { marginBottom: 12 },
  fieldLbl:    { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  fieldVal:    { fontSize: 12, fontWeight: 700, color: '#10261C' },

  preview:     {
    backgroundColor: '#F5F0E8',
    borderRadius: 6,
    padding: 14,
    marginTop: 14,
  },
  previewHint: { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  previewSubject: { fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#10261C' },
  previewDivider: { borderBottomWidth: 0.5, borderBottomColor: '#cbcbc6', marginBottom: 8 },
  previewBody: { fontSize: 11, lineHeight: 1.5, color: '#1a1a16' },

  promptBox:   {
    marginTop: 18,
    padding: 10,
    backgroundColor: '#fff',
    borderLeftWidth: 3,
    borderLeftColor: '#1D6B44',
    borderRadius: 2,
  },
  promptLbl:   { fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  promptText:  { fontSize: 9, color: '#444', lineHeight: 1.4, fontStyle: 'italic' },

  footerNote:  { marginTop: 18, fontSize: 8, color: '#888', lineHeight: 1.4 },
})

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function TemplatePdfDoc({ data }: { data: TemplatePdfData }) {
  // Substitute merge fields with the SAMPLE_FIXTURE values so the
  // preview shows what a real recipient would see, not raw braces.
  const previewSubject = applyMergeFields(data.subject_line, SAMPLE_FIXTURE)
  const previewBody = applyMergeFields(data.body, SAMPLE_FIXTURE)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hdrRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>Beneficial Estate Buyers</Text>
            <Text style={styles.brandLine}>Trunk Communications · Template review</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.docTitle}>{data.mode === 'refine' ? 'REFINED' : 'NEW'} TEMPLATE</Text>
            <Text style={styles.metaLine}>Generated {fmtDateTime(data.generatedAt)}</Text>
            {data.generatedByName ? (
              <Text style={styles.metaLine}>By {data.generatedByName}</Text>
            ) : null}
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
          <Text style={styles.previewHint}>How a recipient sees it (sample values substituted)</Text>
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
          Preview only — this template has NOT been saved yet. Close this PDF and click "Save template" in the modal to commit, or "Re-generate" to try a different prompt. Merge-field substitution uses representative sample values; real sends pull live data from the trunk-show + store + rep.
        </Text>
      </Page>
    </Document>
  )
}
