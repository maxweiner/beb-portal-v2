'use client'

// Sales rep dashboard — five sections per spec:
//   1. Upcoming shows (trunk + trade, assigned to me, sorted by date)
//   2. Special requests for my upcoming trunk shows
//   3. Leads needing follow-up
//   4. Prospecting notes (quick-add + recent)
//   5. Spiffs earned (this month + YTD across my trunk shows)
//
// No leaderboard, no commission display (per spec sections 2.5
// + Section 10).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'
import type { Lead, TrunkShow, TrunkShowStatus } from '@/types'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

interface TradeShowLite {
  id: string
  name: string
  start_date: string
  end_date: string
  venue_city: string | null
  venue_state: string | null
}
interface TrunkShowLite extends TrunkShow {
  store_name?: string
}
interface SpecialRequestLite {
  id: string
  trunk_show_id: string
  request_text: string
  status: 'open' | 'acknowledged' | 'completed'
  created_at: string
}
interface SpiffLite {
  id: string
  amount: number
  paid_at: string | null
  created_at: string
  trunk_show_id: string
}
interface ProspectingNote {
  id: string
  note_text: string
  created_at: string
}

export default function SalesRepDashboard({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user, stores } = useApp()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const firstName = (user?.name || '').split(' ')[0] || ''

  const [upcomingTrunk, setUpcomingTrunk] = useState<TrunkShowLite[]>([])
  const [upcomingTrade, setUpcomingTrade] = useState<TradeShowLite[]>([])
  const [openRequests, setOpenRequests] = useState<SpecialRequestLite[]>([])
  const [followLeads, setFollowLeads] = useState<Lead[]>([])
  const [spiffs, setSpiffs] = useState<SpiffLite[]>([])
  const [notes, setNotes] = useState<ProspectingNote[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [loaded, setLoaded] = useState(false)

  const storesById = useMemo(() => new Map(stores.map(s => [s.id, s])), [stores])

  async function reload() {
    if (!user) return
    const todayIso = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()
    const sevenDaysOut = (() => {
      const d = new Date(); d.setDate(d.getDate() + 7)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()

    // 1. Trunk shows assigned to me, end_date >= today, not cancelled.
    const { data: trunks } = await supabase.from('trunk_shows')
      .select('id, store_id, start_date, end_date, assigned_rep_id, status, notes, created_at, updated_at, deleted_at')
      .eq('assigned_rep_id', user.id)
      .is('deleted_at', null)
      .gte('end_date', todayIso)
      .neq('status', 'cancelled')
      .order('start_date', { ascending: true })
    setUpcomingTrunk((trunks || []).map(t => ({ ...t, store_name: storesById.get(t.store_id)?.name } as any)))

    // 2. Trade shows where I'm staffed (or upcoming partner-wide if I'm admin).
    //    Use trade_show_staff join + trade_show date filter.
    const { data: staffed } = await supabase.from('trade_show_staff')
      .select('trade_show_id')
      .eq('user_id', user.id)
    const staffedIds = (staffed || []).map(r => r.trade_show_id as string)
    if (staffedIds.length > 0) {
      const { data: trades } = await supabase.from('trade_shows')
        .select('id, name, start_date, end_date, venue_city, venue_state')
        .in('id', staffedIds).is('deleted_at', null)
        .gte('end_date', todayIso)
        .order('start_date', { ascending: true })
      setUpcomingTrade((trades || []) as TradeShowLite[])
    } else {
      setUpcomingTrade([])
    }

    // 3. Open special requests for my upcoming trunk shows.
    const trunkIds = (trunks || []).map(t => t.id as string)
    if (trunkIds.length > 0) {
      const { data: reqs } = await supabase.from('trunk_show_special_requests')
        .select('id, trunk_show_id, request_text, status, created_at')
        .in('trunk_show_id', trunkIds)
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
      setOpenRequests((reqs || []) as SpecialRequestLite[])
    } else {
      setOpenRequests([])
    }

    // 4. Leads needing follow-up: assigned to me, follow_up_date <= +7d
    //    OR status='new' and created >3 days ago.
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
    const { data: leadRows } = await supabase.from('leads')
      .select('*')
      .eq('assigned_rep_id', user.id)
      .is('deleted_at', null)
      .neq('status', 'converted').neq('status', 'dead')
      .order('follow_up_date', { ascending: true, nullsFirst: false })
      .limit(50)
    const filteredLeads = (leadRows || []).filter(l =>
      (l.follow_up_date && l.follow_up_date <= sevenDaysOut)
      || (l.status === 'new' && l.created_at < threeDaysAgo)
    )
    setFollowLeads(filteredLeads.slice(0, 6) as Lead[])

    // 5. Spiffs earned (across my assigned trunk shows, ever).
    if (trunkIds.length > 0) {
      const { data: allMyTrunks } = await supabase.from('trunk_shows')
        .select('id').eq('assigned_rep_id', user.id).is('deleted_at', null)
      const allIds = (allMyTrunks || []).map(t => t.id as string)
      if (allIds.length > 0) {
        const { data: sps } = await supabase.from('trunk_show_spiffs')
          .select('id, amount, paid_at, created_at, trunk_show_id')
          .in('trunk_show_id', allIds)
        setSpiffs((sps || []).map(s => ({ ...s, amount: Number(s.amount) })) as SpiffLite[])
      } else {
        setSpiffs([])
      }
    } else {
      setSpiffs([])
    }

    // 6. Prospecting notes (mine, recent 5)
    const { data: notesRows } = await supabase.from('sales_rep_prospecting_notes')
      .select('id, note_text, created_at')
      .eq('rep_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
    setNotes((notesRows || []) as ProspectingNote[])

    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [user?.id, stores.length])

  // Combined upcoming list (chronological).
  const upcomingShows = useMemo(() => {
    const items: { kind: 'trunk' | 'trade'; id: string; title: string; sub: string; start: string; end: string }[] = []
    for (const t of upcomingTrunk) {
      items.push({
        kind: 'trunk', id: t.id,
        title: t.store_name || 'Trunk Show',
        sub: [storesById.get(t.store_id)?.city, storesById.get(t.store_id)?.state].filter(Boolean).join(', ') || '',
        start: t.start_date, end: t.end_date,
      })
    }
    for (const t of upcomingTrade) {
      items.push({
        kind: 'trade', id: t.id,
        title: t.name,
        sub: [t.venue_city, t.venue_state].filter(Boolean).join(', '),
        start: t.start_date, end: t.end_date,
      })
    }
    return items.sort((a, b) => a.start.localeCompare(b.start))
  }, [upcomingTrunk, upcomingTrade, storesById])

  const spiffSummary = useMemo(() => {
    const now = new Date()
    const ymThis = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const yyyy = String(now.getFullYear())
    let mo = 0, ytd = 0, paidYtd = 0
    for (const s of spiffs) {
      if (s.created_at.startsWith(yyyy)) ytd += s.amount
      if (s.created_at.startsWith(ymThis)) mo += s.amount
      if (s.paid_at && s.paid_at.startsWith(yyyy)) paidYtd += s.amount
    }
    return { mo, ytd, paidYtd }
  }, [spiffs])

  async function addNote() {
    if (!noteDraft.trim() || !user) return
    const { error } = await supabase.from('sales_rep_prospecting_notes')
      .insert({ rep_user_id: user.id, note_text: noteDraft.trim() })
    if (error) { alert(error.message); return }
    setNoteDraft('')
    void reload()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{
        background: 'linear-gradient(160deg, var(--sidebar-bg) 0%, var(--green-dark) 50%, var(--green) 100%)',
        borderRadius: 16, padding: '20px 24px', marginBottom: 18, color: '#fff',
        boxShadow: '0 4px 16px rgba(29,107,68,.18)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Good {greeting}
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>{firstName || 'there'}</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming shows */}
        <Card title="📅 Upcoming Shows" cta={{ label: 'All trunk shows →', onClick: () => setNav?.('trunk-shows') }}>
          {!loaded ? <Loading /> : upcomingShows.length === 0 ? <Empty msg="Nothing on the calendar." /> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {upcomingShows.slice(0, 6).map(item => (
                <li key={`${item.kind}-${item.id}`}
                  onClick={() => setNav?.(item.kind === 'trunk' ? 'trunk-shows' : 'trade-shows')}
                  style={{
                    background: 'var(--cream)', padding: '10px 12px', borderRadius: 6,
                    cursor: 'pointer',
                    borderLeft: '3px solid ' + (item.kind === 'trunk' ? '#3B82F6' : '#9333EA'),
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                        {item.sub}
                        {item.sub && ' · '}
                        {fmtDateRange(item.start, item.end)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 999, flexShrink: 0,
                      background: item.kind === 'trunk' ? '#DBEAFE' : '#EDE9FE',
                      color:      item.kind === 'trunk' ? '#1E40AF' : '#5B21B6',
                    }}>{item.kind === 'trunk' ? 'Trunk' : 'Trade'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Special requests */}
        <Card title="📣 Open Special Requests">
          {!loaded ? <Loading /> : openRequests.length === 0 ? <Empty msg="No open requests." /> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {openRequests.slice(0, 5).map(r => (
                <li key={r.id} style={{ background: 'var(--cream)', padding: '8px 12px', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                    {r.request_text}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2 }}>
                    {r.status === 'acknowledged' ? '✅ Acknowledged' : '⏳ Open'} · {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Leads to follow up */}
        <Card title="🎯 Leads to Follow Up" cta={{ label: 'All leads →', onClick: () => setNav?.('leads') }}>
          {!loaded ? <Loading /> : followLeads.length === 0 ? <Empty msg="Inbox zero." /> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {followLeads.map(l => (
                <li key={l.id} style={{ background: 'var(--cream)', padding: '8px 12px', borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                        {l.first_name} {l.last_name}
                        {l.company_name && <span style={{ color: 'var(--mist)', fontWeight: 500 }}> · {l.company_name}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                        {l.follow_up_date
                          ? `Follow up ${new Date(l.follow_up_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                          : `New since ${new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      </div>
                    </div>
                    {l.interest_level && <span style={{ fontSize: 14 }}>{l.interest_level === 'hot' ? '🔥' : l.interest_level === 'warm' ? '🌤️' : '❄️'}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Prospecting notes */}
        <Card title="📝 Prospecting Notes">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
              placeholder="Quick log: call, store visit, lead followup…"
              onKeyDown={e => { if (e.key === 'Enter') addNote() }}
              style={{ flex: 1 }} />
            <button onClick={addNote} disabled={!noteDraft.trim()} className="btn-primary btn-xs">+ Log</button>
          </div>
          {!loaded ? <Loading /> : notes.length === 0 ? <Empty msg="Nothing logged yet. Use the box above." /> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.map(n => (
                <li key={n.id} style={{ background: 'var(--cream)', padding: '8px 12px', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{n.note_text}</div>
                  <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2 }}>
                    {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Spiffs */}
        <Card title="💵 Spiffs Earned" subtitle="Total spiffs auto-created across your assigned trunk shows" fullSpan>
          {!loaded ? <Loading /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Stat label="This month" value={USD.format(spiffSummary.mo)} />
              <Stat label="YTD"         value={USD.format(spiffSummary.ytd)} />
              <Stat label="YTD paid"    value={USD.format(spiffSummary.paidYtd)} muted />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({
  title, subtitle, cta, fullSpan, children,
}: {
  title: string
  subtitle?: string
  cta?: { label: string; onClick: () => void }
  fullSpan?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: '18px 20px', gridColumn: fullSpan ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {cta && (
          <button onClick={cta.onClick} className="btn-outline btn-xs">{cta.label}</button>
        )}
      </div>
      {children}
    </div>
  )
}

function Loading() {
  return <div style={{ padding: 12, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>{msg}</div>
}
function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ background: 'var(--cream)', padding: '10px 12px', borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: muted ? 'var(--ash)' : 'var(--green-dark)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function fmtDateRange(start: string, end: string): string {
  if (!start) return ''
  if (!end || start === end) return new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  if (s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${e.getDate()}`
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
