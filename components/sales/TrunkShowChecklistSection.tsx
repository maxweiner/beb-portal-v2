'use client'

// Per-trunk-show checklist (Trunk Comms phase 10).
//
// Sources:
//   - Master checklist items (master_item_id NOT NULL) — copied
//     by the AFTER-INSERT trigger on trunk_shows
//   - Schedule items (linked_template_id NOT NULL, master_item_id
//     NULL) — copied by phase 4's schedule trigger
//   - Ad-hoc items (both NULL) — added by rep/admin via this UI
//
// Sort: due_date ascending. Color: green = future, amber = within
// 7 days, red = overdue.
//
// Auto-check is wired in the send endpoint (phase 5) for
// send_communication items. Marketing-action auto-checks are
// deferred to phase 11 pending design discussion.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'
import type { CommunicationAssignedRole, TrunkShowChecklistItem } from '@/types'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  trunkShowId: string
  setNav?: (n: NavPage) => void
}

const URGENT_DAYS = 7

export default function TrunkShowChecklistSection({ trunkShowId, setNav }: Props) {
  const { user, setCommsSendIntent } = useApp()
  const [open, setOpen] = useState(true)
  const [rows, setRows] = useState<TrunkShowChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  async function reload() {
    setLoading(true)
    const { data } = await supabase
      .from('trunk_show_checklist_items')
      .select('*')
      .eq('trunk_show_id', trunkShowId)
      .order('due_date', { ascending: true })
    setRows((data || []) as TrunkShowChecklistItem[])
    setLoading(false)
  }
  useEffect(() => { reload() }, [trunkShowId])

  const visible = useMemo(() => rows.filter(r => showCompleted || !r.is_completed), [rows, showCompleted])
  const openCount = rows.filter(r => !r.is_completed).length
  const overdueCount = rows.filter(r => !r.is_completed && r.due_date < todayIso()).length

  async function setChecked(item: TrunkShowChecklistItem, next: boolean) {
    if (!next) {
      const ok = confirm(`Are you sure?\n\nThis will mark "${item.title}" as not done.`)
      if (!ok) return
    }
    const log = Array.isArray(item.previous_completion_log) ? item.previous_completion_log : []
    const update: any = {
      is_completed: next,
      completed_at: next ? new Date().toISOString() : null,
      completed_by_user_id: next ? user?.id || null : null,
      previous_completion_log: [
        ...log,
        { action: next ? 'check' : 'uncheck', user_id: user?.id || null, timestamp: new Date().toISOString() },
      ],
    }
    if (next === false) update.linked_send_id = null  // dissociate prior send
    const { error } = await supabase
      .from('trunk_show_checklist_items').update(update).eq('id', item.id)
    if (error) { alert(error.message); return }
    reload()
  }

  function openAction(item: TrunkShowChecklistItem) {
    if (item.linked_action_type === 'send_communication' && item.linked_template_id) {
      setCommsSendIntent({ trunkShowId: item.trunk_show_id, templateId: item.linked_template_id })
      setNav?.('trunk-communications')
      return
    }
    if (item.linked_action_type === 'marketing_postcard' || item.linked_action_type === 'marketing_proof') {
      setNav?.('marketing')
      return
    }
    // none — no nav
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontFamily: 'inherit', cursor: 'pointer', padding: 0 }}
      >
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: 0 }}>
          <span>
            ✅ Pre-event checklist
            {openCount > 0 && <span style={{ color: 'var(--mist)', fontWeight: 600 }}> · {openCount} open</span>}
            {overdueCount > 0 && <span style={{ color: '#dc2626', fontWeight: 800 }}> · {overdueCount} overdue</span>}
          </span>
          <span style={{ fontSize: 11, color: 'var(--mist)' }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Checkbox
              checked={showCompleted}
              onChange={setShowCompleted}
              size={14}
              label="Show completed"
              labelStyle={{ fontSize: 11, color: 'var(--mist)' }}
            />
            <button onClick={() => setShowAdd(true)} className="btn-outline btn-xs">+ Ad-hoc item</button>
          </div>

          {loading ? (
            <div style={{ color: 'var(--mist)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mist)', padding: '12px 0', textAlign: 'center' }}>
              {showCompleted ? 'No checklist items.' : 'All clear — no open items.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visible.map(item => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  onToggle={(next) => setChecked(item, next)}
                  onOpenAction={() => openAction(item)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AdHocAddModal
          trunkShowId={trunkShowId}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); reload() }}
        />
      )}
    </div>
  )
}

function ChecklistRow({
  item, onToggle, onOpenAction,
}: {
  item: TrunkShowChecklistItem
  onToggle: (next: boolean) => void
  onOpenAction: () => void
}) {
  const today = todayIso()
  const due = item.due_date
  let dueColor: { bg: string; fg: string } = { bg: 'var(--cream2)', fg: 'var(--mist)' }
  if (!item.is_completed) {
    if (due < today) dueColor = { bg: '#fdecea', fg: '#7a1f0f' }
    else if (daysUntil(due) <= URGENT_DAYS) dueColor = { bg: '#fff8e1', fg: '#7a5b00' }
    else dueColor = { bg: '#e8f5e9', fg: '#1b5e20' }
  }
  const titleClickable = !item.is_completed && item.linked_action_type !== 'none'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px', borderRadius: 6,
      background: item.is_completed ? 'var(--cream2)' : '#fff',
      border: '1px solid var(--cream2)',
      opacity: item.is_completed ? 0.6 : 1,
    }}>
      <div style={{ marginTop: 4, flexShrink: 0 }}>
        <Checkbox
          checked={item.is_completed}
          onChange={onToggle}
          size={18}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {titleClickable ? (
          <button onClick={onOpenAction}
            style={{
              fontFamily: 'inherit', background: 'none', border: 'none', padding: 0,
              fontSize: 13, fontWeight: 700, color: 'var(--green-dark)',
              cursor: 'pointer', textAlign: 'left', textDecoration: 'underline',
            }}>{item.title}</button>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', textDecoration: item.is_completed ? 'line-through' : undefined }}>{item.title}</div>
        )}
        {item.description && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{item.description}</div>
        )}
        {item.is_completed && item.completed_at && (
          <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4 }}>
            ✓ Done {new Date(item.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
        background: dueColor.bg, color: dueColor.fg, whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {item.is_completed ? 'Done' : formatDue(item.due_date)}
      </span>
    </div>
  )
}

function AdHocAddModal({
  trunkShowId, onClose, onAdded,
}: { trunkShowId: string; onClose: () => void; onAdded: () => void }) {
  const { user } = useApp()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })
  const [role, setRole] = useState<CommunicationAssignedRole>('rep')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || !dueDate) { alert('Title and due date required'); return }
    setSaving(true)
    const { error } = await supabase.from('trunk_show_checklist_items').insert({
      trunk_show_id: trunkShowId,
      master_item_id: null,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate,
      assigned_to_role: role,
      linked_action_type: 'none',
      linked_template_id: null,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    onAdded()
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16,
      }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, maxWidth: 460, width: '100%', marginTop: 50 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>+ Ad-hoc checklist item</div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label className="fl">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label className="fl">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field">
            <label className="fl">Due date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="fl">Assigned to</label>
            <select value={role} onChange={e => setRole(e.target.value as CommunicationAssignedRole)}>
              <option value="rep">Rep</option>
              <option value="admin">Admin</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysUntil(iso: string): number {
  const target = new Date(iso + 'T12:00:00').getTime()
  const today  = new Date(todayIso() + 'T12:00:00').getTime()
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

function formatDue(iso: string): string {
  const d = daysUntil(iso)
  const date = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (d < 0)  return `${Math.abs(d)}d overdue · ${date}`
  if (d === 0) return `Due today · ${date}`
  if (d <= URGENT_DAYS) return `Due in ${d}d · ${date}`
  return `Due ${date}`
}
