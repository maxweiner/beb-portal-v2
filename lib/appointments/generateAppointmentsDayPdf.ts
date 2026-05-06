// Server-side: builds the daily-appointments PDF for one store + date.
// Loads store + appointments + scheduler names + brand logo, renders
// the @react-pdf/renderer document, returns a Buffer.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppointmentsDayPdf, type AppointmentsDayPdfData, type AppointmentsDayPdfRow } from './appointmentsDayPdf'
import { parseIcal, parseApptDetail } from '@/lib/calendar'

const LOGO_PATH = path.join(process.cwd(), 'public', 'beb-wordmark.png')
let bundledLogoBuf: Buffer | null = null
async function loadBundledLogo(): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  if (bundledLogoBuf) return { data: bundledLogoBuf, format: 'png' }
  try {
    bundledLogoBuf = await readFile(LOGO_PATH)
    return { data: bundledLogoBuf, format: 'png' }
  } catch { return null }
}

function detectImageFormat(buf: Buffer): 'png' | 'jpg' {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg'
  return 'png'
}

async function loadBrandLogo(
  sb: SupabaseClient, brand: string | null,
): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  if (!brand) return loadBundledLogo()
  const { data } = await sb.from('brand_logos').select('logo_path').eq('brand', brand).maybeSingle()
  const logoPath = (data as any)?.logo_path
  if (!logoPath) return loadBundledLogo()
  const { data: file, error } = await sb.storage.from('brand-logos').download(logoPath)
  if (error || !file) return loadBundledLogo()
  const buf = Buffer.from(await file.arrayBuffer())
  return { data: buf, format: detectImageFormat(buf) }
}

const BRAND_LABELS: Record<string, string> = {
  beb: 'Beneficial Estate Buyers',
  liberty: 'Liberty Estate Buyers',
}

export async function generateAppointmentsDayPdfBuffer(opts: {
  sb: SupabaseClient
  storeId: string
  /** One or many YYYY-MM-DD dates. One = single-day mode; many = multi-day
   *  mode (the PDF table adds a Date column). Order doesn't matter — the
   *  PDF sorts before rendering. */
  dates: string[]
  /** When false, cancelled rows are filtered out before render. The
   *  email button defaults to true so the store can see what fell off. */
  includeCancelled?: boolean
}): Promise<{ ok: true; buffer: Buffer; filename: string; storeName: string; dates: string[]; rowCount: number }
           | { ok: false; status: number; error: string }> {
  const { sb, storeId, dates } = opts
  const includeCancelled = opts.includeCancelled !== false
  if (!dates || dates.length === 0) {
    return { ok: false, status: 400, error: 'No dates provided' }
  }

  const { data: store, error: storeErr } = await sb
    .from('stores')
    .select('id, name, city, state, calendar_feed_url, calendar_offset_hours')
    .eq('id', storeId)
    .maybeSingle()
  if (storeErr) return { ok: false, status: 500, error: storeErr.message }
  if (!store)   return { ok: false, status: 404, error: 'Store not found' }

  // Fetch appointments for that store across all requested dates. The
  // `appointment_employee` FK now points at store_employees per the
  // unify-employees migration.
  const { data: appts, error: apptErr } = await sb
    .from('appointments')
    .select(`
      id, appointment_date, appointment_time,
      customer_name, customer_phone, customer_email,
      items_bringing, how_heard, notes, status,
      booked_by, is_walkin, brand,
      appointment_employee:store_employees(name)
    `)
    .eq('store_id', storeId)
    .in('appointment_date', dates)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })
  if (apptErr) return { ok: false, status: 500, error: apptErr.message }

  // Determine brand for logo: pick the most-common brand on the day's
  // appointments; fall back to 'beb' when there are none.
  const brandCounts: Record<string, number> = {}
  for (const a of (appts || [])) {
    const b = (a as any).brand || 'beb'
    brandCounts[b] = (brandCounts[b] || 0) + 1
  }
  const brand = Object.keys(brandCounts).sort((a, b) => brandCounts[b] - brandCounts[a])[0] || 'beb'
  const brandLabel = BRAND_LABELS[brand] || BRAND_LABELS.beb
  const logo = await loadBrandLogo(sb, brand)

  const portalRows: AppointmentsDayPdfRow[] = (appts || [])
    .filter((a: any) => includeCancelled || a.status !== 'cancelled')
    .map((a: any) => ({
      appointment_date: a.appointment_date,
      appointment_time: a.appointment_time,
      customer_name: a.customer_name,
      customer_phone: a.customer_phone,
      customer_email: a.customer_email,
      items_bringing: Array.isArray(a.items_bringing) ? a.items_bringing : null,
      how_heard: a.how_heard,
      scheduler_name: a.appointment_employee?.name || null,
      notes: a.notes,
      is_walkin: !!a.is_walkin,
      status: a.status || 'confirmed',
    }))

  // Merge in iCal-fed (Google Calendar / SimplyBook) appointments for the
  // same store across ALL requested dates. Mirrors AppointmentsAdmin's
  // fetchGcalAppts client path but runs server-side. Failure is
  // non-fatal — portal rows still render.
  const gcalRows = await loadGcalRowsForDates({
    storeFeedUrl: (store as any).calendar_feed_url || null,
    offsetHours: (store as any).calendar_offset_hours || 0,
    dates,
  })

  const rows: AppointmentsDayPdfRow[] = [...portalRows, ...gcalRows]

  const sortedDates = [...dates].sort()
  const data: AppointmentsDayPdfData = {
    store: { name: store.name, city: store.city, state: store.state },
    dates: sortedDates,
    rows,
    brandLabel,
    logo,
  }

  const buffer = await renderToBuffer(AppointmentsDayPdf(data) as any)
  const slug = (store.name || 'store')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const dateTag = sortedDates.length === 1
    ? sortedDates[0]
    : `${sortedDates[0]}_to_${sortedDates[sortedDates.length - 1]}`
  const filename = `${slug}-appointments-${dateTag}.pdf`

  return { ok: true, buffer, filename, storeName: store.name, dates: sortedDates, rowCount: rows.length }
}

// Allowlist mirrors /api/fetch-ical so we don't blindly hit arbitrary
// URLs from a stores.calendar_feed_url value.
const ALLOWED_ICAL_HOSTS = ['calendar.google.com', 'simplybook.me', 'simplybook.it']

async function loadGcalRowsForDates(opts: {
  storeFeedUrl: string | null
  offsetHours: number
  dates: string[]               // YYYY-MM-DD list
}): Promise<AppointmentsDayPdfRow[]> {
  const { storeFeedUrl, offsetHours, dates } = opts
  if (!storeFeedUrl || dates.length === 0) return []

  let url = storeFeedUrl
  if (url.includes('%40')) url = decodeURIComponent(url)
  if (!ALLOWED_ICAL_HOSTS.some(h => url.includes(h))) return []

  let text: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BeneficialOS-BuyerPortal/2.0', 'Accept': 'text/calendar, */*' },
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    text = await res.text()
    if (!text.includes('BEGIN:VCALENDAR')) return []
  } catch {
    return []
  }

  const offsetMs = (offsetHours || 0) * 60 * 60 * 1000
  const dateSet = new Set(dates)
  const out: AppointmentsDayPdfRow[] = []
  for (const a of parseIcal(text)) {
    const adj = offsetMs === 0 ? a : { ...a, start: new Date(a.start.getTime() + offsetMs), end: new Date(a.end.getTime() + offsetMs) }
    const ymd = `${adj.start.getUTCFullYear()}-${String(adj.start.getUTCMonth() + 1).padStart(2, '0')}-${String(adj.start.getUTCDate()).padStart(2, '0')}`
    if (!dateSet.has(ymd)) continue
    const time = `${String(adj.start.getUTCHours()).padStart(2, '0')}:${String(adj.start.getUTCMinutes()).padStart(2, '0')}:00`
    const detail = parseApptDetail(adj)
    out.push({
      appointment_date: ymd,
      appointment_time: time,
      customer_name: detail.name || adj.title || '(no name)',
      customer_phone: detail.phone || null,
      customer_email: detail.email || null,
      items_bringing: detail.items ? [detail.items] : null,
      how_heard: detail.howHeard || null,
      // iCal feed has no scheduler-name field. Mark "Google Calendar" so
      // the row is distinguishable from portal rows in the printed PDF.
      scheduler_name: 'Google Calendar',
      notes: null,
      is_walkin: false,
      status: 'confirmed',
    })
  }
  return out
}
