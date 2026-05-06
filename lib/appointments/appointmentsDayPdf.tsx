// React-PDF document for one store's appointments on a single date.
// Sent to the store + buyers each morning so everyone has the day's
// schedule in front of them.
//
// Columns (per request): Date · Time · Client name · Client phone ·
//   What items · How heard · Schedulers (store rep)
//
// Layout: landscape Letter so the columns fit comfortably without
// wrapping. Helvetica only — no font fetch on cold start.

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
  page:       { padding: 32, fontSize: 9.5, fontFamily: 'Helvetica', color: COLORS.ink, backgroundColor: COLORS.white },

  hRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  logoLg:     { width: 180, height: 56, objectFit: 'contain', objectPosition: 'left center' },
  brandText:  { fontSize: 13, fontWeight: 700, color: COLORS.greenDark, letterSpacing: 1 },
  hMeta:      { fontSize: 9, color: COLORS.mist, textAlign: 'right' },
  hMetaBold:  { fontSize: 11, color: COLORS.greenDark, fontWeight: 700, textAlign: 'right', marginTop: 2 },

  storeName:  { fontSize: 18, fontWeight: 700, color: COLORS.ink, marginBottom: 2 },
  storeMeta:  { fontSize: 10, color: COLORS.ash, marginBottom: 14 },

  countsRow:  { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill:       { fontSize: 9, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  pillGreen:  { backgroundColor: COLORS.greenPale, color: COLORS.greenDark },
  pillAmber:  { backgroundColor: '#FEF3C7', color: '#92400E' },
  pillRed:    { backgroundColor: '#fee2e2', color: '#991b1b' },

  // Column widths (sum to 100). Tweaked so phone fits on one line and
  // items/how-heard get the most slack since they're the wrapping ones.
  cellTime:   { width: '8%' },
  cellName:   { width: '14%' },
  cellPhone:  { width: '12%' },
  cellItems:  { width: '28%' },
  cellHeard:  { width: '14%' },
  cellSched:  { width: '14%' },
  cellNotes:  { width: '10%' },

  thRow:      { flexDirection: 'row', backgroundColor: COLORS.cream2, paddingVertical: 6, paddingHorizontal: 4, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  th:         { fontSize: 8, fontWeight: 700, color: COLORS.ash, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4 },

  tdRow:      { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: COLORS.pearl, alignItems: 'flex-start' },
  tdRowAlt:   { backgroundColor: '#FBF8F2' },
  tdRowCancelled: { opacity: 0.5 },
  td:         { fontSize: 9.5, color: COLORS.ink, paddingHorizontal: 4 },
  tdMuted:    { fontSize: 9, color: COLORS.mist },
  tdBold:     { fontSize: 9.5, fontWeight: 700 },

  walkinTag:  { fontSize: 7, fontWeight: 700, paddingVertical: 1, paddingHorizontal: 4, borderRadius: 4, backgroundColor: '#FEF3C7', color: '#92400E', marginLeft: 4 },
  cancelTag:  { fontSize: 7, fontWeight: 700, paddingVertical: 1, paddingHorizontal: 4, borderRadius: 4, backgroundColor: '#fee2e2', color: '#991b1b', marginLeft: 4 },

  empty:      { padding: 30, textAlign: 'center', color: COLORS.mist, fontStyle: 'italic', fontSize: 11 },

  footer:     { position: 'absolute', bottom: 18, left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: COLORS.pearl, paddingTop: 6 },
  footerNote: { fontSize: 8, color: COLORS.mist },
})

export interface AppointmentsDayPdfRow {
  appointment_date: string             // YYYY-MM-DD
  appointment_time: string             // HH:MM:SS
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
  date: string                         // YYYY-MM-DD
  rows: AppointmentsDayPdfRow[]
  brandLabel: string
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
}

const fmtDateLong = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
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
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return p
}

export function AppointmentsDayPdf({ store, date, rows, brandLabel, logo }: AppointmentsDayPdfData) {
  const sorted = [...rows].sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
  const confirmed = sorted.filter(r => r.status !== 'cancelled')
  const walkins   = sorted.filter(r => r.is_walkin && r.status !== 'cancelled')
  const cancels   = sorted.filter(r => r.status === 'cancelled')

  const storeMeta = store
    ? [store.city, store.state].filter(Boolean).join(', ')
    : ''

  return (
    <Document title={`${store?.name || 'Appointments'} — ${date}`}>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.hRow}>
          <View>
            {logo
              ? <Image style={styles.logoLg} src={{ data: logo.data, format: logo.format }} />
              : <Text style={styles.brandText}>{brandLabel.toUpperCase()}</Text>}
          </View>
          <View>
            <Text style={styles.hMeta}>Appointments for</Text>
            <Text style={styles.hMetaBold}>{fmtDateLong(date)}</Text>
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
        </View>

        {sorted.length === 0 ? (
          <Text style={styles.empty}>No appointments scheduled for this day.</Text>
        ) : (
          <View>
            <View style={styles.thRow} fixed>
              <Text style={{ ...styles.th, ...styles.cellTime }}>Time</Text>
              <Text style={{ ...styles.th, ...styles.cellName }}>Client name</Text>
              <Text style={{ ...styles.th, ...styles.cellPhone }}>Client phone</Text>
              <Text style={{ ...styles.th, ...styles.cellItems }}>Items bringing</Text>
              <Text style={{ ...styles.th, ...styles.cellHeard }}>How they heard</Text>
              <Text style={{ ...styles.th, ...styles.cellSched }}>Scheduler</Text>
              <Text style={{ ...styles.th, ...styles.cellNotes }}>Notes</Text>
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
                  <Text style={{ ...styles.td, ...styles.tdBold, ...styles.cellTime }}>
                    {fmtTime(r.appointment_time)}
                  </Text>
                  <View style={styles.cellName}>
                    <Text style={styles.td}>
                      {r.customer_name || '(no name)'}
                      {r.is_walkin && !isCancelled ? ' ' : ''}
                    </Text>
                    {(r.is_walkin || isCancelled) && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
                        {r.is_walkin && <Text style={styles.walkinTag}>WALK-IN</Text>}
                        {isCancelled && <Text style={styles.cancelTag}>CANCELLED</Text>}
                      </View>
                    )}
                  </View>
                  <Text style={{ ...styles.td, ...styles.cellPhone }}>{fmtPhone(r.customer_phone) || '—'}</Text>
                  <Text style={{ ...styles.td, ...styles.cellItems }}>{items}</Text>
                  <Text style={{ ...styles.td, ...styles.cellHeard }}>{r.how_heard || '—'}</Text>
                  <Text style={{ ...styles.td, ...styles.cellSched }}>{r.scheduler_name || '—'}</Text>
                  <Text style={{ ...styles.td, ...styles.tdMuted, ...styles.cellNotes }}>{r.notes || ''}</Text>
                </View>
              )
            })}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>{brandLabel} · Daily appointments</Text>
          <Text style={styles.footerNote}>{store?.name || ''} · {fmtDateLong(date)}</Text>
        </View>
      </Page>
    </Document>
  )
}
