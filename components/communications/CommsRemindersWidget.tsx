'use client'

// Dashboard widget — surfaces open trunk-show checklist items
// the user needs to act on. RLS already scopes the row set:
// admins/partners see everything; reps see only items on
// trunk shows assigned to them. The widget filters further to
// "due within 7 days or overdue" and renders a compact list.

import { useEffect, useState } from 'react'
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

export default function CommsRemindersWidget({ setNav }: Props) {
  const { setCommsSendIntent } = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const today = todayIso()
      const cutoff = (() => {
        const d = new Date(today + 'T12:00:00')
        d.setDate(d.getDate() + URGENT_DAYS)
        return d.toISOString().slice(0, 10)
      })()
      const { data } = await supabase
        .from('trunk_show_checklist_items')
        .select(`
          id, trunk_show_id, title, due_date, linked_action_type, linked_template_id,
          trunk_show:trunk_shows(store:trunk_show_stores(name))
        `)
        .eq('is_completed', false)
        .lte('due_date', cutoff)
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
  }, [])

  function open(row: Row) {
    if (row.linked_action_type === 'send_communication' && row.linked_template_id) {
      setCommsSendIntent({ trunkShowId: row.trunk_show_id, templateId: row.linked_template_id })
      setNav?.('trunk-communications')
      return
    }
    if (row.linked_action_type === 'marketing_postcard' || row.linked_action_type === 'marketing_proof') {
      setNav?.('marketing')
      return
    }
    // Manual item — drop into the trunk show detail so the user can check it off.
    setNav?.('trunk-shows')
  }

  if (loading) return null
  if (rows.length === 0) return null  // hide widget when nothing's pending

  // Sort: overdue first, then upcoming
  const sorted = [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date))

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        🔔 Trunk-show tasks needing attention
        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--mist)' }}>· {sorted.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {sorted.map(r => <Row key={r.id} row={r} onOpen={() => open(r)} />)}
      </div>
    </div>
  )
}

function Row({ row, onOpen }: { row: Row; onOpen: () => void }) {
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
