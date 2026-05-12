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
interface Buy {
  closedAt: string
  buyFormNumber: string   // 5-digit paper form number (per intake spec)
  customer: string
  buyerInitials: string
  checkNumber: string
  amountCents: number
  commPctLabel: string    // '10%' / '5%' / '0%' / 'Store' per intake-purchase spec
}

// ── Hardcoded mock data ─────────────────────────────────────────
const STORE = {
  name: 'Sami Fine Jewelers',
  location: 'Fountain Hills, AZ',
  dates: 'May 11–13, 2026',
  dayLabel: 'LIVE · DAY 2',
  // In the real version this comes from the store row's logo_url
  // (or wherever store logos are stored). For the mockup, a soft
  // monogram disc with the store's initials.
  logoInitials: 'SF',
  logoBg: '#FFFFFF',
  logoFg: '#1e3a8a',
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
const BUYS: Buy[] = [
  { closedAt: '9:14 AM',  buyFormNumber: '12345', customer: 'Janet Smith',      buyerInitials: 'MV', checkNumber: '4521', amountCents:  1_250_00, commPctLabel: '10%'   },
  { closedAt: '9:46 AM',  buyFormNumber: '12346', customer: 'Bob Johnson',      buyerInitials: 'TE', checkNumber: '4522', amountCents:  4_800_00, commPctLabel: '10%'   },
  { closedAt: '10:18 AM', buyFormNumber: '12347', customer: 'Mary Davis',       buyerInitials: 'NR', checkNumber: '4523', amountCents:  8_400_00, commPctLabel: '5%'    },
  { closedAt: '10:42 AM', buyFormNumber: '12348', customer: 'Carlos Hernandez', buyerInitials: 'MV', checkNumber: '4524', amountCents: 12_300_00, commPctLabel: '5%'    },
  { closedAt: '11:05 AM', buyFormNumber: '12349', customer: 'Pat Reilly',       buyerInitials: 'TE', checkNumber: '4525', amountCents:    675_00, commPctLabel: '10%'   },
  { closedAt: '11:30 AM', buyFormNumber: '12350', customer: 'Anita Vance',      buyerInitials: 'NR', checkNumber: '4526', amountCents:  3_725_00, commPctLabel: 'Store' },
  { closedAt: '11:58 AM', buyFormNumber: '12351', customer: 'Greg Mason',       buyerInitials: 'MV', checkNumber: '4527', amountCents:  6_200_00, commPctLabel: '10%'   },
  { closedAt: '1:12 PM',  buyFormNumber: '12352', customer: 'Dana Howe',        buyerInitials: 'NR', checkNumber: '4528', amountCents:  4_800_00, commPctLabel: '0%'    },
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
          padding: '24px 26px',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
          color: '#fff',
          marginBottom: 16,
          boxShadow: '0 4px 12px rgba(30,58,138,.18)',
          display: 'flex', alignItems: 'center', gap: 18,
        }}>
          {/* Store logo. In the real version this is an <img> sourced
              from the store's logo_url; here it's a monogram disc. */}
          <div style={{
            flexShrink: 0,
            width: 72, height: 72, borderRadius: '50%',
            background: STORE.logoBg, color: STORE.logoFg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 26, letterSpacing: '.04em',
            boxShadow: '0 2px 6px rgba(0,0,0,.15)',
          }}>
            {STORE.logoInitials}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
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
          <LauncherTile href="#appointments" icon="📅" label="Appointments"  sub={`${apptCount(APPTS, 'upcoming')} upcoming · ${apptCount(APPTS, 'served')} served`} />
          <LauncherTile href="#buyers"       icon="👥" label="Buyers"        sub={`${BUYERS.length} on-site`}    />
          <LauncherTile href="#buys"         icon="💰" label="Today's buys"  sub={`${BUYS.length} buys · ${fmt(BUYS.reduce((s, b) => s + b.amountCents, 0))}`} />
          <LauncherTile href="#waitlist"     icon="🕒" label="Waitlist"      sub={`${WAITLIST.length} waiting`}  />
        </div>

        {/* ───── Booking CTA (placed up top so store owner can't miss it) ───── */}
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
          <Link
            href="/store-portal/example-token"
            target="_blank"
            rel="noopener noreferrer"
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

        {/* ───── Buys section ───── */}
        <Section id="buys" title="💰 Today's buys">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {BUYS.length} buys · {fmt(BUYS.reduce((s, b) => s + b.amountCents, 0))} total
          </div>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#F9FAFB' }}>
                <tr>
                  <Th style={{ width: 90 }}>Time</Th>
                  <Th style={{ width: 84 }}>Form #</Th>
                  <Th>Customer</Th>
                  <Th style={{ width: 70 }}>Buyer</Th>
                  <Th style={{ width: 84 }}>Check #</Th>
                  <Th style={{ width: 70, textAlign: 'center' as const }}>Comm</Th>
                  <Th style={{ width: 100, textAlign: 'right' as const }}>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {BUYS.map((b, i) => (
                  <tr key={b.buyFormNumber} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151' }}>
                      {b.closedAt}
                    </td>
                    <td style={{ padding: '10px 6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#374151' }}>
                      #{b.buyFormNumber}
                    </td>
                    <td style={{ padding: '10px 6px', fontWeight: 600 }}>{b.customer}</td>
                    <td style={{ padding: '10px 6px', fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.04em' }}>
                      {b.buyerInitials}
                    </td>
                    <td style={{ padding: '10px 6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#6b7280' }}>
                      #{b.checkNumber}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <CommPill label={b.commPctLabel} />
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: '#0f172a' }}>
                      {fmt(b.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: '#F9FAFB' }}>
                <tr>
                  <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 12, color: '#6b7280' }}>
                    Total · {BUYS.length} buys
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900, color: '#1D6B44', fontSize: 15 }}>
                    {fmt(BUYS.reduce((s, b) => s + b.amountCents, 0))}
                  </td>
                </tr>
              </tfoot>
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

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{
      textAlign: 'left',
      padding: '8px 10px',
      fontSize: 11,
      fontWeight: 800,
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '.05em',
      ...style,
    }}>
      {children}
    </th>
  )
}

function CommPill({ label }: { label: string }) {
  // Per the intake-purchase spec, commission % defaults to 10% with
  // overrides to 5% / 0% / 'Store'. Tinted pill so the store owner
  // can scan for non-default lines at a glance.
  const map: Record<string, { bg: string; fg: string }> = {
    '10%':   { bg: '#DBEAFE', fg: '#1E40AF' },
    '5%':    { bg: '#FEF3C7', fg: '#92400E' },
    '0%':    { bg: '#E5E7EB', fg: '#374151' },
    'Store': { bg: '#FCE7F3', fg: '#9D174D' },
  }
  const s = map[label] || { bg: '#F3F4F6', fg: '#374151' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4,
      background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11,
    }}>
      {label}
    </span>
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
