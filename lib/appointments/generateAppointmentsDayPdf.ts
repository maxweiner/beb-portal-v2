// Server-side: builds the daily-appointments PDF for one store + date.
// Loads store + appointments + scheduler names + brand logo, renders
// the @react-pdf/renderer document, returns a Buffer.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppointmentsDayPdf, type AppointmentsDayPdfData, type AppointmentsDayPdfRow } from './appointmentsDayPdf'

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
  date: string                 // YYYY-MM-DD
  /** When false, cancelled rows are filtered out before render. The
   *  email button defaults to true so the store can see what fell off. */
  includeCancelled?: boolean
}): Promise<{ ok: true; buffer: Buffer; filename: string; storeName: string; date: string; rowCount: number }
           | { ok: false; status: number; error: string }> {
  const { sb, storeId, date } = opts
  const includeCancelled = opts.includeCancelled !== false

  const { data: store, error: storeErr } = await sb
    .from('stores')
    .select('id, name, city, state')
    .eq('id', storeId)
    .maybeSingle()
  if (storeErr) return { ok: false, status: 500, error: storeErr.message }
  if (!store)   return { ok: false, status: 404, error: 'Store not found' }

  // Fetch appointments for that store on that date. The `appointment_employee`
  // FK now points at store_employees per the unify-employees migration.
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
    .eq('appointment_date', date)
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

  const rows: AppointmentsDayPdfRow[] = (appts || [])
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

  const data: AppointmentsDayPdfData = {
    store: { name: store.name, city: store.city, state: store.state },
    date,
    rows,
    brandLabel,
    logo,
  }

  const buffer = await renderToBuffer(AppointmentsDayPdf(data) as any)
  const slug = (store.name || 'store')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const filename = `${slug}-appointments-${date}.pdf`

  return { ok: true, buffer, filename, storeName: store.name, date, rowCount: rows.length }
}
