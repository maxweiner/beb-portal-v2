'use client'

// Master checklist admin (Trunk Comms phase 9). Defines the
// canonical task list that every new trunk show is auto-populated
// with. Edits to a master item do NOT retroactively change items
// already created on existing trunk shows (per spec rule 6e).
//
// Items can have a "linked action" so the per-show checklist
// can navigate the rep into the right action surface:
//   - send_communication → links to a template; clicking the
//     item opens the send flow with that template prefilled.
//   - marketing_postcard / marketing_proof → cross-nav to the
//     Marketing module (wired in phase 10/11).
//   - none → manual checkbox only.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  CommunicationAssignedRole, CommunicationLinkedAction,
  CommunicationTemplate, TrunkShowChecklistMasterItem,
} from '@/types'

interface Props {
  canEdit: boolean
  onClose: () => void
}

export default function MasterChecklist({ canEdit, onClose }: Props) {
  const [rows, setRows] = useState<TrunkShowChecklistMasterItem[]>([])
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<TrunkShowChecklistMasterItem | null>(null)
  const [showNew, setShowNew] = useState(false)

  async function reload() {
    setLoading(true)
    const [{ data: items }, { data: tpls }] = await Promise.all([
      supabase
        .from('trunk_show_checklist_master')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('communication_templates')
        .select('*')
        .eq('is_active', true)
        .order('name'),
    ])
    setRows((items || []) as TrunkShowChecklistMasterItem[])
    setTemplates((tpls || []) as CommunicationTemplate[])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  const visible = rows.filter(r => showArchived || r.is_active)

  async function move(id: string, direction: -1 | 1) {
    const idx = visible.findIndex(r => r.id === id)
    const swapWith = visible[idx + direction]
    if (!swapWith) return
    const a = visible[idx], b = swapWith
    await Promise.all([
      supabase.from('trunk_show_checklist_master').update({ display_order: b.display_order }).eq('id', a.id),
      supabase.from('trunk_show_checklist_master').update({ display_order: a.display_order }).eq('id', b.id),
    ])
    reload()
  }

  async function toggleActive(item: TrunkShowChecklistMasterItem) {
    await supabase
      .from('trunk_show_checklist_master')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    reload()
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <button onClick={onClose} className="btn-outline btn-xs" style={{ marginBottom: 6 }}>← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>🗒 Master checklist</h1>
        </div>
        {canEdit && (
          <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New item</button>
        )}
      </div>

      <div style={{ background: 'var(--cream2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Items here are copied to <strong>every new trunk show</strong> at creation time. Edits to a master item don't change existing trunk shows — they only affect newly-created ones. Archive (don't delete) when a task no longer applies.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mist)' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
            style={{ width: 16, height: 16, padding: 0, margin: 0, appearance: 'auto', WebkitAppearance: 'checkbox' } as React.CSSProperties}
          /> Show archived
        </label>
        <span style={{ fontSize: 12, color: 'var(--mist)' }}>{visible.length} item{visible.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 13,
        }}>
          {showArchived ? 'No items yet.' : 'No active items. Click "+ New item" to add the first one.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 80px 90px 1fr 110px 80px 80px',
            background: 'var(--cream2)', padding: '8px 12px', gap: 8,
            fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <div></div>
            <div>Title</div>
            <div>Days</div>
            <div>Role</div>
            <div>Action</div>
            <div></div>
            <div>Status</div>
            <div></div>
          </div>
          {visible.map((r, idx) => (
            <MasterRow
              key={r.id}
              row={r}
              templates={templates}
              isFirst={idx === 0}
              isLast={idx === visible.length - 1}
              canEdit={canEdit}
              onUp={() => move(r.id, -1)}
              onDown={() => move(r.id, 1)}
              onEdit={() => setEditing(r)}
              onToggleActive={() => toggleActive(r)}
            />
          ))}
        </div>
      )}

      {(editing || showNew) && (
        <MasterEditorModal
          item={editing}
          templates={templates}
          existingMaxOrder={Math.max(0, ...rows.map(r => r.display_order))}
          onClose={() => { setEditing(null); setShowNew(false) }}
          onSaved={() => { setEditing(null); setShowNew(false); reload() }}
        />
      )}
    </div>
  )
}

function MasterRow({
  row, templates, isFirst, isLast, canEdit, onUp, onDown, onEdit, onToggleActive,
}: {
  row: TrunkShowChecklistMasterItem
  templates: CommunicationTemplate[]
  isFirst: boolean
  isLast: boolean
  canEdit: boolean
  onUp: () => void
  onDown: () => void
  onEdit: () => void
  onToggleActive: () => void
}) {
  const tpl = row.linked_template_id ? templates.find(t => t.id === row.linked_template_id) : null
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr 80px 90px 1fr 110px 80px 80px',
      padding: '10px 12px', borderTop: '1px solid var(--cream2)', alignItems: 'center', gap: 8,
      fontSize: 13, color: 'var(--ink)',
      opacity: row.is_active ? 1 : 0.5,
    }}>
      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button onClick={onUp} disabled={isFirst} style={miniArrow}>▲</button>
          <button onClick={onDown} disabled={isLast} style={miniArrow}>▼</button>
        </div>
      ) : <div />}
      <div>
        <div style={{ fontWeight: 700 }}>{row.title}</div>
        {row.description && <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{row.description}</div>}
      </div>
      <div>{row.days_before_event_start}</div>
      <div style={{ textTransform: 'capitalize' }}>{row.assigned_to_role}</div>
      <div>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          {actionLabel(row.linked_action_type)}{tpl ? ` · ${tpl.name}` : ''}
        </span>
      </div>
      <div></div>
      <div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
          background: row.is_active ? 'var(--green-pale)' : 'var(--cream2)',
          color: row.is_active ? 'var(--green-dark)' : 'var(--mist)',
        }}>{row.is_active ? 'Active' : 'Archived'}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {canEdit && <button onClick={onEdit} className="btn-outline btn-xs">Edit</button>}
        {canEdit && <button onClick={onToggleActive} className="btn-outline btn-xs">{row.is_active ? '🗄' : '↺'}</button>}
      </div>
    </div>
  )
}

function MasterEditorModal({
  item, templates, existingMaxOrder, onClose, onSaved,
}: {
  item: TrunkShowChecklistMasterItem | null
  templates: CommunicationTemplate[]
  existingMaxOrder: number
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle]               = useState(item?.title || '')
  const [description, setDescription]   = useState(item?.description || '')
  const [days, setDays]                 = useState(String(item?.days_before_event_start ?? '30'))
  const [assignedRole, setAssignedRole] = useState<CommunicationAssignedRole>(item?.assigned_to_role || 'rep')
  const [linkedAction, setLinkedAction] = useState<CommunicationLinkedAction>(item?.linked_action_type || 'none')
  const [linkedTpl, setLinkedTpl]       = useState<string>(item?.linked_template_id || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) { alert('Title is required'); return }
    const daysNum = Number(days)
    if (!Number.isInteger(daysNum) || daysNum < 0) { alert('Days must be a non-negative integer'); return }
    if (linkedAction === 'send_communication' && !linkedTpl) {
      alert('Pick a template for the send_communication action.'); return
    }
    setSaving(true)
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      days_before_event_start: daysNum,
      assigned_to_role: assignedRole,
      linked_action_type: linkedAction,
      linked_template_id: linkedAction === 'send_communication' ? linkedTpl : null,
    }
    let error: any = null
    if (item) {
      ({ error } = await supabase.from('trunk_show_checklist_master').update(payload).eq('id', item.id))
    } else {
      payload.display_order = existingMaxOrder + 1
      payload.is_active = true
      ;({ error } = await supabase.from('trunk_show_checklist_master').insert(payload))
    }
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto',
      }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 520, width: '100%', marginTop: 30 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
          {item ? 'Edit master item' : 'New master item'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Confirm postcard order" />
          </Field>
          <Field label="Description (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ width: '100%', fontFamily: 'inherit' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Days before event">
              <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} />
            </Field>
            <Field label="Assigned to">
              <select value={assignedRole} onChange={e => setAssignedRole(e.target.value as CommunicationAssignedRole)}>
                <option value="rep">Rep</option>
                <option value="admin">Admin</option>
                <option value="both">Both</option>
              </select>
            </Field>
          </div>
          <Field label="Linked action">
            <select value={linkedAction} onChange={e => {
              const next = e.target.value as CommunicationLinkedAction
              setLinkedAction(next)
              if (next !== 'send_communication') setLinkedTpl('')
            }}>
              <option value="none">None — manual checkbox</option>
              <option value="send_communication">Send communication (template)</option>
              <option value="marketing_postcard">Marketing — postcard</option>
              <option value="marketing_proof">Marketing — proof</option>
            </select>
          </Field>
          {linkedAction === 'send_communication' && (
            <Field label="Template">
              <select value={linkedTpl} onChange={e => setLinkedTpl(e.target.value)}>
                <option value="">— Select template —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="fl">{label}</label>
      {children}
    </div>
  )
}

function actionLabel(a: CommunicationLinkedAction): string {
  switch (a) {
    case 'send_communication':  return 'Send letter'
    case 'marketing_postcard':  return 'Marketing — postcard'
    case 'marketing_proof':     return 'Marketing — proof'
    default: return '—'
  }
}

const miniArrow: React.CSSProperties = {
  width: 24, height: 18, padding: 0,
  fontSize: 9, fontWeight: 700,
  background: 'var(--cream2)', color: 'var(--ash)',
  border: '1px solid var(--pearl)', borderRadius: 3,
  cursor: 'pointer',
}
