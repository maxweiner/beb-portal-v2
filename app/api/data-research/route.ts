// GET /api/data-research?store_id=…&event_id=…
//
// Returns the rows + page-level totals for the Data Research admin view.
//
// Conventions:
//   - QR codes are scoped to a store. We list every active QR for the
//     given store_id (or store_group_id that includes it).
//   - Campaign window for an event = (start_date - 28 days) .. end_date.
//     A scan counts for an event only when scanned_at falls in that
//     window. Appointments are linked by appointments.event_id +
//     appointments.qr_code_id directly, no window math needed.
//   - When event_id is omitted, we sum across every event for the store
//     (lifetime totals, scoped per-event so unattributed scans drop out).
//
// Auth: admin / superadmin only.

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const CAMPAIGN_WINDOW_DAYS = 28

interface QrRow {
  qr_code_id: string
  code: string
  type: string
  source: string | null
  label: string
  created_at: string
  total_sent: number
  scans: number
  unique_scans: number
  appointments: number
  conversion_pct: number | null  // appointments / total_sent
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const storeId = url.searchParams.get('store_id')
  const eventId = url.searchParams.get('event_id')  // optional
  if (!storeId) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })

  const sb = admin()

  // 1. Resolve the QR codes that "belong" to this store. Include both
  //    direct store QRs and group QRs whose group has this store.
  const [groupRes, qrRes] = await Promise.all([
    sb.from('store_group_members').select('store_group_id').eq('store_id', storeId),
    sb.from('qr_codes').select('id, code, type, lead_source, custom_label, label, created_at, store_id, store_group_id, deleted_at')
      .is('deleted_at', null)
      .eq('active', true),
  ])
  const groupIds = new Set((groupRes.data || []).map((r: any) => r.store_group_id))
  const qrs = (qrRes.data || []).filter((q: any) =>
    q.store_id === storeId || (q.store_group_id && groupIds.has(q.store_group_id))
  )
  if (qrs.length === 0) {
    return NextResponse.json({ rows: [], totals: { scans: 0, unique_scans: 0, appointments: 0, total_sent: 0, conversion_pct: null } })
  }
  const qrIds = qrs.map((q: any) => q.id)

  // 2. Resolve the events we care about for the campaign window. If the
  //    caller supplied event_id, just that one. Else every event for this
  //    store — we'll union their windows when counting scans.
  const eventQuery = sb.from('events')
    .select('id, store_id, start_date, days:event_days(day_number)')
    .eq('store_id', storeId)
  const { data: storeEvents } = eventId
    ? await eventQuery.eq('id', eventId)
    : await eventQuery
  const events = (storeEvents || []) as any[]

  // 3. Compute each event's campaign window and stash for counting.
  const windows = events.map(ev => {
    const startMs = new Date(ev.start_date + 'T00:00:00Z').getTime()
    const lastDayNumber = (ev.days || []).reduce((m: number, d: any) => Math.max(m, d.day_number || 1), 1)
    const endMs = startMs + (lastDayNumber - 1) * 86400000 + 86399000  // end of last day
    return {
      event_id: ev.id,
      windowStart: new Date(startMs - CAMPAIGN_WINDOW_DAYS * 86400000).toISOString(),
      windowEnd: new Date(endMs).toISOString(),
    }
  })
  if (windows.length === 0) {
    return NextResponse.json({ rows: [], totals: { scans: 0, unique_scans: 0, appointments: 0, total_sent: 0, conversion_pct: null } })
  }

  // 4. Pull scans for these QRs across the union of windows. We over-fetch
  //    a bit (any scan within the BROADEST window) and bucket per-window
  //    in code — this avoids N round-trips for many events.
  const minWinStart = windows.reduce((m, w) => w.windowStart < m ? w.windowStart : m, windows[0].windowStart)
  const maxWinEnd = windows.reduce((m, w) => w.windowEnd > m ? w.windowEnd : m, windows[0].windowEnd)
  const { data: scans } = await sb.from('qr_scans')
    .select('qr_code_id, scanned_at, ip_hash')
    .in('qr_code_id', qrIds)
    .gte('scanned_at', minWinStart)
    .lte('scanned_at', maxWinEnd)
  const scanRows = (scans || []) as any[]

  // 5. Pull appointments linked to these QRs for the chosen event(s).
  const apptQuery = sb.from('appointments').select('qr_code_id, event_id').in('qr_code_id', qrIds)
  const { data: appts } = eventId
    ? await apptQuery.eq('event_id', eventId)
    : await apptQuery.in('event_id', events.map(e => e.id))
  const apptRows = (appts || []) as any[]

  // 6. Pull total_sent per (qr, event). Two .in() calls compose with AND
  //    in supabase-js, which is exactly what we want.
  const { data: sends } = await sb.from('qr_campaign_sends')
    .select('qr_code_id, event_id, total_sent')
    .in('event_id', events.map(e => e.id))
    .in('qr_code_id', qrIds)
  const sendsRows = (sends || []) as any[]

  // 7. Aggregate per QR.
  const rows: QrRow[] = qrs.map((q: any) => {
    // Determine which scans count: any scan within ANY of the relevant
    // event windows. (When event_id is provided, windows has length 1.)
    let scanCount = 0
    const seenIps = new Set<string>()
    for (const s of scanRows) {
      if (s.qr_code_id !== q.id) continue
      const t = s.scanned_at
      const fits = windows.some(w => t >= w.windowStart && t <= w.windowEnd)
      if (!fits) continue
      scanCount++
      if (s.ip_hash) seenIps.add(s.ip_hash)
    }
    const apptCount = apptRows.filter(a => a.qr_code_id === q.id).length
    const totalSent = sendsRows
      .filter(r => r.qr_code_id === q.id)
      .reduce((sum, r) => sum + (r.total_sent || 0), 0)
    const conversion = totalSent > 0 ? (apptCount / totalSent) * 100 : null

    return {
      qr_code_id: q.id,
      code: q.code,
      type: q.type,
      source: q.lead_source || q.custom_label || null,
      label: q.label,
      created_at: q.created_at,
      total_sent: totalSent,
      scans: scanCount,
      unique_scans: seenIps.size,
      appointments: apptCount,
      conversion_pct: conversion,
    }
  })

  // 8. Page-level totals.
  const totalScans = rows.reduce((s, r) => s + r.scans, 0)
  const totalUnique = rows.reduce((s, r) => s + r.unique_scans, 0)  // approx: sum of per-QR uniques
  const totalAppts = rows.reduce((s, r) => s + r.appointments, 0)
  const totalSent = rows.reduce((s, r) => s + r.total_sent, 0)
  const overallConv = totalSent > 0 ? (totalAppts / totalSent) * 100 : null

  return NextResponse.json({
    rows,
    totals: {
      scans: totalScans,
      unique_scans: totalUnique,
      appointments: totalAppts,
      total_sent: totalSent,
      conversion_pct: overallConv,
    },
    window_days: CAMPAIGN_WINDOW_DAYS,
  })
}
