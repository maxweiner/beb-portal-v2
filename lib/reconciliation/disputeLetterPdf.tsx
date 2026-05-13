// One-page dispute letter for a Wells Fargo cleared-check finding.
// Used by /api/reconciliation/findings/[id]/dispute-letter.
// Black/white only so it photocopies and faxes cleanly. The brand
// wordmark sits at the top-left of the letterhead when available,
// with the legal name and address beneath.

import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'

interface ClearedRow {
  cleared_date: string      // ISO
  cleared_amount: number
  description: string
}

export interface DisputeLetterData {
  brand: string                       // 'beb' | 'liberty'
  brandFullName: string               // 'Beneficial Estate Buyers, LLC'
  brandAddress?: string | null
  preparedByName: string              // current user
  preparedByEmail: string
  preparedAtIso: string
  findingType: 'amount_mismatch' | 'duplicate_clearing' | 'orphan_cleared' | 'outstanding'
  checkNumber: string
  writtenAmount: number | null
  writtenDate: string | null          // ISO YYYY-MM-DD
  payeeLabel: string | null
  eventLabel: string | null
  clearings: ClearedRow[]
  totalCleared: number
  amountDelta: number | null          // written - cleared (signed)
  bankName: string                    // 'Wells Fargo Bank, N.A.'
  accountLastFour?: string | null
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
}

const styles = StyleSheet.create({
  page:       { padding: 54, fontSize: 11, fontFamily: 'Helvetica', color: '#000', lineHeight: 1.45 },
  hdrRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  hdrLeft:    { flexDirection: 'column' },
  logo:       { width: 280, height: 90, objectFit: 'contain', objectPosition: 'left center', marginBottom: 10 },
  hdrCo:      { fontWeight: 700, fontSize: 13, marginBottom: 2 },
  hdrSm:      { fontSize: 10, color: '#222' },
  hdrRight:   { flexDirection: 'column', alignItems: 'flex-end' },
  date:       { fontSize: 10 },
  bankBlock:  { marginBottom: 16 },
  subj:       { fontWeight: 700, fontSize: 12, marginVertical: 12 },
  para:       { marginBottom: 10 },
  table:      { borderWidth: 1, borderColor: '#000', marginBottom: 10 },
  trh:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', backgroundColor: '#eaeaea' },
  th:         { padding: 6, fontWeight: 700, fontSize: 10 },
  tr:         { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#777' },
  td:         { padding: 6, fontSize: 10 },
  c1:         { width: '20%' },
  c2:         { width: '25%' },
  c3:         { width: '55%' },
  totalRow:   { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#000', backgroundColor: '#fafafa' },
  signBlock:  { marginTop: 28 },
  signLine:   { borderBottomWidth: 0.5, borderBottomColor: '#000', height: 22, marginTop: 18, width: '60%' },
  signLbl:    { fontSize: 9, color: '#444', marginTop: 4 },
})

const fmtMoney = (n: number | null | undefined) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateLong = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const SUBJECT: Record<DisputeLetterData['findingType'], string> = {
  amount_mismatch: 'Cleared-check amount discrepancy — request for adjustment',
  duplicate_clearing: 'Duplicate clearing of single check — request for reversal',
  orphan_cleared: 'Cleared check not in our records — request for image and verification',
  outstanding: 'Notice of outstanding check (informational)',
}

function Body({ data }: { data: DisputeLetterData }) {
  const sub = SUBJECT[data.findingType]
  const writtenLine = `Check #${data.checkNumber} written ${fmtDateLong(data.writtenDate)} for ${fmtMoney(data.writtenAmount)} payable to ${data.payeeLabel || '(unspecified payee)'}${data.eventLabel ? ` (${data.eventLabel})` : ''}.`

  let mainPara = ''
  if (data.findingType === 'amount_mismatch') {
    mainPara = `Our records show ${writtenLine} Your bank statement shows the same check cleared for ${fmtMoney(data.totalCleared)} on ${fmtDateLong(data.clearings[0]?.cleared_date)}. The difference is ${fmtMoney(Math.abs(data.amountDelta || 0))}${(data.amountDelta || 0) > 0 ? ' short of the written amount' : ' over the written amount'}. We request that the clearing be adjusted to match the written amount, or alternatively, that you provide the front and back of the cleared check for our review.`
  } else if (data.findingType === 'duplicate_clearing') {
    mainPara = `Our records show ${writtenLine} Your bank statement shows ${data.clearings.length} separate clearings of this check, totaling ${fmtMoney(data.totalCleared)}. A check should clear exactly once. We request that the duplicate clearings be reversed and the funds restored to our account, and that you provide the front and back of each cleared instance for our review.`
  } else if (data.findingType === 'orphan_cleared') {
    mainPara = `Your bank statement shows check #${data.checkNumber} cleared on ${fmtDateLong(data.clearings[0]?.cleared_date)} for ${fmtMoney(data.totalCleared)}. We have no record of issuing a check with this number. We request that you provide the front and back image of the cleared check so we can verify whether the clearing was authorized.`
  } else {
    mainPara = `Our records show ${writtenLine} As of the date of this letter the check has not yet cleared in our account.`
  }

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.hdrRow}>
        <View style={styles.hdrLeft}>
          {data.logo ? (
            <Image style={styles.logo} src={{ data: data.logo.data, format: data.logo.format }} />
          ) : null}
          <Text style={styles.hdrCo}>{data.brandFullName}</Text>
          {data.brandAddress ? <Text style={styles.hdrSm}>{data.brandAddress}</Text> : null}
        </View>
        <View style={styles.hdrRight}>
          <Text style={styles.date}>{fmtDateLong(data.preparedAtIso.slice(0, 10))}</Text>
        </View>
      </View>

      <View style={styles.bankBlock}>
        <Text>{data.bankName}</Text>
        <Text>Customer Service / Check Operations</Text>
      </View>

      <Text style={styles.subj}>RE: {sub}</Text>
      <Text style={styles.subj}>
        Account ending {data.accountLastFour ? `··${data.accountLastFour}` : '(provided separately)'} · Check #{data.checkNumber}
      </Text>

      <Text style={styles.para}>To Whom It May Concern,</Text>
      <Text style={styles.para}>{mainPara}</Text>

      {data.clearings.length > 0 && (
        <View style={styles.table}>
          <View style={styles.trh}>
            <Text style={[styles.th, styles.c1]}>Date</Text>
            <Text style={[styles.th, styles.c2]}>Amount</Text>
            <Text style={[styles.th, styles.c3]}>Bank description</Text>
          </View>
          {data.clearings.map((c, i) => (
            <View key={i} style={styles.tr}>
              <Text style={[styles.td, styles.c1]}>{fmtDateLong(c.cleared_date)}</Text>
              <Text style={[styles.td, styles.c2]}>{fmtMoney(c.cleared_amount)}</Text>
              <Text style={[styles.td, styles.c3]}>{c.description}</Text>
            </View>
          ))}
          {data.clearings.length > 1 && (
            <View style={styles.totalRow}>
              <Text style={[styles.td, styles.c1, { fontWeight: 700 }]}>Total</Text>
              <Text style={[styles.td, styles.c2, { fontWeight: 700 }]}>{fmtMoney(data.totalCleared)}</Text>
              <Text style={[styles.td, styles.c3]}> </Text>
            </View>
          )}
        </View>
      )}

      <Text style={styles.para}>
        Please contact me at {data.preparedByEmail} with any questions or to confirm receipt of this dispute. Thank you for your prompt attention.
      </Text>

      <View style={styles.signBlock}>
        <Text>Sincerely,</Text>
        <View style={styles.signLine} />
        <Text style={styles.signLbl}>{data.preparedByName} — {data.brandFullName}</Text>
      </View>
    </Page>
  )
}

export function DisputeLetterPdf({ data }: { data: DisputeLetterData }) {
  return (
    <Document>
      <Body data={data} />
    </Document>
  )
}
