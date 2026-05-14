// React-PDF document for a trunk-show communication letter.
//
// Letterhead (top): logo + BEB brand block
// Body: the rendered letter text the rep saw + edited
// Footer: company contact info
//
// Intentionally simple — no metadata table or appendix; just a
// branded letter. Style matches the expense report PDF colors
// for visual consistency.

import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'

const COLORS = {
  ink:       '#1F2937',
  ash:       '#4B5563',
  mist:      '#9CA3AF',
  pearl:     '#E5E7EB',
  green:     '#1D6B44',
  greenDark: '#11432B',
}

// TODO: surface in Settings later if these need to be editable
// per-environment. Hardcoded for now matches expense-report PDF
// pattern (no settings entry there either).
const COMPANY = {
  name:    'Beneficial Estate Buyers',
  address: 'Beneficial Estate Buyers',
  phone:   '',
  email:   'info@bebllp.com',
  website: 'bebllp.com',
}

const styles = StyleSheet.create({
  page: { padding: 54, fontSize: 11, fontFamily: 'Helvetica', color: COLORS.ink, lineHeight: 1.45 },

  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, paddingBottom: 14, borderBottom: `1pt solid ${COLORS.greenDark}` },
  logo:      { width: 200, height: 80, objectFit: 'contain', objectPosition: 'left center' },
  brandName: { fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 },
  brandSub:  { fontSize: 10, color: COLORS.mist, marginTop: 4 },
  hRight:    { textAlign: 'right' },
  hRightLine:{ fontSize: 9, color: COLORS.mist },

  date:    { marginTop: 8, marginBottom: 14, fontSize: 10, color: COLORS.mist },
  body:    { fontSize: 11, color: COLORS.ink, lineHeight: 1.55 },

  footer:    { position: 'absolute', bottom: 32, left: 54, right: 54, borderTop: `0.5pt solid ${COLORS.pearl}`, paddingTop: 8, textAlign: 'center' },
  footerLine:{ fontSize: 8.5, color: COLORS.mist, marginBottom: 2 },
})

export interface LetterPdfData {
  subject: string
  body: string
  storeContact: { name: string | null; email: string | null }
  rep: { name: string; email: string; phone: string }
  sentAt: string  // ISO
  logo: { data: Buffer; format: 'png' | 'jpg' } | null
}

export function LetterPdf(data: LetterPdfData) {
  return (
    <Document title={data.subject || 'Letter'}>
      <Page size="LETTER" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.header}>
          <View>
            {data.logo
              ? <Image style={styles.logo} src={{ data: data.logo.data, format: data.logo.format }} />
              : <Text style={styles.brandName}>{COMPANY.name.toUpperCase()}</Text>}
            <Text style={styles.brandSub}>Estate Trunk Show</Text>
          </View>
          <View style={styles.hRight}>
            {/* Header contact info — the SENDER's direct line, not the
                company catch-all. Recipients reply to the rep they're
                working with; bumping the rep's email + phone to the
                top makes that the obvious contact point. Falls back to
                COMPANY values when the rep row is missing the field
                (legacy templates, system-generated letters, etc.). */}
            <Text style={styles.hRightLine}>{data.rep.email || COMPANY.email}</Text>
            {data.rep.phone ? <Text style={styles.hRightLine}>{data.rep.phone}</Text> : <Text style={styles.hRightLine}>{COMPANY.website}</Text>}
          </View>
        </View>

        <Text style={styles.date}>
          {new Date(data.sentAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>

        {/* Body — split paragraphs for layout. Each blank line in
            the source body separates a paragraph; single newlines
            inside a paragraph become explicit breaks. */}
        {data.body.split(/\n\s*\n/).map((para, i) => (
          <Text key={i} style={[styles.body, { marginBottom: 10 }]}>
            {para.split('\n').map((line, j, arr) => (
              <React.Fragment key={j}>
                {line}
                {j < arr.length - 1 ? '\n' : ''}
              </React.Fragment>
            ))}
          </Text>
        ))}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLine}>{COMPANY.name} · {COMPANY.email} · {COMPANY.website}</Text>
          {data.rep.name && (
            <Text style={styles.footerLine}>
              Sent by {data.rep.name}
              {data.rep.email ? ` · ${data.rep.email}` : ''}
              {data.rep.phone ? ` · ${data.rep.phone}` : ''}
            </Text>
          )}
        </View>
      </Page>
    </Document>
  )
}
