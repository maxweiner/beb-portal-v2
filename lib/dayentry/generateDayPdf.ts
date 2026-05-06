// Server-side day-PDF builder. Loads the event + days + store + brand
// logo, renders the @react-pdf/renderer Document to a Buffer, returns it.
//
// Used by:
//   - GET /api/events/[id]/day-pdf/[day]   → preview iframe + manual download
//   - POST /api/events/[id]/day-email/[day] → email attachment
//
// Brand logo resolution mirrors lib/expenses/generatePdf.ts:
//   1. brand_logos table (per-brand upload from Settings)
//   2. /public/beb-wordmark.png (bundled fallback)

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DayPdf, type DayPdfData } from './dayPdf'

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

export async function generateDayPdfBuffer(opts: {
  sb: SupabaseClient
  eventId: string
  /** Pass null to render the full event recap (no through-day cap). */
  throughDay: number | null
}): Promise<{ ok: true; buffer: Buffer; filename: string; eventName: string; throughDay: number | null }
           | { ok: false; status: number; error: string }> {
  const { sb, eventId, throughDay } = opts

  const { data: ev, error: evErr } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, brand, workers, days:event_days(*)')
    .eq('id', eventId)
    .order('day_number', { referencedTable: 'event_days', ascending: true })
    .maybeSingle()

  if (evErr) return { ok: false, status: 500, error: evErr.message }
  if (!ev)   return { ok: false, status: 404, error: 'Event not found' }

  const { data: store } = await sb
    .from('stores')
    .select('name, city, state')
    .eq('id', ev.store_id)
    .maybeSingle()

  const brand = (ev as any).brand || 'beb'
  const brandLabel = BRAND_LABELS[brand] || 'Beneficial Estate Buyers'
  const logo = await loadBrandLogo(sb, brand)

  const data: DayPdfData = {
    event: {
      id: ev.id,
      store_name: ev.store_name,
      start_date: ev.start_date,
      workers: (ev as any).workers || null,
      brand,
    },
    store: store || null,
    days: ((ev as any).days || []).map((d: any) => ({
      day_number: d.day_number,
      customers: d.customers,
      purchases: d.purchases,
      dollars10: d.dollars10,
      dollars5: d.dollars5,
      src_vdp: d.src_vdp,
      src_postcard: d.src_postcard,
      src_social: d.src_social,
      src_wordofmouth: d.src_wordofmouth,
      src_repeat: d.src_repeat,
      src_store: d.src_store,
      src_text: d.src_text,
      src_newspaper: d.src_newspaper,
      src_other: d.src_other,
    })),
    throughDay,
    brandLabel,
    logo,
  }

  const buffer = await renderToBuffer(DayPdf(data) as any)
  const slug = (store?.name || ev.store_name || 'event')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const tag = throughDay ? `day-${throughDay}` : 'recap'
  const filename = `${slug}-${tag}.pdf`

  return {
    ok: true,
    buffer,
    filename,
    eventName: store?.name || ev.store_name,
    throughDay,
  }
}
