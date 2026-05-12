// MOCKUP ROUTE — visual preview of the proposed store-owner event
// dashboard. All data on this page is hardcoded; no DB queries.
// Open the Vercel preview deploy at /event-preview to see it.
//
// Audience for the real (post-mockup) page: the store owner only —
// distinct from /store-portal/[token], which is the booking surface
// used by store employees who shouldn't see live event KPIs.
//
// Once Max approves the layout, this route gets replaced by
// /event/[token]/page.tsx wired to real data + a per-event token.

import Link from 'next/link'

export const dynamic = 'force-static'

interface Buyer {
  initials: string
  name: string
  role: string
  color: string
}
interface Appt {
  time: string
  customer: string
  items: string
  status: 'served' | 'upcoming' | 'no_show'
}
interface WaitlistRow {
  position: number
  name: string
  joinedAt: string
  partySize: number
  notify: 'sms' | 'none'
}

// ── Hardcoded mock data ─────────────────────────────────────────
const STORE = {
  name: 'Sami Fine Jewelers',
  location: 'Fountain Hills, AZ',
  dates: 'May 11–13, 2026',
  dayLabel: 'LIVE · DAY 2',
}
const KPIS = {
  seen: 24,
  bought: 18,
  spend: 42150_00,  // dollars in cents
}
const BUYERS: Buyer[] = [
  { initials: 'MV', name: 'Mike Vargas',  role: 'Lead buyer', color: '#1D6B44' },
  { initials: 'TE', name: 'Teri Welsch',  role: 'Buyer',      color: '#1E40AF' },
  { initials: 'NR', name: 'Nathan Rivera',role: 'Buyer',      color: '#92400E' },
]
const APPTS: Appt[] = [
  { time: '9:00 AM',  customer: 'Janet Smith',     items: 'Gold chain, ring',         status: 'served'   },
  { time: '9:30 AM',  customer: 'Bob Johnson',     items: 'Diamond solitaire',         status: 'served'   },
  { time: '10:00 AM', customer: 'Mary Davis',      items: 'Watch collection',          status: 'served'   },
  { time: '10:30 AM', customer: 'Carlos Hernandez',items: 'Estate jewelry box',        status: 'served'   },
  { time: '11:00 AM', customer: 'Tom Wilson',      items: 'Tennis bracelet',           status: 'no_show'  },
  { time: '11:30 AM', customer: 'Lisa Chen',       items: 'Inherited collection',      status: 'upcoming' },
  { time: '1:00 PM',  customer: 'David Park',      items: 'Class ring, school medals', status: 'upcoming' },
  { time: '2:00 PM',  customer: 'Sara Lin',        items: 'Mother\'s wedding set',     status: 'upcoming' },
]
const WAITLIST: WaitlistRow[] = [
  { position: 1, name: 'Tom Wilson',  joinedAt: '10:23 AM', partySize: 1, notify: 'sms'  },
  { position: 2, name: 'Lisa Chen',   joinedAt: '10:35 AM', partySize: 2, notify: 'none' },
  { position: 3, name: 'David Park',  joinedAt: '10:48 AM', partySize: 1, notify: 'sms'  },
  { position: 4, name: 'Sara Lin',    joinedAt: '11:02 AM', partySize: 1, notify: 'sms'  },
]

// ── UI ──────────────────────────────────────────────────────────
export default function EventPreviewPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAF8F4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color: '#1f2937',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* Mockup banner — only shown on the preview route */}
        <div style={{
          background: '#FEF3C7', color: '#92400E', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700,
          textAlign: 'center', marginBottom: 12,
        }}>
          📐 MOCKUP — hardcoded data, no DB queries. Sign off here before we wire it up for real.
        </div>

        {/* ───── Header card (blue gradient) ───── */}
        <div style={{
          borderRadius: 14,
          padding: '28px 26px',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
          color: '#fff',
          marginBottom: 16,
          boxShadow: '0 4px 12px rgba(30,58,138,.18)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
              {STORE.name}
            </h1>
            <span style={{
              background: 'rgba(255,255,255,.22)',
              padding: '4px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 800, letterSpacing: '.05em',
            }}>
              {STORE.dayLabel}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 14, opacity: 0.92 }}>
            {STORE.location} · 📅 {STORE.dates}
          </div>
        </div>

        {/* ───── KPI row ───── */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 0,
          marginBottom: 16,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,.05)',
        }}>
          <Kpi label="Seen"   value={`${KPIS.seen}`}              hint="Customers through the door" />
          <Kpi label="Bought" value={`${KPIS.bought}`}            hint={`${pct(KPIS.bought, KPIS.seen)}% close rate`} />
          <Kpi label="Spend"  value={fmt(KPIS.spend)}             hint="Total purchased today" emphasize />
        </div>

        {/* ───── Launcher row (scroll-to-anchor only — read-only) ───── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
          marginBottom: 18,
        }}>
          <LauncherTile href="#buyers"       icon="👥" label="Buyers"        sub={`${BUYERS.length} on-site`}    />
          <LauncherTile href="#appointments" icon="📅" label="Appointments"  sub={`${apptCount(APPTS, 'upcoming')} upcoming · ${apptCount(APPTS, 'served')} served`} />
          <LauncherTile href="#waitlist"     icon="🕒" label="Waitlist"      sub={`${WAITLIST.length} waiting`}  />
        </div>

        {/* ───── Buyers section ───── */}
        <Section id="buyers" title="👥 Buyers on-site">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {BUYERS.map(b => (
              <div key={b.initials} style={{
                background: '#fff', borderRadius: 10, padding: 12,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,.04)',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: b.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 15, letterSpacing: '.04em',
                }}>{b.initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{b.role}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ───── Appointments section ───── */}
        <Section id="appointments" title="📅 Today's appointments">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            Tuesday, May 12 · {apptCount(APPTS, 'served')} served · {apptCount(APPTS, 'upcoming')} upcoming · {apptCount(APPTS, 'no_show')} no-show
          </div>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {APPTS.map((a, i) => (
                  <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151', width: 90 }}>
                      {a.time}
                    </td>
                    <td style={{ padding: '10px 6px', fontWeight: 600 }}>{a.customer}</td>
                    <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>{a.items}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <ApptStatusPill status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ───── Waitlist section ───── */}
        <Section id="waitlist" title="🕒 Waitlist">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {WAITLIST.length} currently waiting · live, refreshes automatically
          </div>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {WAITLIST.map(w => (
                  <tr key={w.position} style={{ borderTop: w.position === 1 ? 'none' : '1px solid #F3F4F6' }}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: 36, fontWeight: 800, color: '#6b7280' }}>
                      #{w.position}
                    </td>
                    <td style={{ padding: '10px 6px', fontWeight: 600 }}>{w.name}</td>
                    <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>
                      joined {w.joinedAt} · {w.partySize === 1 ? '1 person' : `${w.partySize} people`}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {w.notify === 'sms'
                        ? <span style={{ fontSize: 11, color: '#1e40af', fontWeight: 700 }}>📱 will text</span>
                        : <span style={{ fontSize: 11, color: '#9ca3af' }}>no text</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ───── Booking CTA ───── */}
        <div style={{
          marginTop: 20, padding: 16,
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
          <Link
            href="#"
            style={{
              background: '#1D6B44', color: '#fff',
              padding: '10px 18px', borderRadius: 8,
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open booking page →
          </Link>
        </div>

        <p style={{ marginTop: 24, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          This is a private link for the store owner. Questions? Reply to the text/email this URL came in.
        </p>
      </div>
    </div>
  )
}


// ── helpers ─────────────────────────────────────────────────────
function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function pct(part: number, whole: number): string {
  if (!whole) return '0'
  return ((part / whole) * 100).toFixed(0)
}
function apptCount(rows: Appt[], status: Appt['status']): number {
  return rows.filter(a => a.status === status).length
}

function Kpi({ label, value, hint, emphasize }: { label: string; value: string; hint: string; emphasize?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: emphasize ? '#1D6B44' : '#0f172a', marginTop: 4, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{hint}</div>
    </div>
  )
}

function LauncherTile({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <a href={href} style={{
      background: '#fff',
      borderRadius: 12,
      padding: '16px 14px',
      textDecoration: 'none',
      color: '#0f172a',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      transition: 'transform 0.1s ease, box-shadow 0.1s ease',
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

function ApptStatusPill({ status }: { status: Appt['status'] }) {
  const map: Record<Appt['status'], { bg: string; fg: string; label: string }> = {
    served:   { bg: '#D1FAE5', fg: '#065F46', label: '✓ served'    },
    upcoming: { bg: '#FEF3C7', fg: '#92400E', label: '⏳ upcoming' },
    no_show:  { bg: '#FEE2E2', fg: '#991B1B', label: '⚠ no-show'  },
  }
  const s = map[status]
  return <span style={{ padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}
