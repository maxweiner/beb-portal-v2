// Public per-event dashboard for the store owner.
//
// Audience: the store's owner (or whoever the BEB partner texts the
// URL to). Distinct from /store-portal/[token] which is the booking
// surface for store EMPLOYEES — different audience, different
// permissions: employees shouldn't see live KPIs.
//
// Auth: token in the URL. No login. The token is unguessable and
// revocable (see `event_share_tokens.revoked_at`). Reads are done with
// the service-role client, matching the pattern used by /edge/[token]
// and /store-portal/[token].
//
// Refresh: server-rendered for the initial paint; a tiny client
// component (<AutoRefresh />) calls router.refresh() every 30s so
// KPIs and rosters stay current without a hard reload.
//
// URL pattern: /e/[token] (NOT /event/[token] — the latter is the
// staff-internal event view at app/event/[id]/page.tsx). The /e/
// prefix is also short for SMS forwarding.

import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { QRCodeSVG } from 'qrcode.react'
import { initials } from '@/lib/initials'
import AutoRefresh from './AutoRefresh'

export const metadata = { title: 'Event' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ── Page ────────────────────────────────────────────────────────
export default async function Page({ params }: { params: { token: string } }) {
  const token = params.token
  if (!token || token.length < 8 || token.length > 64) {
    return <NotFound />
  }

  const sb = admin()

  // 1. Look up the token (must be unrevoked).
  const { data: tokenRow } = await sb
    .from('event_share_tokens')
    .select('id, event_id, revoked_at, revoked_reason, view_count, first_viewed_at')
    .eq('token', token)
    .maybeSingle()
  if (!tokenRow) return <NotFound />
  if (tokenRow.revoked_at) return <Revoked reason={tokenRow.revoked_reason} />

  // 2. Fire-and-forget view tracking (best-effort; never block render).
  const nowIso = new Date().toISOString()
  sb.from('event_share_tokens').update({
    first_viewed_at: tokenRow.first_viewed_at || nowIso,
    last_viewed_at: nowIso,
    view_count: (tokenRow.view_count || 0) + 1,
  }).eq('id', tokenRow.id).then(() => {}, () => {})

  // 3. Event + store.
  const { data: ev } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status, workers, brand')
    .eq('id', tokenRow.event_id)
    .maybeSingle()
  if (!ev) return <NotFound />

  const { data: store } = await sb
    .from('stores')
    .select('id, name, slug, city, state, store_image_url, color_primary')
    .eq('id', ev.store_id)
    .maybeSingle()

  // 4. Compute phase + day label (mirrors the staff HubView logic).
  const today = todayIso()
  const start = ev.start_date as string
  const endIso = addDays(start, 2)
  const reserved = ev.status === 'reserved'
  const cancelled = ev.status === 'cancelled'
  const live = !reserved && !cancelled && start <= today && endIso >= today
  const past = !reserved && !cancelled && endIso < today
  const dayIndexZeroBased = live ? clamp(daysBetween(start, today), 0, 2) : 0
  const dayNumber = dayIndexZeroBased + 1  // 1..3
  const phase: 'live' | 'soon' | 'past' | 'reserved' | 'cancelled' | 'upcoming' =
    cancelled ? 'cancelled'
    : reserved ? 'reserved'
    : past ? 'past'
    : live ? 'live'
    : 'upcoming'

  // 5. Today's appointments / waitlist / buys. For "today" we use the
  //    user's calendar date — DATE column comparisons work fine
  //    against today's ISO.
  const todayDate = today
  const [apptsRes, waitlistRes, buysRes, intakesCountRes] = await Promise.all([
    // ALL non-cancelled appointments for the event, across every
    // day. Previously this was filtered to `appointment_date = today`,
    // which made the section look empty whenever the dashboard was
    // opened on a day without scheduled appointments (e.g. evening
    // of Day 1 when Day 2's bookings exist but Day 1 is done).
    sb.from('appointments')
      .select('id, appointment_date, appointment_time, customer_name, items_bringing, status, is_walkin')
      .eq('event_id', ev.id)
      .neq('status', 'cancelled')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true }),
    sb.from('event_waitlist')
      .select('id, name, party_size:item_count, notify_pref, created_at, expires_at, status')
      .eq('event_id', ev.id)
      .eq('status', 'waiting')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true }),
    sb.from('buyer_checks')
      .select('id, check_number, buy_form_number, amount, commission_rate, commission_note, customer_name, buyer_id, day_number, created_at, payment_type')
      .eq('event_id', ev.id)
      .eq('day_number', dayNumber)
      .order('created_at', { ascending: true }),
    sb.from('customer_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id),
  ])
  const appts = apptsRes.data ?? []
  const waitlist = waitlistRes.data ?? []
  const buys = buysRes.data ?? []
  const seenCount = intakesCountRes.count ?? 0

  // 6. KPIs.
  const buysToday = buys
  const boughtCount = buysToday.filter(b => Number(b.amount || 0) > 0).length
  const spendCents = Math.round(
    buysToday.reduce((sum, b) => sum + (Number(b.amount || 0) * 100), 0),
  )

  // 7. Buyer roster — events.workers JSONB has {id, name, deleted?}.
  //    Join to users for photo_url if we have buyer ids.
  const workers = ((ev.workers as any[]) || []).filter(w => !w.deleted)
  const workerIds = workers.map(w => w.id).filter(Boolean)
  let userPhotos: Record<string, string | null> = {}
  if (workerIds.length) {
    const { data: usersRows } = await sb
      .from('users')
      .select('id, photo_url')
      .in('id', workerIds)
    for (const u of (usersRows || []) as any[]) {
      userPhotos[u.id] = u.photo_url || null
    }
  }

  // 8. Booking-page URL: link out to the most recent active store-
  //    portal token (so the store owner can hand it to their staff
  //    if they don't have it). Best-effort; skip the button if none.
  let bookingUrl: string | null = null
  if (store?.id) {
    const { data: portalRow } = await sb
      .from('store_portal_tokens')
      .select('token')
      .eq('store_id', store.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (portalRow?.token) bookingUrl = `/store-portal/${portalRow.token}`
  }

  // Absolute version of the booking URL for the QR code — relative
  // paths don't scan into anything useful on a phone. Pulled from
  // request headers so preview deploys, custom domains, and localhost
  // all get the correct origin.
  const h = headers()
  const headerHost = h.get('host') || ''
  const headerProto = h.get('x-forwarded-proto') || (headerHost.startsWith('localhost') ? 'http' : 'https')
  const headerOrigin = headerHost ? `${headerProto}://${headerHost}` : ''
  const bookingUrlAbsolute = bookingUrl ? `${headerOrigin}${bookingUrl}` : null

  const phaseLabel = phaseLabelFor(phase, dayNumber, start, today, endIso)

  // 9. Pre-shape for rendering.
  const storeName = store?.name || ev.store_name || 'Event'
  const storeLocation = [store?.city, store?.state].filter(Boolean).join(', ')
  const dateRange = formatDateRange(start, endIso)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAF8F4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color: '#1f2937',
    }}>
      <AutoRefresh />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header card */}
        <div style={{
          borderRadius: 14,
          padding: '24px 26px',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
          color: '#fff',
          marginBottom: 16,
          boxShadow: '0 4px 12px rgba(30,58,138,.18)',
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        }}>
          {/* Logo: store_image_url is a base64 data URL when present;
              fall back to a monogram disc with the store initials. */}
          {store?.store_image_url
            ? <img src={store.store_image_url} alt={storeName}
                style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover',
                  background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.15)', flexShrink: 0 }} />
            : <div style={{
                flexShrink: 0,
                width: 72, height: 72, borderRadius: '50%',
                background: '#fff', color: '#1e3a8a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 26, letterSpacing: '.04em',
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
              }}>{initials(storeName)}</div>
          }

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
                {storeName}
              </h1>
              <span style={{
                background: 'rgba(255,255,255,.22)',
                padding: '4px 12px', borderRadius: 999,
                fontSize: 12, fontWeight: 800, letterSpacing: '.05em',
              }}>{phaseLabel}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.92 }}>
              {storeLocation && <>{storeLocation} · </>}📅 {dateRange}
            </div>
          </div>

          {/* Store portal QR — top-right of the hero. Encodes the
              ABSOLUTE booking URL so customers/staff can scan it
              with their phones from across the counter. Only renders
              when an active store_portal_token exists for the store. */}
          {bookingUrlAbsolute && (
            <a href={bookingUrl!} target="_blank" rel="noopener noreferrer"
              style={{
                flexShrink: 0,
                background: '#fff',
                padding: 8,
                borderRadius: 10,
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                textDecoration: 'none',
              }}
              title="Open booking page in a new tab"
            >
              <QRCodeSVG value={bookingUrlAbsolute} size={96} level="M" />
              <div style={{ fontSize: 10, fontWeight: 800, color: '#1e3a8a', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Scan to book
              </div>
            </a>
          )}
        </div>

        {/* KPI row */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 0,
          marginBottom: 16,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,.05)',
        }}>
          <Kpi label="Seen"   value={`${seenCount}`}    hint="Customers checked in (all days)" />
          <Kpi label="Bought" value={`${boughtCount}`}  hint={seenCount > 0 ? `${pct(boughtCount, seenCount)}% close rate` : 'No buys yet today'} />
          <Kpi label="Spend"  value={fmt(spendCents)}   hint={`Day ${dayNumber}`} emphasize />
        </div>

        {/* Launcher row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
          marginBottom: 18,
        }}>
          <LauncherTile href="#appointments" icon="📅" label="Appointments"  sub={apptLauncherSub(appts, today)} />
          <LauncherTile href="#buyers"       icon="👥" label="Buyers"        sub={`${workers.length} on-site`} />
          <LauncherTile href="#buys"         icon="💰" label="Today's buys"  sub={`${buys.length} buys · ${fmt(spendCents)}`} />
          <LauncherTile href="#waitlist"     icon="🕒" label="Waitlist"      sub={`${waitlist.length} waiting`} />
        </div>

        {/* Booking CTA */}
        {bookingUrl && (
          <div style={{
            marginBottom: 18, padding: 16,
            background: '#fff', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
            boxShadow: '0 1px 3px rgba(0,0,0,.04)',
            border: '1px dashed #d1d5db',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Need to book an appointment for a customer?</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                Your booking page is a separate URL — store staff use it to add appointments without seeing live results.
              </div>
            </div>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"
              style={{
                background: '#1D6B44', color: '#fff',
                padding: '10px 18px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}>
              Open booking page →
            </a>
          </div>
        )}

        {/* Appointments — grouped by date so all 3 days of the
            event are visible at once. */}
        <Section id="appointments" title="📅 Appointments">
          {appts.length === 0 ? (
            <Empty>No appointments scheduled yet.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupApptsByDate(appts).map(group => (
                <Card key={group.date}>
                  <div style={{
                    padding: '8px 14px', background: '#F9FAFB',
                    fontSize: 11, fontWeight: 800, color: '#374151',
                    textTransform: 'uppercase', letterSpacing: '.05em',
                    borderBottom: '1px solid #F3F4F6',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>{dateGroupLabel(group.date, today)}</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>·</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>
                      {group.rows.length} appointment{group.rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <table style={tableStyle}>
                    <tbody>
                      {group.rows.map((a, i) => (
                        <tr key={a.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151', width: 100 }}>
                            {formatTime(a.appointment_time)}
                          </td>
                          <td style={{ padding: '10px 6px', fontWeight: 600 }}>
                            {a.customer_name}
                            {a.is_walkin && <span style={{ marginLeft: 6, fontSize: 10, color: '#1e40af', fontWeight: 700 }}>WALK-IN</span>}
                          </td>
                          <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>
                            {(a.items_bringing || []).join(', ')}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <ApptStatusPill status={a.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Buyers */}
        <Section id="buyers" title="👥 Buyers on-site">
          {workers.length === 0 ? (
            <Empty>No buyers assigned yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {workers.map((w: any) => {
                const photo = userPhotos[w.id]
                return (
                  <div key={w.id} style={{
                    background: '#fff', borderRadius: 10, padding: 12,
                    display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,.04)',
                  }}>
                    {photo
                      ? <img src={photo} alt={w.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                      : <div style={{
                          width: 44, height: 44, borderRadius: '50%',
                          background: pickAvatarColor(w.id || w.name),
                          color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: 15, letterSpacing: '.04em',
                        }}>{initials(w.name || '?')}</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{w.name || '—'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Buys */}
        <Section id="buys" title="💰 Today's buys">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {buys.length} buys · {fmt(spendCents)} total · Day {dayNumber}
          </div>
          {buys.length === 0 ? (
            <Empty>No buys logged yet today.</Empty>
          ) : (
            <Card>
              <table style={tableStyle}>
                <thead style={{ background: '#F9FAFB' }}>
                  <tr>
                    <Th style={{ width: 90 }}>Time</Th>
                    <Th style={{ width: 84 }}>Form #</Th>
                    <Th>Customer</Th>
                    <Th style={{ width: 70 }}>Buyer</Th>
                    <Th style={{ width: 84 }}>Check #</Th>
                    <Th style={{ width: 70, textAlign: 'center' }}>Comm</Th>
                    <Th style={{ width: 110, textAlign: 'right' }}>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {buys.map((b) => (
                    <tr key={b.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151' }}>
                        {formatShortTime(b.created_at)}
                      </td>
                      <td style={mono}>{b.buy_form_number ? `#${b.buy_form_number}` : '—'}</td>
                      <td style={{ padding: '10px 6px' }}>
                        <div style={{ fontWeight: 600 }}>{b.customer_name || '—'}</div>
                        {b.commission_note && (
                          <div style={{ fontSize: 11, color: '#92400e', marginTop: 2, fontStyle: 'italic' }}>
                            📝 {b.commission_note}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 6px', fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.04em' }}>
                        {b.buyer_id ? buyerInitialsFor(b.buyer_id, workers) : '—'}
                      </td>
                      <td style={mono}>{b.check_number ? `#${b.check_number}` : '—'}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                        <CommPill rate={Number(b.commission_rate ?? 10)} />
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: '#0f172a' }}>
                        {fmt(Math.round(Number(b.amount || 0) * 100))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ background: '#F9FAFB' }}>
                  <tr>
                    <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 12, color: '#6b7280' }}>
                      Total · {buys.length} buys
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900, color: '#1D6B44', fontSize: 15 }}>
                      {fmt(spendCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </Section>

        {/* Waitlist */}
        <Section id="waitlist" title="🕒 Waitlist">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {waitlist.length} currently waiting · refreshes automatically
          </div>
          {waitlist.length === 0 ? (
            <Empty>Nobody on the waitlist right now.</Empty>
          ) : (
            <Card>
              <table style={tableStyle}>
                <tbody>
                  {waitlist.map((w, i) => (
                    <tr key={w.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: 36, fontWeight: 800, color: '#6b7280' }}>
                        #{i + 1}
                      </td>
                      <td style={{ padding: '10px 6px', fontWeight: 600 }}>{w.name}</td>
                      <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>
                        joined {formatShortTime(w.created_at)} ·{' '}
                        {Number(w.party_size || 1) === 1 ? '1 person' : `${w.party_size} people`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {w.notify_pref === 'sms'
                          ? <span style={{ fontSize: 11, color: '#1e40af', fontWeight: 700 }}>📱 will text</span>
                          : <span style={{ fontSize: 11, color: '#9ca3af' }}>no text</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>

        <p style={{ marginTop: 24, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          This is a private link for the store owner. Refreshes every 30 seconds. Reply to the text/email this URL came in with questions.
        </p>
      </div>
    </div>
  )
}


// ── Stubs for not-found / revoked ────────────────────────────────
function NotFound() {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>Event not found</h1>
      <p style={{ color: '#6b7280' }}>The link you followed doesn&apos;t match any active event. If you think this is a mistake, reply to the text/email so we can resend.</p>
    </Frame>
  )
}
function Revoked({ reason }: { reason?: string | null }) {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>This link has been revoked</h1>
      <p style={{ color: '#6b7280' }}>{reason || 'The sender revoked this URL. Reply to the original text/email if you still need access.'}</p>
    </Frame>
  )
}
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24 }}>
      <div style={{ maxWidth: 600, margin: '64px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        {children}
      </div>
    </div>
  )
}


// ── helpers ────────────────────────────────────────────────────
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function daysBetween(a: string, b: string): number {
  const aMs = new Date(a + 'T12:00:00').getTime()
  const bMs = new Date(b + 'T12:00:00').getTime()
  return Math.floor((bMs - aMs) / 86_400_000)
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function pct(part: number, whole: number): string {
  if (!whole) return '0'
  return ((part / whole) * 100).toFixed(0)
}
function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '—'
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return hhmm
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '—' }
}
/** Sub-text for the Appointments launcher tile. If anything is on today,
 *  highlight today's counts; otherwise summarize the whole event. */
function apptLauncherSub(
  rows: { appointment_date: string; status: string }[],
  today: string,
): string {
  const todays = rows.filter(r => r.appointment_date === today)
  if (todays.length > 0) {
    const upcoming = todays.filter(r => r.status !== 'completed' && r.status !== 'no_show').length
    const served = todays.filter(r => r.status === 'completed').length
    return `today: ${upcoming} upcoming · ${served} served`
  }
  return `${rows.length} total this event`
}

/** Group appointment rows by appointment_date and return one entry
 *  per date in chronological order. */
function groupApptsByDate<T extends { appointment_date: string }>(rows: T[]): { date: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const arr = map.get(r.appointment_date) || []
    arr.push(r)
    map.set(r.appointment_date, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rs]) => ({ date, rows: rs }))
}

/** Human-friendly day header: "Today · Mon May 12", "Tomorrow · Tue May 13",
 *  or just the weekday + date for further-out days. */
function dateGroupLabel(iso: string, today: string): string {
  const d = new Date(iso + 'T12:00:00')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (iso === today) return `Today · ${weekday} ${monthDay}`
  const tMs = new Date(today + 'T12:00:00').getTime()
  const dMs = d.getTime()
  if (dMs - tMs === 86_400_000) return `Tomorrow · ${weekday} ${monthDay}`
  if (tMs - dMs === 86_400_000) return `Yesterday · ${weekday} ${monthDay}`
  return `${weekday} ${monthDay}`
}

function formatDateRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso + 'T12:00:00')
    const e = new Date(endIso + 'T12:00:00')
    const fmtOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const sameMonth = s.getMonth() === e.getMonth()
    const startStr = s.toLocaleDateString('en-US', fmtOpts)
    const endStr = sameMonth ? String(e.getDate()) : e.toLocaleDateString('en-US', fmtOpts)
    return `${startStr}–${endStr}, ${e.getFullYear()}`
  } catch { return startIso }
}
function phaseLabelFor(phase: string, dayNumber: number, start: string, today: string, endIso: string): string {
  if (phase === 'live') return `LIVE · DAY ${dayNumber}`
  if (phase === 'cancelled') return 'CANCELLED'
  if (phase === 'reserved') return 'SAVE THE DATE'
  if (phase === 'past') {
    const days = daysBetween(endIso, today)
    return days === 0 ? 'JUST ENDED' : `WRAPPED · ${days}d AGO`
  }
  // upcoming
  const d = daysBetween(today, start)
  if (d <= 0) return 'STARTING SOON'
  return `IN ${d} DAY${d === 1 ? '' : 'S'}`
}
function pickAvatarColor(seed: string): string {
  const colors = ['#1D6B44', '#1E40AF', '#92400E', '#7C2D12', '#5B21B6', '#0F766E']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}
function buyerInitialsFor(buyerId: string, workers: any[]): string {
  const w = workers.find((x: any) => x.id === buyerId)
  return w?.name ? initials(w.name) : '—'
}


// ── small layout helpers ────────────────────────────────────────
function Kpi({ label, value, hint, emphasize }: { label: string; value: string; hint: string; emphasize?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: emphasize ? '#1D6B44' : '#0f172a', marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{hint}</div>
    </div>
  )
}
function LauncherTile({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <a href={href} style={{
      background: '#fff', borderRadius: 12, padding: '16px 14px',
      textDecoration: 'none', color: '#0f172a',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{sub}</div>
      </div>
    </a>
  )
}
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 22, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  )
}
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
      {children}
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', color: '#6b7280', fontSize: 13, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
      {children}
    </div>
  )
}
function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', ...style }}>
      {children}
    </th>
  )
}
function CommPill({ rate }: { rate: number }) {
  const map: Record<number, { bg: string; fg: string; label: string }> = {
    10: { bg: '#DBEAFE', fg: '#1E40AF', label: '10%' },
    5:  { bg: '#FEF3C7', fg: '#92400E', label: '5%'  },
    0:  { bg: '#E5E7EB', fg: '#374151', label: '0%'  },
  }
  const s = map[rate] || { bg: '#F3F4F6', fg: '#374151', label: `${rate}%` }
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}
function ApptStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    confirmed:  { bg: '#FEF3C7', fg: '#92400E', label: '⏳ upcoming' },
    completed:  { bg: '#D1FAE5', fg: '#065F46', label: '✓ served'   },
    no_show:    { bg: '#FEE2E2', fg: '#991B1B', label: '⚠ no-show' },
  }
  const s = map[status] || { bg: '#F3F4F6', fg: '#374151', label: status || '—' }
  return <span style={{ padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const mono: React.CSSProperties = {
  padding: '10px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, color: '#6b7280',
}
