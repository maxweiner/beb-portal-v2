import { createClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { QRCodeSVG } from 'qrcode.react'
import EventShareUrlPanel from '@/components/events/EventShareUrlPanel'

export const dynamic = 'force-dynamic'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const { data: ev } = await sb.from('events').select('store_name').eq('id', params.id).single()
  return { title: ev ? `${ev.store_name} — Event Summary` : 'Event Summary' }
}

export default async function EventSummaryPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const dayParam = searchParams['day']
  const throughDay = dayParam ? parseInt(Array.isArray(dayParam) ? dayParam[0] : dayParam) : null

  const { data: ev } = await sb
    .from('events')
    .select('*, days:event_days(*)')
    .eq('id', params.id)
    .order('day_number', { referencedTable: 'event_days', ascending: true })
    .single()

  if (!ev) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F0E8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <div style={{ fontWeight: 700, fontSize: 20, color: '#1a1a16' }}>Event not found</div>
        </div>
      </div>
    )
  }

  const { data: store } = await sb.from('stores').select('*').eq('id', ev.store_id).single()

  // Current active share token (if any) — prefilled into the staff
  // share-URL panel below so it renders without a loading flicker.
  const { data: shareTokenRow } = await sb
    .from('event_share_tokens')
    .select('id, token, last_sent_at, last_sent_to, view_count, first_viewed_at, revoked_at')
    .eq('event_id', ev.id)
    .is('revoked_at', null)
    .maybeSingle()

  // Active store-portal token (used for the "flash this at the
  // counter" QR card below). Same shape as the public /e/[token]
  // page so the two surfaces stay in sync.
  const { data: portalRow } = ev.store_id ? await sb
    .from('store_portal_tokens')
    .select('token')
    .eq('store_id', ev.store_id)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() : { data: null as any }
  const bookingPath: string | null = portalRow?.token ? `/store-portal/${portalRow.token}` : null
  const h = headers()
  const reqHost = h.get('host') || ''
  const reqProto = h.get('x-forwarded-proto') || (reqHost.startsWith('localhost') ? 'http' : 'https')
  const reqOrigin = reqHost ? `${reqProto}://${reqHost}` : ''
  const bookingUrlAbs: string | null = bookingPath ? `${reqOrigin}${bookingPath}` : null

  const allDays = (ev.days || []).sort((a: any, b: any) => a.day_number - b.day_number)

  // Days to show in detail — if throughDay, show newest first then preceding
  const displayDays = throughDay
    ? [...allDays.filter((d: any) => d.day_number <= throughDay)].sort((a: any, b: any) => b.day_number - a.day_number)
    : allDays

  // Days to sum for totals
  const summaryDays = throughDay
    ? allDays.filter((d: any) => d.day_number <= throughDay)
    : allDays

  const totals = summaryDays.reduce((acc: any, d: any) => ({
    customers:     acc.customers     + (d.customers      || 0),
    purchases:     acc.purchases     + (d.purchases      || 0),
    dollars:       acc.dollars       + parseFloat(d.dollars10 || 0) + parseFloat(d.dollars5 || 0),
    src_vdp:       acc.src_vdp       + (d.src_vdp        || 0),
    src_postcard:  acc.src_postcard  + (d.src_postcard   || 0),
    src_social:    acc.src_social    + (d.src_social     || 0),
    src_wom:       acc.src_wom       + (d.src_wordofmouth|| 0),
    src_repeat:    acc.src_repeat    + (d.src_repeat     || 0),
    src_store:     acc.src_store     + (d.src_store      || 0),
    src_text:      acc.src_text      + (d.src_text       || 0),
    src_newspaper: acc.src_newspaper + (d.src_newspaper  || 0),
    src_other:     acc.src_other     + (d.src_other      || 0),
  }), { customers:0, purchases:0, dollars:0, src_vdp:0, src_postcard:0, src_social:0, src_wom:0, src_repeat:0, src_store:0, src_text:0, src_newspaper:0, src_other:0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0

  const fmtShort = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const srcTotal = Object.entries(totals).filter(([k]) => k.startsWith('src_')).reduce((s, [, v]) => s + (v as number), 0)
  const sources = [
    { label: 'VDP / Large Postcard', value: totals.src_vdp,       color: '#059669' },
    { label: 'Store Postcard',       value: totals.src_postcard,   color: '#3B82F6' },
    { label: 'Social Media',         value: totals.src_social,     color: '#8B5CF6' },
    { label: 'Word of Mouth',        value: totals.src_wom,        color: '#F59E0B' },
    { label: 'Repeat Customer',      value: totals.src_repeat,     color: '#F43F5E' },
    { label: 'Store',                value: totals.src_store,      color: '#0EA5E9' },
    { label: 'Text Message',         value: totals.src_text,       color: '#10B981' },
    { label: 'Newspaper',            value: totals.src_newspaper,  color: '#6366F1' },
    { label: 'Other',                value: totals.src_other,      color: '#6B7280' },
  ].filter(s => s.value > 0)

  const dayLabel = (d: any) => {
    const dayDate = new Date(ev.start_date + 'T12:00:00')
    dayDate.setDate(dayDate.getDate() + d.day_number - 1)
    return `Day ${d.day_number} — ${fmtShort(dayDate.toISOString().slice(0, 10))}`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ background: '#1D6B44', color: 'white', fontWeight: 900, fontSize: 13, padding: '4px 14px', borderRadius: 20 }}>
              ◆ BEB Buyer Event Summary
            </div>
            {throughDay && (
              <div style={{ background: '#F59E0B', color: 'white', fontWeight: 900, fontSize: 13, padding: '4px 14px', borderRadius: 20 }}>
                Through Day {throughDay}
              </div>
            )}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#1a1a16', margin: '0 0 4px' }}>{store?.name || ev.store_name}</h1>
          <div style={{ color: '#737368', fontSize: 14 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          {ev.workers?.length > 0 && (
            <div style={{ marginTop: 8, color: '#1D6B44', fontSize: 13, fontWeight: 600 }}>
              👤 {ev.workers.map((w: any) => w.name).join(', ')}
            </div>
          )}
        </div>

        {/* Staff-only: per-event public URL controls (mint / send /
            rotate / revoke). The URL drives the /e/[token] store-
            owner dashboard. */}
        <EventShareUrlPanel
          eventId={ev.id}
          initialToken={shareTokenRow as any || null}
          ownerEmail={store?.owner_email || null}
        />

        {/* Booking-page QR — flash at the counter for customers /
            staff to scan and load the booking surface. Same QR as
            the top-right of the public /e/[token] hero, so both
            audiences see the same destination. */}
        {bookingUrlAbs && (
          <div style={{
            background: '#fff', borderRadius: 12, padding: 14,
            border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
            marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <div style={{
              background: '#fff', padding: 8, borderRadius: 10,
              border: '1px solid #E5E7EB', flexShrink: 0,
            }}>
              <QRCodeSVG value={bookingUrlAbs} size={104} level="M" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>
                📲 Scan to book an appointment
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, lineHeight: 1.4 }}>
                Flash this at the counter — customers scan it on their phone and land on the store&apos;s booking page. Same QR appears on the public store-owner dashboard.
              </div>
              <a href={bookingPath!} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  fontSize: 12, fontWeight: 700,
                  color: '#1D6B44', textDecoration: 'none',
                }}>
                Open booking page ↗
              </a>
            </div>
          </div>
        )}

        {/* Running totals — green header card */}
        <div style={{ background: '#1D6B44', borderRadius: 16, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            {throughDay ? `Running Totals — Days 1–${throughDay}` : 'Event Totals'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Customers', totals.customers.toLocaleString()],
              ['Purchases', totals.purchases.toLocaleString()],
              ['💰 Amount Spent', `$${totals.dollars.toLocaleString()}`],
              ['Close Rate', `${closeRate}%`],
            ].map(([label, value]) => (
              <div key={label as string} style={{ background: 'rgba(255,255,255,.12)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#fff' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-day cards — newest first */}
        {displayDays.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {displayDays.map((d: any) => {
              const isNewest = throughDay && d.day_number === throughDay
              const dayDollars = parseFloat(d.dollars10 || 0) + parseFloat(d.dollars5 || 0)
              const dayCR = d.customers > 0 ? Math.round(d.purchases / d.customers * 100) : 0
              return (
                <div key={d.day_number} style={{
                  background: 'white',
                  border: `1px solid ${isNewest ? '#1D6B44' : '#D8D3CA'}`,
                  borderRadius: 12, padding: 20,
                  boxShadow: isNewest ? '0 0 0 2px rgba(29,107,68,.12)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <div style={{ fontWeight: 900, fontSize: 14, color: '#1D6B44' }}>{dayLabel(d)}</div>
                    {isNewest && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: '#1D6B44', color: '#fff', padding: '2px 8px', borderRadius: 99 }}>Latest</span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {([
                      ['Customers', d.customers || 0],
                      ['Purchases', d.purchases || 0],
                      ['Amount Spent', `$${dayDollars.toLocaleString()}`],
                      ['Close Rate', `${dayCR}%`],
                    ] as [string, string|number][]).map(([label, value]) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: '#1a1a16' }}>{value}</div>
                        <div style={{ fontSize: 10, color: '#A8A89A', marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Lead sources */}
        {srcTotal > 0 && (
          <div style={{ background: 'white', border: '1px solid #D8D3CA', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#1a1a16', marginBottom: 16 }}>Lead Sources</div>
            {sources.map(({ label, value, color }) => {
              const pct = Math.round(value / srcTotal * 100)
              return (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: '#4A4A42' }}>{label}</span>
                    <span style={{ fontWeight: 700 }}>{value} <span style={{ color: '#A8A89A' }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: '#F0ECE4', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: '#A8A89A', marginTop: 24 }}>
          BEB LLC · Beneficial Estate Buyers
        </div>
      </div>
    </div>
  )
}
