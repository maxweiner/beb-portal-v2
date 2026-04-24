import type { Appointment, LeadSource } from '@/types'

// State -> IANA timezone
export const STATE_TZ: Record<string, string> = {
  AL:'America/Chicago',    AK:'America/Anchorage',  AZ:'America/Phoenix',
  AR:'America/Chicago',    CA:'America/Los_Angeles', CO:'America/Denver',
  CT:'America/New_York',   DE:'America/New_York',    FL:'America/New_York',
  GA:'America/New_York',   HI:'Pacific/Honolulu',   ID:'America/Denver',
  IL:'America/Chicago',    IN:'America/Indiana/Indianapolis', IA:'America/Chicago',
  KS:'America/Chicago',    KY:'America/New_York',    LA:'America/Chicago',
  ME:'America/New_York',   MD:'America/New_York',    MA:'America/New_York',
  MI:'America/Detroit',    MN:'America/Chicago',     MS:'America/Chicago',
  MO:'America/Chicago',    MT:'America/Denver',      NE:'America/Chicago',
  NV:'America/Los_Angeles',NH:'America/New_York',    NJ:'America/New_York',
  NM:'America/Denver',     NY:'America/New_York',    NC:'America/New_York',
  ND:'America/Chicago',    OH:'America/New_York',    OK:'America/Chicago',
  OR:'America/Los_Angeles',PA:'America/New_York',    RI:'America/New_York',
  SC:'America/New_York',   SD:'America/Chicago',     TN:'America/Chicago',
  TX:'America/Chicago',    UT:'America/Denver',      VT:'America/New_York',
  VA:'America/New_York',   WA:'America/Los_Angeles', WV:'America/New_York',
  WI:'America/Chicago',    WY:'America/Denver',      DC:'America/New_York',
}

// Get date string (YYYY-MM-DD) — times are stored as raw UTC, no tz conversion needed
export function dateInTz(date: Date, _tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date)
}

// Get hour and minute — times are stored as raw UTC, no tz conversion needed
export function hmInTz(date: Date, _tz: string): { h: number; m: number } {
  return { h: date.getUTCHours(), m: date.getUTCMinutes() }
}

// Format a time for display — times are stored as raw UTC, no tz conversion needed
export function timeInTz(date: Date, _tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true
  }).format(date)
}

// Parse iCal text -> Appointment[]
// Handles both UTC (Z suffix) and TZID= local times from Google Calendar and SimplyBook
export function parseIcal(text: string): Appointment[] {
  const events: Appointment[] = []
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n')

  // Extract calendar-level timezone for converting UTC times to local
  const calTzMatch = unfolded.match(/X-WR-TIMEZONE:([^\n]+)/)
  const calTz = calTzMatch ? calTzMatch[1].trim() : null

  const blocks = unfolded.split('BEGIN:VEVENT').slice(1)

  for (const block of blocks) {
    // Get raw property line including any ;TZID= params
    const getRaw = (key: string) => {
      const m = block.match(new RegExp(`(?:^|\\n)(${key}[^:]*):([^\\n]+)`, 'm'))
      return m ? { params: m[1], value: m[2].trim() } : null
    }

    const toDate = (raw: { params: string; value: string } | null): Date | null => {
      if (!raw) return null
      const s = raw.value.trim()

      // All-day: YYYYMMDD
      if (s.length === 8) {
        return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T12:00:00Z`)
      }

      const y = s.slice(0,4), mo = s.slice(4,6), d = s.slice(6,8)
      const h = s.slice(9,11), m2 = s.slice(11,13), sec = s.slice(13,15) || '00'

      // UTC time (Z suffix) — convert to calendar's local time for display
      if (s.endsWith('Z')) {
        const utcDate = new Date(`${y}-${mo}-${d}T${h}:${m2}:${sec}Z`)
        if (calTz) {
          // Format this UTC time in the calendar's timezone to get local h:m
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: calTz, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
          }).formatToParts(utcDate)
          const g = (t: string) => parts.find(p => p.type === t)?.value || '00'
          // Store local time as fake UTC so display functions show it directly
          return new Date(`${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}Z`)
        }
        return utcDate
      }

      // TZID or floating time — the raw value IS local time at the store.
      // Store as UTC so display functions (which now use UTC) show the raw time.
      return new Date(`${y}-${mo}-${d}T${h}:${m2}:${sec}Z`)
    }

    const dtstart = getRaw('DTSTART')
    if (!dtstart) continue
    const start = toDate(dtstart)
    if (!start) continue

    const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';')
    const getSummary = getRaw('SUMMARY')
    const getDesc = getRaw('DESCRIPTION')
    const getLoc = getRaw('LOCATION')

    events.push({
      start,
      end: toDate(getRaw('DTEND')) || start,
      title: unescape(getSummary?.value || ''),
      description: unescape(getDesc?.value || ''),
      location: unescape(getLoc?.value || ''),
    })
  }

  return events
}

// Detect lead source from appointment
export function detectSource(appt: Appointment): LeadSource {
  const hay = ((appt.title || '') + ' ' + (appt.description || '')).toLowerCase()
  const how = hay.match(/how did you find out[^?]*\?[:\s]*([^\n<]+)/i)?.[1]?.toLowerCase() || hay

  if (/large post|vdp|vehicle|digital/i.test(how))              return 'vdp'
  if (/small post|store post|postcard/i.test(how))              return 'small'
  if (/social|facebook|instagram|tiktok/i.test(how))           return 'social'
  if (/return|repeat|came before|previous|been before/i.test(how)) return 'repeat'
  if (/word|friend|referral|told|family|neighbor/i.test(how))   return 'wom'
  return 'unknown'
}

export const SOURCE_COLORS: Record<LeadSource, { bg: string; border: string; text: string; label: string }> = {
  vdp:     { bg: '#D1FAE5', border: '#059669', text: '#065F46', label: 'VDP / Large Postcard' },
  small:   { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF', label: 'Small Postcard' },
  wom:     { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', label: 'Word of Mouth' },
  repeat:  { bg: '#FFE4E6', border: '#F43F5E', text: '#9F1239', label: 'Return Customer' },
  social:  { bg: '#EDE9FE', border: '#8B5CF6', text: '#5B21B6', label: 'Social Media' },
  unknown: { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151', label: 'Other' },
}

// Slots covering one day, every `intervalMin` minutes from `startHour` to `endHour`
// (exclusive of endHour). Default range 10am–6pm at 20-min intervals matches the
// historical behaviour for stores without a booking_config.
export interface Slot {
  h: number
  m: number
  hourIdx: number  // index of the hour band (0 = first hour shown)
  slotIdx: number  // index within the hour (0, 1, 2 for 20-min intervals)
}

export function generateSlots(opts?: {
  startHour?: number
  endHour?: number
  intervalMin?: number
}): Slot[] {
  const startHour = opts?.startHour ?? 10
  const endHour   = opts?.endHour   ?? 18
  const interval  = opts?.intervalMin ?? 20
  const slotsPerHour = Math.max(1, Math.floor(60 / interval))
  const slots: Slot[] = []
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += interval) {
      slots.push({ h, m, hourIdx: h - startHour, slotIdx: Math.floor(m / interval) })
    }
  }
  return slots
}

// Parse 'HH:MM' or 'HH:MM:SS' → { h, m }, or null on bad input.
export function parseHourMinute(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(mm)) return null
  return { h, m: mm }
}

export function formatSlotTime(h: number, m: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Get event day date string in local (non-tz-shifted) format
export function getEventDayDate(startDate: string, dayNum: number): string {
  const d = new Date(startDate + 'T12:00:00')
  d.setDate(d.getDate() + dayNum - 1)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dy}`
}

export function friendlyDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
}

// Parse appointment detail fields from description
export function parseApptDetail(appt: Appointment) {
  const desc = appt.description || ''
  const field = (label: string) =>
    desc.match(new RegExp(label + '[^:]*:\\s*([^\\n<]+)', 'i'))?.[1]?.trim() || ''

  const clientRaw = field('Client')
  const phone = clientRaw.match(/\+?[\d\s\-\(\)]{10,}/)?.[0]?.trim() || ''
  const email = clientRaw.match(/[\w.\-+]+@[\w.\-]+\.\w+/)?.[0] || ''
  const items = field('What Items') || field('items') || ''
  const howHeard = field('How did you find out') || field('How did you hear') || ''
  const name = appt.title.split(' - ')[0] || appt.title

  return { name, phone, email, items, howHeard }
}
