// React-PDF document for a buying-day summary. One page per send,
// laid out as:
//   1. Header — brand logo + "Buying Day Summary" + store name/address
//   2. Running-totals card (through day N if mid-event, else event totals)
//   3. Per-day cards (newest first), each showing customers / purchases /
//      $ amount / close-rate
//   4. Lead-source bar chart (only when any lead-source data is present)
//
// Style mirrors the public /event/[id]/[day] HTML summary page. Letter
// size, Helvetica only (no external font loads — keeps cold start fast).

import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'

const COLORS = {
  ink:       '#1a1a16',
  ash:       '#4A4A42',
  mist:      '#A8A89A',
  pearl:     '#E5E1D7',
  cream:     '#F5F0E8',
  cream2:    '#EDE7DA',
  green:     '#1D6B44',
  greenDark: '#11432B',
  greenPale: '#E6F4EC',
  amber:     '#F59E0B',
  white:     '#FFFFFF',
}

const styles = StyleSheet.create({
  page:       { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: COLORS.ink, backgroundColor: COLORS.cream },
  hRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  logoLg:     { width: 200, height: 70, objectFit: 'contain', objectPosition: 'left center' },
  brandText:  { fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 },
  hMeta:      { fontSize: 9, color: COLORS.mist, textAlign: 'right' },
  hMetaBold:  { fontSize: 10, color: COLORS.ash, textAlign: 'right', marginTop: 2 },

  pillRow:    { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 12 },
  pillGreen:  { backgroundColor: COLORS.green, color: COLORS.white, fontSize: 10, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 12, borderRadius: 12 },
  pillAmber:  { backgroundColor: COLORS.amber, color: COLORS.white, fontSize: 10, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 12, borderRadius: 12 },

  storeName:  { fontSize: 22, fontWeight: 700, color: COLORS.ink, textAlign: 'center', marginBottom: 4 },
  storeMeta:  { fontSize: 11, color: COLORS.ash, textAlign: 'center', marginBottom: 4 },
  workersLine:{ fontSize: 10, color: COLORS.green, fontWeight: 700, textAlign: 'center', marginBottom: 18 },

  totalsCard: { backgroundColor: COLORS.green, borderRadius: 12, padding: 16, marginBottom: 14 },
  totalsHd:   { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  totalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  totalsCell: { width: '48%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: 10, alignItems: 'center' },
  totalsLbl:  { fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  totalsVal:  { fontSize: 18, fontWeight: 700, color: COLORS.white },

  dayCard:    { backgroundColor: COLORS.white, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.pearl },
  dayCardLatest: { borderColor: COLORS.green, borderWidth: 2 },
  dayHd:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  dayTitle:   { fontSize: 11, fontWeight: 700, color: COLORS.green },
  latestBadge:{ backgroundColor: COLORS.green, color: COLORS.white, fontSize: 8, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8 },
  dayGrid:    { flexDirection: 'row', justifyContent: 'space-between' },
  dayCell:    { flex: 1, alignItems: 'center' },
  dayVal:     { fontSize: 16, fontWeight: 700, color: COLORS.ink },
  dayLbl:     { fontSize: 8, color: COLORS.mist, marginTop: 2 },

  sourcesCard:{ backgroundColor: COLORS.white, borderRadius: 10, padding: 14, marginTop: 6, borderWidth: 1, borderColor: COLORS.pearl },
  sourcesHd:  { fontSize: 11, fontWeight: 700, color: COLORS.ink, marginBottom: 12 },
  sourceRow:  { marginBottom: 8 },
  sourceTop:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  sourceLbl:  { fontSize: 10, color: COLORS.ash },
  sourceVal:  { fontSize: 10, color: COLORS.ink, fontWeight: 700 },
  sourceBar:  { height: 6, backgroundColor: COLORS.cream2, borderRadius: 3 },
  sourceFill: { height: 6, borderRadius: 3 },

  footer:     { position: 'absolute', bottom: 24, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: COLORS.pearl, paddingTop: 6 },
  footerNote: { fontSize: 8, color: COLORS.mist },
})

export interface DayPdfDay {
  day_number: number
  customers: number | null
  purchases: number | null
  dollars10: string | number | null
  dollars5: string | number | null
  src_vdp?: number | null
  src_postcard?: number | null
  src_social?: number | null
  src_wordofmouth?: number | null
  src_repeat?: number | null
  src_store?: number | null
  src_text?: number | null
  src_newspaper?: number | null
  src_other?: number | null
}

export interface DayPdfData {
  event: {
    id: string
    store_name: string
    start_date: string
    workers?: { name: string }[] | null
    brand?: string | null
  }
  store: { name: string; city: string | null; state: string | null } | null
  days: DayPdfDay[]
  /** Day number we're "sending through". null = full event recap. */
  throughDay: number | null
  brandLabel: string
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
}

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtShort = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtLong = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const SOURCE_DEFS: { key: keyof DayPdfDay; label: string; color: string }[] = [
  { key: 'src_vdp',         label: 'VDP / Large Postcard', color: '#059669' },
  { key: 'src_postcard',    label: 'Store Postcard',       color: '#3B82F6' },
  { key: 'src_social',      label: 'Social Media',         color: '#8B5CF6' },
  { key: 'src_wordofmouth', label: 'Word of Mouth',        color: '#F59E0B' },
  { key: 'src_repeat',      label: 'Repeat Customer',      color: '#F43F5E' },
  { key: 'src_store',       label: 'Store',                color: '#0EA5E9' },
  { key: 'src_text',        label: 'Text Message',         color: '#10B981' },
  { key: 'src_newspaper',   label: 'Newspaper',            color: '#6366F1' },
  { key: 'src_other',       label: 'Other',                color: '#6B7280' },
]

export function DayPdf({ event, store, days, throughDay, brandLabel, logo }: DayPdfData) {
  const summaryDays = throughDay
    ? days.filter(d => d.day_number <= throughDay)
    : days
  const displayDays = throughDay
    ? [...summaryDays].sort((a, b) => b.day_number - a.day_number)
    : [...days].sort((a, b) => a.day_number - b.day_number)

  const totals = summaryDays.reduce((acc, d) => ({
    customers:     acc.customers + (d.customers || 0),
    purchases:     acc.purchases + (d.purchases || 0),
    dollars:       acc.dollars + parseFloat(String(d.dollars10 || 0)) + parseFloat(String(d.dollars5 || 0)),
    src_vdp:       acc.src_vdp + (d.src_vdp || 0),
    src_postcard:  acc.src_postcard + (d.src_postcard || 0),
    src_social:    acc.src_social + (d.src_social || 0),
    src_wom:       acc.src_wom + (d.src_wordofmouth || 0),
    src_repeat:    acc.src_repeat + (d.src_repeat || 0),
    src_store:     acc.src_store + (d.src_store || 0),
    src_text:      acc.src_text + (d.src_text || 0),
    src_newspaper: acc.src_newspaper + (d.src_newspaper || 0),
    src_other:     acc.src_other + (d.src_other || 0),
  }), { customers:0, purchases:0, dollars:0, src_vdp:0, src_postcard:0, src_social:0, src_wom:0, src_repeat:0, src_store:0, src_text:0, src_newspaper:0, src_other:0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0

  const dayLabel = (d: DayPdfDay) => {
    const dt = new Date(event.start_date + 'T12:00:00')
    dt.setDate(dt.getDate() + d.day_number - 1)
    return `Day ${d.day_number} — ${fmtShort(dt.toISOString().slice(0, 10))}`
  }

  const sourceTotal = SOURCE_DEFS.reduce((s, def) => {
    // map to totals key
    const k = def.key === 'src_wordofmouth' ? 'src_wom' : (def.key as string)
    return s + ((totals as any)[k] || 0)
  }, 0)
  const sourceRows = SOURCE_DEFS
    .map(def => {
      const k = def.key === 'src_wordofmouth' ? 'src_wom' : (def.key as string)
      return { label: def.label, color: def.color, value: (totals as any)[k] || 0 }
    })
    .filter(r => r.value > 0)

  const storeLine = store
    ? [store.name, [store.city, store.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    : event.store_name

  return (
    <Document title={`${event.store_name} — ${throughDay ? `Day ${throughDay}` : 'Recap'}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hRow}>
          <View>
            {logo
              ? <Image style={styles.logoLg} src={{ data: logo.data, format: logo.format }} />
              : <Text style={styles.brandText}>{brandLabel.toUpperCase()}</Text>}
          </View>
          <View>
            <Text style={styles.hMeta}>Generated {fmtLong(new Date().toISOString().slice(0, 10))}</Text>
            <Text style={styles.hMetaBold}>{throughDay ? `Through Day ${throughDay}` : 'Event Recap'}</Text>
          </View>
        </View>

        <View style={styles.pillRow}>
          <Text style={styles.pillGreen}>◆ Buyer Event Summary</Text>
          {throughDay && <Text style={styles.pillAmber}>Through Day {throughDay}</Text>}
        </View>

        <Text style={styles.storeName}>{store?.name || event.store_name}</Text>
        <Text style={styles.storeMeta}>
          {storeLine} · Started {fmtLong(event.start_date)}
        </Text>
        {event.workers && event.workers.length > 0 && (
          <Text style={styles.workersLine}>
            Buyers: {event.workers.map(w => w.name).join(', ')}
          </Text>
        )}

        {/* Totals card */}
        <View style={styles.totalsCard}>
          <Text style={styles.totalsHd}>
            {throughDay ? `Running Totals — Days 1–${throughDay}` : 'Event Totals'}
          </Text>
          <View style={styles.totalsGrid}>
            {([
              ['Customers', totals.customers.toLocaleString()],
              ['Purchases', totals.purchases.toLocaleString()],
              ['Amount Spent', fmtMoney(totals.dollars)],
              ['Close Rate', `${closeRate}%`],
            ] as [string, string][]).map(([lbl, val]) => (
              <View key={lbl} style={styles.totalsCell}>
                <Text style={styles.totalsLbl}>{lbl}</Text>
                <Text style={styles.totalsVal}>{val}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Per-day cards (newest first when through-day, else chrono) */}
        {displayDays.map(d => {
          const isLatest = throughDay !== null && d.day_number === throughDay
          const dayDollars = parseFloat(String(d.dollars10 || 0)) + parseFloat(String(d.dollars5 || 0))
          const dayCR = (d.customers || 0) > 0 ? Math.round((d.purchases || 0) / (d.customers || 1) * 100) : 0
          return (
            <View
              key={d.day_number}
              style={isLatest ? { ...styles.dayCard, ...styles.dayCardLatest } : styles.dayCard}
              wrap={false}
            >
              <View style={styles.dayHd}>
                <Text style={styles.dayTitle}>{dayLabel(d)}</Text>
                {isLatest && <Text style={styles.latestBadge}>Latest</Text>}
              </View>
              <View style={styles.dayGrid}>
                {([
                  ['Customers', String(d.customers || 0)],
                  ['Purchases', String(d.purchases || 0)],
                  ['Amount', fmtMoney(dayDollars)],
                  ['Close', `${dayCR}%`],
                ] as [string, string][]).map(([lbl, val]) => (
                  <View key={lbl} style={styles.dayCell}>
                    <Text style={styles.dayVal}>{val}</Text>
                    <Text style={styles.dayLbl}>{lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        })}

        {/* Lead sources */}
        {sourceTotal > 0 && (
          <View style={styles.sourcesCard} wrap={false}>
            <Text style={styles.sourcesHd}>Lead Sources</Text>
            {sourceRows.map(r => {
              const pct = Math.round(r.value / sourceTotal * 100)
              return (
                <View key={r.label} style={styles.sourceRow}>
                  <View style={styles.sourceTop}>
                    <Text style={styles.sourceLbl}>{r.label}</Text>
                    <Text style={styles.sourceVal}>{r.value} ({pct}%)</Text>
                  </View>
                  <View style={styles.sourceBar}>
                    <View style={{ ...styles.sourceFill, width: `${pct}%`, backgroundColor: r.color }} />
                  </View>
                </View>
              )
            })}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>{brandLabel} · Buying Day Summary</Text>
          <Text style={styles.footerNote}>{event.store_name}</Text>
        </View>
      </Page>
    </Document>
  )
}
