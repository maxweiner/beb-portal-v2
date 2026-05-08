'use client'

// Dashboard widget — surfaces open trunk-show checklist items
// the user needs to act on.
//
// Visibility (per request): trunk_admin, sales_rep, superadmin only.
// Buyers + accounting + marketing + plain admins don't see it.
// (Partners are normally also superadmin role-wise, so they see it
//  via the role check.)
//
// Content rules:
// - is_completed = false
// - due_date >= today − 7 days  (anything older is treated as
//   abandoned; the prune migration deletes outright, but the
//   filter is here as defense-in-depth)
// - due_date <= today + 7 days  (only stuff coming up in the
//   next week, plus anything overdue but still actionable)
//
// Layout: collapsible panel anchored to the top of the dashboard.
// Header is always visible with a 🔔 badge showing the count.
// Default state: collapsed when no overdue items, EXPANDED when
// any item is overdue (so a red item never hides until clicked).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'
import type { CommunicationLinkedAction } from '@/types'

interface Props {
  setNav?: (n: NavPage) => void
}

interface Row {
  id: string
  trunk_show_id: string
  title: string
  due_date: string
  linked_action_type: CommunicationLinkedAction
  linked_template_id: string | null
  store_name: string | null
}

const URGENT_DAYS = 7
const STALE_DAYS = 7   // items older than 7 days overdue are hidden
const STORAGE_KEY = 'beb-dashboard-overdue-open'   // remembers the user's manual collapse choice across sessions

// Roles that should see this widget. Anyone else gets nothing
// (the parent dashboard renders the widget unconditionally; the
// gate lives here so only one place has to know the rule).
const ALLOWED_ROLES = new Set(['superadmin', 'sales_rep', 'trunk_admin'])

export default function CommsRemindersWidget({ setNav }: Props) {
  const { user, setCommsSendIntent, setTrunkShowIntent } = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<boolean | null>(null)  // null = not yet decided

  const allowed = !!user?.role && ALLOWED_ROLES.has(user.role)

  useEffect(() => {
    if (!allowed) { setLoading(false); return }
    let cancelled = false
    void (async () => {
      const today = todayIso()
      const upper = (() => {
        const d = new Date(today + 'T12:00:00')
        d.setDate(d.getDate() + URGENT_DAYS)
        return d.toISOString().slice(0, 10)
      })()
      const lower = (() => {
        const d = new Date(today + 'T12:00:00')
        d.setDate(d.getDate() - STALE_DAYS)
        return d.toISOString().slice(0, 10)
      })()
      const { data } = await supabase
        .from('trunk_show_checklist_items')
        .select(`
          id, trunk_show_id, title, due_date, linked_action_type, linked_template_id,
          trunk_show:trunk_shows(store:trunk_show_stores(name))
        `)
        .eq('is_completed', false)
        .gte('due_date', lower)
        .lte('due_date', upper)
        .order('due_date', { ascending: true })
      if (cancelled) return
      const mapped = (data || []).map((r: any) => ({
        id: r.id,
        trunk_show_id: r.trunk_show_id,
        title: r.title,
        due_date: r.due_date,
        linked_action_type: r.linked_action_type,
        linked_template_id: r.linked_template_id,
        store_name: extractStoreName(r),
      })) as Row[]
      setRows(mapped)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [allowed])

  const sorted = useMemo(() => [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date)), [rows])
  const today = todayIso()
  const overdueCount = sorted.filter(r => r.due_date < today).length
  const dueSoonCount = sorted.filter(r => r.due_date >= today).length

  // Initial state resolution — runs once after the data loads:
  //   1. Honor the user's last manual toggle (localStorage) when set.
  //   2. Otherwise fall back to default-open-when-overdue, default-
  //      closed-otherwise so a red item never silently hides.
  useEffect(() => {
    if (loading || open !== null) return
    let saved: boolean | null = null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === '1') saved = true
      else if (raw === '0') saved = false
    } catch { /* localStorage unavailable */ }
    setOpen(saved !== null ? saved : overdueCount > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Persist manual toggles. Skip the initial auto-set above so we
  // only record explicit user decisions (open === null guard handles
  // that — by the time persistence fires, open is a real boolean).
  useEffect(() => {
    if (open === null) return
    try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0') } catch {}
  }, [open])

  if (!allowed) return null
  if (loading) return null
  if (sorted.length === 0) return null

  function openRow(row: Row) {
    if (row.linked_action_type === 'send_communication' && row.linked_template_id) {
      setCommsSendIntent({ trunkShowId: row.trunk_show_id, templateId: row.linked_template_id })
      setNav?.('trunk-communications')
      return
    }
    // For every other action type — including marketing_postcard /
    // marketing_proof — drop the user directly onto the specific
    // trunk show via the existing intent. Saves them from re-finding
    // the row in a long list.
    setTrunkShowIntent({ trunkShowId: row.trunk_show_id })
    setNav?.('trunk-shows')
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          fontFamily: 'inherit', cursor: 'pointer', padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span style={{ fontSize: 18 }}>🔔</span>
            {(overdueCount > 0 || dueSoonCount > 0) && (
              <span style={{
                position: 'absolute', top: -4, right: -8,
                minWidth: 18, height: 18, padding: '0 5px',
                borderRadius: 9, background: overdueCount > 0 ? '#dc2626' : '#d4a017',
                color: '#fff', fontSize: 10, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, boxShadow: '0 0 0 2px #fff',
              }}>{overdueCount + dueSoonCount}</span>
            )}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>
            Trunk-show tasks needing attention
          </span>
          {overdueCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
              background: '#fdecea', color: '#7a1f0f', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>{overdueCount} overdue</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>{open ? '▾ Hide' : '▸ Show'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map(r => <RowItem key={r.id} row={r} onOpen={() => openRow(r)} />)}
        </div>
      )}
    </div>
  )
}

function RowItem({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const today = todayIso()
  const overdue = row.due_date < today
  const dueSoon = !overdue && daysUntil(row.due_date) <= URGENT_DAYS
  const color = overdue
    ? { bg: '#fdecea', fg: '#7a1f0f' }
    : dueSoon
    ? { bg: '#fff8e1', fg: '#7a5b00' }
    : { bg: '#e8f5e9', fg: '#1b5e20' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '8px 10px', borderRadius: 6,
      background: '#fff', border: '1px solid var(--cream2)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
          {row.store_name || 'Trunk show'}
        </div>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
        background: color.bg, color: color.fg, whiteSpace: 'nowrap',
      }}>
        {overdue
          ? `${Math.abs(daysUntil(row.due_date))}d overdue`
          : daysUntil(row.due_date) === 0 ? 'Due today'
          : `Due in ${daysUntil(row.due_date)}d`}
      </span>
      <button onClick={onOpen} className="btn-primary btn-xs" style={{ flexShrink: 0 }}>Open</button>
    </div>
  )
}

function extractStoreName(r: any): string | null {
  const ts = Array.isArray(r.trunk_show) ? r.trunk_show[0] : r.trunk_show
  const store = Array.isArray(ts?.store) ? ts?.store[0] : ts?.store
  return store?.name ?? null
}

function todayIso(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysUntil(iso: string): number {
  const target = new Date(iso + 'T12:00:00').getTime()
  const today  = new Date(todayIso() + 'T12:00:00').getTime()
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}
