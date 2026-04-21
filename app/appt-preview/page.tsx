'use client'

/**
 * Mobile Appts — navigation exploration.
 *
 * Four interactive phone mockups stacked on one page. Each shows the
 * appointment screen identically; only the mechanism for switching to
 * other events differs.
 *
 * /appt-preview — navigate here in a browser to compare.
 */

import { useState } from 'react'

/* ═════════════════════════  Palette  ═════════════════════════ */

const C = {
  cream:     '#F5F0E8',
  cream2:    '#EDE8DF',
  pearl:     '#E8E0D0',
  white:     '#FFFFFF',
  darkGreen: '#2D6B44',
  green:     '#40916C',
  greenPale: '#D8EDDF',
  gold:      '#C9A84C',
  ink:       '#1A1A1A',
  ash:       '#4A4A42',
  mist:      '#6B7280',
  fog:       '#9CA3AF',
}

const LEAD: Record<string, { label: string; color: string; bg: string }> = {
  vdp:      { label: 'VDP',           color: '#1E40AF', bg: '#DBEAFE' },
  postcard: { label: 'Postcard',      color: '#5B21B6', bg: '#EDE9FE' },
  wom:      { label: 'Word of Mouth', color: '#92400E', bg: '#FEF3C7' },
  repeat:   { label: 'Repeat',        color: '#065F46', bg: '#D1FAE5' },
  social:   { label: 'Social Media',  color: '#9D174D', bg: '#FCE7F3' },
  walkin:   { label: 'Walk-in',       color: '#374151', bg: '#E5E7EB' },
}

/* ═════════════════════════  Mock data  ═════════════════════════ */

type Source = keyof typeof LEAD | null
interface Appt {
  time: string
  name: string | null
  source: Source
  phone?: string
  items?: string
}

// Day 2 of Sami Fine Jewelers — 9 booked, 12 available.
const DAY_APPTS: Appt[] = [
  { time: '10:00 AM', name: 'Sarah Johnson',     source: 'vdp',      phone: '(480) 555-0102', items: 'Gold wedding band, diamond pendant' },
  { time: '10:20 AM', name: null,                source: null },
  { time: '10:40 AM', name: 'Mike & Lisa Chen',  source: 'postcard', phone: '(602) 555-0122', items: 'Estate silver, 20+ pcs' },
  { time: '11:00 AM', name: null,                source: null },
  { time: '11:20 AM', name: 'Robert Davis',      source: 'repeat',   phone: '(480) 555-0138', items: 'Vintage watches — 2' },
  { time: '11:40 AM', name: null,                source: null },
  { time: '12:00 PM', name: 'Patricia Moore',    source: 'wom',      phone: '(602) 555-0144', items: 'Gold chain + anniversary ring' },
  { time: '12:20 PM', name: null,                source: null },
  { time: '12:40 PM', name: 'James Wilson',      source: 'vdp',      phone: '(480) 555-0156', items: '14k bracelet' },
  { time: '1:00 PM',  name: null,                source: null },
  { time: '1:20 PM',  name: 'Nancy Thompson',    source: 'social',   phone: '(602) 555-0167', items: 'Diamond earrings' },
  { time: '1:40 PM',  name: null,                source: null },
  { time: '2:00 PM',  name: 'David Martinez',    source: 'walkin',   phone: '(480) 555-0179', items: 'Costume + misc silver' },
  { time: '2:20 PM',  name: null,                source: null },
  { time: '2:40 PM',  name: 'Karen White',       source: 'repeat',   phone: '(602) 555-0182', items: 'Tennis bracelet' },
  { time: '3:00 PM',  name: null,                source: null },
  { time: '3:20 PM',  name: 'Tom Anderson',      source: 'vdp',      phone: '(480) 555-0195', items: 'Estate gold — 8 pcs' },
  { time: '3:40 PM',  name: null,                source: null },
  { time: '4:00 PM',  name: 'Linda Garcia',      source: 'postcard', phone: '(602) 555-0201', items: 'Silver tea set' },
  { time: '4:20 PM',  name: null,                source: null },
  { time: '4:40 PM',  name: null,                source: null },
]

const ACTIVE_EVENT = { id: 's', name: 'Sami Fine Jewelers', city: 'Fountain Hills, AZ', dayOfEvent: 2, totalDays: 3 }
const OTHER_ASSIGNED = [
  { id: 'k', name: 'Kay Jewelers',  city: 'Scottsdale, AZ', when: 'Apr 28 – 30', count: 42 },
  { id: 'z', name: 'Zales',         city: 'Chandler, AZ',   when: 'May 5 – 7',   count: 38 },
]
// Non-assigned (searchable via Option C).
const OTHER_STORES = [
  { id: 'j', name: 'Jared',         city: 'Tempe, AZ' },
  { id: 'b', name: 'Ben Bridge',    city: 'Phoenix, AZ' },
  { id: 'r', name: 'Riddle\'s',     city: 'Mesa, AZ' },
]

const STATS = { booked: 9, available: 12 }
const FILL_PCT = Math.round((STATS.booked / (STATS.booked + STATS.available)) * 100)

/* ═════════════════════════  Shared chrome  ═════════════════════════ */

function StatusBar() {
  return (
    <div style={{
      height: 32, paddingLeft: 16, paddingRight: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: C.white, color: C.ink, fontSize: 13, fontWeight: 700,
      flexShrink: 0,
    }}>
      <span>9:41</span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 11 }}>●●●●</span>
        <span style={{ fontSize: 11 }}>📶</span>
        <span style={{ fontSize: 11 }}>🔋</span>
      </span>
    </div>
  )
}

function BottomNav() {
  const items = [
    { label: 'Home',   icon: '⌂',  active: false },
    { label: 'Events', icon: '◆',  active: false },
    { label: 'Appts',  icon: '📅', active: true },
    { label: 'Travel', icon: '✈️', active: false },
  ]
  return (
    <div style={{
      borderTop: `1px solid ${C.pearl}`, background: C.cream,
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
      paddingBottom: 6, flexShrink: 0,
    }}>
      <Tab item={items[0]} />
      <Tab item={items[1]} />
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 6px' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: C.white, border: `2px solid ${C.darkGreen}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: -14, boxShadow: '0 2px 6px rgba(0,0,0,.1)',
          fontSize: 20,
        }}>📷</div>
      </div>
      <Tab item={items[2]} />
      <Tab item={items[3]} />
    </div>
  )
}

function Tab({ item }: { item: { label: string; icon: string; active: boolean } }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '10px 0 4px' }}>
      <div style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</div>
      <div style={{ fontSize: 10, fontWeight: item.active ? 900 : 500, color: item.active ? C.darkGreen : C.mist }}>{item.label}</div>
    </div>
  )
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 375, height: 720, borderRadius: 32,
      background: '#000', padding: 6,
      boxShadow: '0 20px 50px rgba(0,0,0,.35)',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 26, overflow: 'hidden',
        background: C.cream, display: 'flex', flexDirection: 'column',
      }}>
        {children}
      </div>
    </div>
  )
}

function LiveDot() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      background: '#DC2626', color: C.white,
      fontSize: 9, fontWeight: 900, letterSpacing: '.08em',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.white }} />
      LIVE
    </span>
  )
}

/* ═════════════════════════  Shared day bar + list  ═════════════════════════ */

function DayBar({ day, setDay }: { day: 1 | 2 | 3; setDay: (d: 1 | 2 | 3) => void }) {
  return (
    <div style={{ padding: '10px 16px', background: C.green }}>
      <div style={{ display: 'flex', background: 'rgba(0,0,0,.22)', borderRadius: 10, padding: 3 }}>
        {[1, 2, 3].map(d => {
          const active = day === d
          const isToday = d === ACTIVE_EVENT.dayOfEvent
          return (
            <button key={d} onClick={() => setDay(d as 1 | 2 | 3)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: active ? C.cream : 'transparent',
              color: active ? C.darkGreen : 'rgba(255,255,255,.85)',
              fontSize: 13, fontWeight: 900, cursor: 'pointer',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,.2)' : 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <span>Day {d}</span>
              {isToday && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.8 }}>TODAY</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StatsStrip() {
  return (
    <div style={{
      padding: '8px 16px', background: C.cream2,
      fontSize: 11, fontWeight: 700, color: C.ash,
      display: 'flex', gap: 14, borderBottom: `1px solid ${C.pearl}`,
    }}>
      <span><strong style={{ color: C.darkGreen }}>{STATS.booked}</strong> booked</span>
      <span><strong style={{ color: C.mist }}>{STATS.available}</strong> available</span>
      <span style={{ marginLeft: 'auto', color: C.green }}>{FILL_PCT}% full</span>
    </div>
  )
}

function ApptList({ expanded, setExpanded }: { expanded: number | null; setExpanded: (i: number | null) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.cream }}>
      {DAY_APPTS.map((a, i) => {
        const isOpen = expanded === i
        const lead = a.source ? LEAD[a.source] : null
        const rowBg = a.name && lead ? lead.bg : C.cream
        return (
          <div key={i} onClick={() => a.name && setExpanded(isOpen ? null : i)} style={{
            background: rowBg,
            borderBottom: '1px solid rgba(0,0,0,.04)',
            padding: '10px 14px',
            cursor: a.name ? 'pointer' : 'default',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <div style={{
              minWidth: 58, fontSize: 11, fontWeight: 800,
              color: a.name && lead ? lead.color : (a.name ? C.ink : C.fog),
              paddingTop: 1,
            }}>{a.time}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {a.name ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{a.name}</div>
                  {lead && (
                    <div style={{ fontSize: 10, color: lead.color, fontWeight: 700, marginTop: 2 }}>
                      {lead.label}
                    </div>
                  )}
                  {isOpen && (
                    <div style={{ marginTop: 6, fontSize: 11, color: C.ash, lineHeight: 1.6 }}>
                      <div>📞 {a.phone}</div>
                      <div>💎 {a.items}</div>
                    </div>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 12, fontStyle: 'italic', color: C.fog }}>Available</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HeaderLine({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 16px', background: C.cream,
      borderBottom: `1px solid ${C.pearl}`,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: C.ink }}>{ACTIVE_EVENT.name}</span>
          <LiveDot />
        </div>
        <div style={{ fontSize: 12, color: C.mist }}>
          {ACTIVE_EVENT.city} · Day {ACTIVE_EVENT.dayOfEvent} of {ACTIVE_EVENT.totalDays}
        </div>
      </div>
      {trailing}
    </div>
  )
}

/* ═════════════════════════  Option A — Dropdown  ═════════════════════════ */

function OptionA() {
  const [day, setDay] = useState<1 | 2 | 3>(ACTIVE_EVENT.dayOfEvent as 1 | 2 | 3)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <div style={{ padding: '12px 16px', background: C.cream, borderBottom: `1px solid ${C.pearl}`, position: 'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{
          width: '100%', padding: '8px 12px', borderRadius: 10,
          background: C.white, border: `1.5px solid ${C.pearl}`, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{ACTIVE_EVENT.name}</span>
              <LiveDot />
            </div>
            <div style={{ fontSize: 11, color: C.mist, marginTop: 1 }}>
              {ACTIVE_EVENT.city} · Day {ACTIVE_EVENT.dayOfEvent} of {ACTIVE_EVENT.totalDays}
            </div>
          </div>
          <span style={{ fontSize: 16, color: C.darkGreen }}>{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% - 1px)', left: 12, right: 12,
            background: C.white, border: `1.5px solid ${C.pearl}`,
            borderTop: 'none', borderRadius: '0 0 10px 10px',
            boxShadow: '0 8px 20px rgba(0,0,0,.12)', zIndex: 5,
            overflow: 'hidden',
          }}>
            {OTHER_ASSIGNED.map(ev => (
              <button key={ev.id} style={{
                width: '100%', padding: '10px 14px', background: 'none',
                border: 'none', borderBottom: `1px solid ${C.cream2}`,
                textAlign: 'left', cursor: 'pointer',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{ev.name}</div>
                <div style={{ fontSize: 11, color: C.mist }}>{ev.city} · {ev.when} · {ev.count} appts</div>
              </button>
            ))}
            <button style={{
              width: '100%', padding: '10px 14px', background: C.greenPale,
              border: 'none', textAlign: 'left', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: C.darkGreen,
            }}>
              🔎 Browse all events →
            </button>
          </div>
        )}
      </div>
      <DayBar day={day} setDay={setDay} />
      <StatsStrip />
      <ApptList expanded={expanded} setExpanded={setExpanded} />
    </>
  )
}

/* ═════════════════════════  Option B — Pill/Chip Buttons  ═════════════════════════ */

function OptionB() {
  const [day, setDay] = useState<1 | 2 | 3>(ACTIVE_EVENT.dayOfEvent as 1 | 2 | 3)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [activeId, setActiveId] = useState<string>(ACTIVE_EVENT.id)

  const pills = [
    { id: ACTIVE_EVENT.id, label: 'Sami',   active: activeId === 's' },
    { id: 'k',             label: 'Kay',    active: activeId === 'k' },
    { id: 'z',             label: 'Zales',  active: activeId === 'z' },
  ]

  return (
    <>
      <HeaderLine />
      <div style={{
        padding: '10px 14px', background: C.cream,
        borderBottom: `1px solid ${C.pearl}`,
        display: 'flex', gap: 6, overflowX: 'auto',
      }}>
        {pills.map(p => (
          <button key={p.id} onClick={() => setActiveId(p.id)} style={{
            flexShrink: 0, padding: '6px 14px', borderRadius: 99,
            background: p.active ? C.darkGreen : C.white,
            color: p.active ? C.white : C.darkGreen,
            border: `1.5px solid ${p.active ? C.darkGreen : C.green}`,
            fontSize: 12, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: p.active ? '0 2px 6px rgba(45,107,68,.3)' : 'none',
          }}>
            {p.label}
          </button>
        ))}
        <button style={{
          flexShrink: 0, padding: '6px 12px', borderRadius: 99,
          background: C.cream2, color: C.mist,
          border: `1.5px dashed ${C.pearl}`,
          fontSize: 12, fontWeight: 900, cursor: 'pointer',
        }}>
          + All
        </button>
      </div>
      <DayBar day={day} setDay={setDay} />
      <StatsStrip />
      <ApptList expanded={expanded} setExpanded={setExpanded} />
    </>
  )
}

/* ═════════════════════════  Option C — Inline push-down drawer  ═════════════════════════ */

function OptionC() {
  const [day, setDay] = useState<1 | 2 | 3>(ACTIVE_EVENT.dayOfEvent as 1 | 2 | 3)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const otherMatches = q
    ? OTHER_STORES.filter(s => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q))
    : OTHER_STORES

  return (
    <>
      <div style={{
        padding: '12px 16px', background: C.cream,
        borderBottom: `1px solid ${C.pearl}`,
      }}>
        <button onClick={() => setDrawerOpen(d => !d)} style={{
          width: '100%', background: 'none', border: 'none', textAlign: 'left',
          padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: C.ink }}>{ACTIVE_EVENT.name}</span>
              <LiveDot />
            </div>
            <div style={{ fontSize: 12, color: C.mist, marginTop: 2 }}>
              {ACTIVE_EVENT.city} · Day {ACTIVE_EVENT.dayOfEvent} of {ACTIVE_EVENT.totalDays}
            </div>
          </div>
          <span style={{
            fontSize: 16, color: C.darkGreen,
            transition: 'transform .18s',
            transform: drawerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▾</span>
        </button>
      </div>

      {drawerOpen && (
        <div style={{ background: C.white, borderBottom: `1px solid ${C.pearl}` }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.cream2}` }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="🔎 Find event or store…"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                background: C.cream, border: `1px solid ${C.pearl}`,
                fontSize: 13, outline: 'none',
              }}
            />
          </div>

          <div style={{ padding: '6px 14px', fontSize: 9, fontWeight: 900, letterSpacing: '.08em', color: C.mist, textTransform: 'uppercase' }}>
            My events
          </div>
          {OTHER_ASSIGNED
            .filter(ev => !q || ev.name.toLowerCase().includes(q) || ev.city.toLowerCase().includes(q))
            .map(ev => (
              <button key={ev.id} onClick={() => setDrawerOpen(false)} style={{
                width: '100%', padding: '10px 14px', background: 'none',
                border: 'none', borderBottom: `1px solid ${C.cream2}`,
                textAlign: 'left', cursor: 'pointer',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{ev.name}</div>
                <div style={{ fontSize: 11, color: C.mist }}>{ev.city} · {ev.when} · {ev.count} appts</div>
              </button>
            ))}

          {q && (
            <>
              <div style={{ padding: '6px 14px', fontSize: 9, fontWeight: 900, letterSpacing: '.08em', color: C.mist, textTransform: 'uppercase' }}>
                Other stores
              </div>
              {otherMatches.length === 0 ? (
                <div style={{ padding: '10px 14px', fontSize: 12, color: C.fog, fontStyle: 'italic' }}>
                  No matches
                </div>
              ) : otherMatches.map(s => (
                <button key={s.id} style={{
                  width: '100%', padding: '10px 14px', background: 'none',
                  border: 'none', borderBottom: `1px solid ${C.cream2}`,
                  textAlign: 'left', cursor: 'pointer',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: C.mist }}>{s.city} · not assigned</div>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <DayBar day={day} setDay={setDay} />
      <StatsStrip />
      <ApptList expanded={expanded} setExpanded={setExpanded} />
    </>
  )
}

/* ═════════════════════════  Option D — "View all events" link  ═════════════════════════ */

function OptionD() {
  const [day, setDay] = useState<1 | 2 | 3>(ACTIVE_EVENT.dayOfEvent as 1 | 2 | 3)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showingList, setShowingList] = useState(false)

  if (showingList) {
    // Simulated "All events" list view
    return (
      <>
        <div style={{ padding: '12px 16px', background: C.cream, borderBottom: `1px solid ${C.pearl}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setShowingList(false)} style={{
            background: 'none', border: 'none', color: C.darkGreen,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0,
          }}>← Back</button>
          <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>All events</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, background: C.cream, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[{ ...ACTIVE_EVENT, when: 'Apr 21 – 23', count: 21, active: true }, ...OTHER_ASSIGNED.map(e => ({ ...e, active: false }))].map(ev => (
            <div key={ev.id} onClick={() => setShowingList(false)} style={{
              background: C.white, border: `1px solid ${ev.active ? C.green : C.pearl}`,
              borderRadius: 12, padding: 12, cursor: 'pointer',
              borderLeft: `4px solid ${ev.active ? C.green : C.pearl}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: C.ink }}>{ev.name}</span>
                {ev.active && <LiveDot />}
              </div>
              <div style={{ fontSize: 12, color: C.mist, marginTop: 2 }}>
                {ev.city} · {ev.when} · {ev.count} appts
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <div style={{
        padding: '8px 16px', background: C.cream,
        borderBottom: `1px solid ${C.cream2}`,
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button onClick={() => setShowingList(true)} style={{
          background: 'none', border: 'none', color: C.darkGreen,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0,
        }}>All events →</button>
      </div>
      <HeaderLine />
      <DayBar day={day} setDay={setDay} />
      <StatsStrip />
      <ApptList expanded={expanded} setExpanded={setExpanded} />
    </>
  )
}

/* ═════════════════════════  Page  ═════════════════════════ */

const OPTIONS = [
  { letter: 'A', label: 'Dropdown Selector',     desc: 'Tappable dropdown at top. Opens a list of assigned events plus a "Browse all events" link.' },
  { letter: 'B', label: 'Pill / Chip Buttons',   desc: 'Horizontal scrollable pills in the header. Active event is solid green; inactive are outlined. "+ All" chip at the end.' },
  { letter: 'C', label: 'Inline Push-Down Drawer', desc: 'Tap the store name to push a drawer down inline (not overlay) with a search field. Appointment list slides down below it.' },
  { letter: 'D', label: '"View all events" link', desc: 'Clean appointments screen with a small "All events →" link. Tap to navigate to the cards list. Simplest approach.' },
]

const COMPONENTS: Record<string, () => JSX.Element> = {
  A: OptionA, B: OptionB, C: OptionC, D: OptionD,
}

export default function ApptPreview() {
  const showcase = [
    OPTIONS.find(o => o.letter === 'A')!,
    OPTIONS.find(o => o.letter === 'C')!,
  ]
  return (
    <div style={{
      minHeight: '100vh', background: '#111827', color: C.white,
      padding: '20px 16px 60px', fontFamily: '-apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>Mobile Appts — Dropdown vs Push-Down Drawer</h1>
        <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 24, lineHeight: 1.5, maxWidth: 700 }}>
          Same appointment list on both — only the event switcher differs. Tap the header on either phone to see it in action. On Option C, watch the appointment list slide down as the drawer inserts itself inline — try the search too ("ten" surfaces Tempe stores, "jar" finds Jared).
        </div>

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
          {showcase.map(o => {
            const Component = COMPONENTS[o.letter]
            return (
              <div key={o.letter} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ marginBottom: 14, maxWidth: 375 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.12em', color: C.green, textTransform: 'uppercase' }}>
                    Option {o.letter}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: C.white, marginTop: 2 }}>
                    {o.label}
                  </div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4, lineHeight: 1.5 }}>
                    {o.desc}
                  </div>
                  <div style={{
                    marginTop: 10, padding: '6px 10px', borderRadius: 6,
                    background: 'rgba(64,145,108,.15)', border: `1px solid ${C.green}`,
                    fontSize: 11, fontWeight: 700, color: C.greenPale,
                  }}>
                    👆 {o.letter === 'A' ? 'Tap the dropdown at top to see events' : 'Tap store name to push drawer down — list slides below'}
                  </div>
                </div>
                <PhoneFrame>
                  <StatusBar />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                    <Component />
                  </div>
                  <BottomNav />
                </PhoneFrame>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
