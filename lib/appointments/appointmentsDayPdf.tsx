// React-PDF document for one store's appointments. Renders one or
// many dates in a single portrait-orientation table.
//
// Columns: Date (only when rows span >1 date) · Time · Client name ·
//   Client phone · Items bringing · How heard · Scheduler.
// Notes column dropped — the row count + portrait width matters more
// than the rare note text. Walk-ins still get a yellow tag inline
// next to the client name.

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
  red:       '#B22234',
  white:     '#FFFFFF',
}

const styles = StyleSheet.create({
  page:       { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 36, fontSize: 8.5, fontFamily: 'Helvetica', color: COLORS.ink, backgroundColor: COLORS.white },

  hRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  logoLg:     { width: 150, height: 48, objectFit: 'contain', objectPosition: 'left center' },
  brandText:  { fontSize: 12, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 },
  hMeta:      { fontSize: 8, color: COLORS.mist, textAlign: 'right' },
  hMetaBold:  { fontSize: 9.5, color: COLORS.greenDark, fontWeight: 700, textAlign: 'right', marginTop: 2 },

  storeName:  { fontSize: 16, fontWeight: 700, color: COLORS.ink, marginBottom: 1 },
  storeMeta:  { fontSize: 9, color: COLORS.ash, marginBottom: 8 },

  countsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  pill:       { fontSize: 8, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  pillGreen:  { backgroundColor: COLORS.greenPale, color: COLORS.greenDark },
  pillAmber:  { backgroundColor: '#FEF3C7', color: '#92400E' },
  pillRed:    { backgroundColor: '#fee2e2', color: '#991b1b' },

  thRow:      { flexDirection: 'row', backgroundColor: COLORS.cream2, paddingVertical: 5, paddingHorizontal: 3 },
  th:         { fontSize: 7.5, fontWeight: 700, color: COLORS.ash, textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 3 },

  tdRow:      { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: COLORS.pearl, alignItems: 'flex-start' },
  tdRowAlt:   { backgroundColor: '#FBF8F2' },
  tdRowCancelled: { opacity: 0.5 },
  td:         { fontSize: 8.5, color: COLORS.ink, paddingHorizontal: 3 },
  tdMuted:    { fontSize: 8, color: COLORS.mist },
  tdBold:     { fontSize: 8.5, fontWeight: 700 },

  walkinTag:  { fontSize: 6.5, fontWeight: 700, paddingVertical: 1, paddingHorizontal: 3, borderRadius: 3, backgroundColor: '#FEF3C7', color: '#92400E', marginLeft: 3 },
  cancelTag:  { fontSize: 6.5, fontWeight: 700, paddingVertical: 1, paddingHorizontal: 3, borderRadius: 3, backgroundColor: '#fee2e2', color: '#991b1b', marginLeft: 3 },

  empty:      { padding: 24, textAlign: 'center', color: COLORS.mist, fontStyle: 'italic', fontSize: 10 },

  footer:     { position: 'absolute', bottom: 14, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: COLORS.pearl, paddingTop: 5 },
  footerNote: { fontSize: 7, color: COLORS.mist },
})

// Portrait Letter is 612pt wide. With 28pt margins each side we have
// 556pt usable. Two column-width regimes — single-day (no Date col)
// and multi-day (Date col added; other widths trim to make room).
const COLS_SINGLE = {
  time:   '10%',
  name:   '20%',
  phone:  '15%',
  items:  '25%',
  heard:  '15%',
  sched:  '15%',
}
const COLS_MULTI = {
  date:   '11%',
  time:   '8%',
  name:   '18%',
  phone:  '14%',
  items:  '22%',
  heard:  '14%',
  sched:  '13%',
}

export interface AppointmentsDayPdfRow {
  appointment_date: string
  appointment_time: string
  customer_name: string | null
  customer_phone: string | null
  customer_email?: string | null
  items_bringing: string[] | null
  how_heard: string | null
  scheduler_name: string | null
  notes: string | null
  is_walkin: boolean
  status: string
}

export interface AppointmentsDayPdfData {
  store: { name: string; city: string | null; state: string | null } | null
  /** YYYY-MM-DD strings the PDF covers. One = single-day mode (no Date
   *  column, header reads "Mon, May 4"). Many = multi-day mode (Date
   *  column added, header reads "Mon, May 4 – Wed, May 6"). */
  dates: string[]
  rows: AppointmentsDayPdfRow[]
  brandLabel: string
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
}

const fmtDateLong = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
const fmtDateShort = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

function fmtTime(t: string): string {
  const [hh, mm] = t.split(':').map(n => parseInt(n, 10))
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t
  const period = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : (hh > 12 ? hh - 12 : hh)
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`
}

function fmtPhone(p: string | null | undefined): string {
  if (!p) return ''
  const digits = p.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return p
}

export function AppointmentsDayPdf({ store, dates, rows, brandLabel, logo }: AppointmentsDayPdfData) {
  const sortedDates = [...dates].sort()
  const sorted = [...rows].sort((a, b) => {
    if (a.appointment_date !== b.appointment_date) {
      return a.appointment_date.localeCompare(b.appointment_date)
    }
    return a.appointment_time.localeCompare(b.appointment_time)
  })

  const isMultiDay = sortedDates.length > 1
  const cols = isMultiDay ? COLS_MULTI : COLS_SINGLE

  const confirmed = sorted.filter(r => r.status !== 'cancelled')
  const walkins   = sorted.filter(r => r.is_walkin && r.status !== 'cancelled')
  const cancels   = sorted.filter(r => r.status === 'cancelled')

  const storeMeta = store ? [store.city, store.state].filter(Boolean).join(', ') : ''
  const headerDate = isMultiDay
    ? `${fmtDateShort(sortedDates[0])} – ${fmtDateShort(sortedDates[sortedDates.length - 1])}`
    : fmtDateLong(sortedDates[0])

  return (
    <Document title={`${store?.name || 'Appointments'} — ${headerDate}`}>
      <Page size="LETTER" orientation="portrait" style={styles.page}>
        <View style={styles.hRow}>
          <View>
            {logo
              ? <Image style={styles.logoLg} src={{ data: logo.data, format: logo.format }} />
              : <Text style={styles.brandText}>{brandLabel.toUpperCase()}</Text>}
          </View>
          <View>
            <Text style={styles.hMeta}>Appointments for</Text>
            <Text style={styles.hMetaBold}>{headerDate}</Text>
          </View>
        </View>

        <Text style={styles.storeName}>{store?.name || '(unknown store)'}</Text>
        {storeMeta ? <Text style={styles.storeMeta}>{storeMeta}</Text> : null}

        <View style={styles.countsRow}>
          <Text style={{ ...styles.pill, ...styles.pillGreen }}>
            {confirmed.length} {confirmed.length === 1 ? 'appointment' : 'appointments'}
          </Text>
          {walkins.length > 0 && (
            <Text style={{ ...styles.pill, ...styles.pillAmber }}>{walkins.length} walk-in</Text>
          )}
          {cancels.length > 0 && (
            <Text style={{ ...styles.pill, ...styles.pillRed }}>{cancels.length} cancelled</Text>
          )}
          {isMultiDay && (
            <Text style={{ ...styles.pill, backgroundColor: COLORS.cream2, color: COLORS.ash }}>
              {sortedDates.length}-day event
            </Text>
          )}
        </View>

        {sorted.length === 0 ? (
          <Text style={styles.empty}>No appointments scheduled.</Text>
        ) : (
          <View>
            <View style={styles.thRow} fixed>
              {isMultiDay && <Text style={{ ...styles.th, width: (cols as any).date }}>Date</Text>}
              <Text style={{ ...styles.th, width: cols.time }}>Time</Text>
              <Text style={{ ...styles.th, width: cols.name }}>Client name</Text>
              <Text style={{ ...styles.th, width: cols.phone }}>Phone</Text>
              <Text style={{ ...styles.th, width: cols.items }}>Items bringing</Text>
              <Text style={{ ...styles.th, width: cols.heard }}>How heard</Text>
              <Text style={{ ...styles.th, width: cols.sched }}>Scheduler</Text>
            </View>

            {sorted.map((r, i) => {
              const items = (r.items_bringing || []).filter(Boolean).join(', ') || '—'
              const isCancelled = r.status === 'cancelled'
              const rowStyle = {
                ...styles.tdRow,
                ...(i % 2 === 1 ? styles.tdRowAlt : {}),
                ...(isCancelled ? styles.tdRowCancelled : {}),
              }
              return (
                <View key={i} style={rowStyle} wrap={false}>
                  {isMultiDay && (
                    <Text style={{ ...styles.td, ...styles.tdBold, width: (cols as any).date }}>
                      {fmtDateShort(r.appointment_date)}
                    </Text>
                  )}
                  <Text style={{ ...styles.td, ...styles.tdBold, width: cols.time }}>
                    {fmtTime(r.appointment_time)}
                  </Text>
                  <View style={{ width: cols.name }}>
                    <Text style={styles.td}>
                      {r.customer_name || '(no name)'}
                    </Text>
                    {(r.is_walkin || isCancelled) && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
                        {r.is_walkin && <Text style={styles.walkinTag}>WALK-IN</Text>}
                        {isCancelled && <Text style={styles.cancelTag}>CANCELLED</Text>}
                      </View>
                    )}
                  </View>
                  <Text style={{ ...styles.td, width: cols.phone }}>{fmtPhone(r.customer_phone) || '—'}</Text>
                  <Text style={{ ...styles.td, width: cols.items }}>{items}</Text>
                  <Text style={{ ...styles.td, width: cols.heard }}>{r.how_heard || '—'}</Text>
                  <Text style={{ ...styles.td, width: cols.sched }}>{r.scheduler_name || '—'}</Text>
                </View>
              )
            })}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>{brandLabel} · Daily appointments</Text>
          <Text style={styles.footerNote} render={({ pageNumber, totalPages }) => `${store?.name || ''} · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
