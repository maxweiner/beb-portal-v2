'use client'

// Buying Communications — master checklist admin.
//
// Mirrors trunk MasterChecklist but:
//   - No assigned_to_role picker (buying is admin/partner only —
//     no rep concept).
//   - linked_action options trimmed to {none, send_communication}.
//     marketing_postcard / marketing_proof don't apply on the
//     buying-comms side (those flows are in the Marketing module).
//
// Edits to a master item do NOT retroactively change items
// already created on existing events. New events going forward
// pick up the latest master.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'
import type { CommunicationTemplate } from '@/types'

interface BuyingMasterItem {
  id: string
  title: string
  description: string | null
  days_before_event_start: number
  linked_action_type: 'none' | 'send_communication' | 'marketing_postcard' | 'marketing_proof'
  linked_template_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Props {
  canEdit: boolean
  onClose: () => void
}

export default function BuyingMasterChecklist({ canEdit, onClose }: Props) {
  const [rows, setRows] = useState<BuyingMasterItem[]>([])
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<BuyingMasterItem | null>(null)
  const [showNew, setShowNew] = useState(false)

  async function reload() {
    setLoading(true)
    const [{ data: items }, { data: tpls }] = await Promise.all([
      supabase
        .from('buying_event_checklist_master').select('*')
        .order('display_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase
        .from('buying_communication_templates').select('*')
        .eq('is_active', true).order('name'),
    ])
    setRows((items || []) as BuyingMasterItem[])
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
      supabase.from('buying_event_checklist_master').update({ display_order: b.display_order }).eq('id', a.id),
      supabase.from('buying_event_checklist_master').update({ display_order: a.display_order }).eq('id', b.id),
    ])
    reload()
  }

  async function toggleActive(item: BuyingMasterItem) {
    await supabase
      .from('buying_event_checklist_master')
      .update({ is_active: !item.is_active }).eq('id', item.id)
    reload()
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <button onClick={onClose} className="btn-outline btn-xs" style={{ marginBottom: 6 }}>← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>🗒 Buying-comms master checklist</h1>
        </div>
        {canEdit && (
          <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New item</button>
        )}
      </div>

      <div style={{ background: 'var(--cream2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Items here are copied to <strong>every new buying event</strong> at creation time. Edits to a master item don&apos;t change existing events — they only affect newly-created ones. Archive (don&apos;t delete) when a task no longer applies.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Checkbox
          checked={showArchived} onChange={setShowArchived} size={16}
          label="Show archived" labelStyle={{ fontSize: 12, color: 'var(--mist)' }}
        />
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
            display: 'grid', gridTemplateColumns: '40px 1.5fr 80px 1.5fr 80px 110px',
            background: 'var(--cream2)', padding: '8px 12px', gap: 8,
            fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <div></div>
            <div>Title</div>
            <div>Days</div>
            <div>Action</div>
            <div>Status</div>
            <div></div>
          </div>
          {visible.map((r, idx) => (
            <MasterRow
              key={r.id} row={r} templates={templates}
              isFirst={idx === 0} isLast={idx === visible.length - 1}
              canEdit={canEdit}
              onUp={() => move(r.id, -1)} onDown={() => move(r.id, 1)}
              onEdit={() => setEditing(r)} onToggleActive={() => toggleActive(r)}
            />
          ))}
        </div>
      )}

      {(editing || showNew) && (
        <MasterEditorModal
          item={editing} templates={templates}
          existingMaxOrder={Math.max(0, ...rows.map(r => r.display_order))}
          onClose={() => { setEditing(null); setShowNew(false) }}
          onSaved={() => { setEditing(null); setShowNew(false); reload() }}
        />
      )}
    </div>
  )
}

function actionLabel(a: string): string {
  if (a === 'send_communication') return 'Send letter'
  return 'Manual checkbox'
}

function MasterRow({
  row, templates, isFirst, isLast, canEdit, onUp, onDown, onEdit, onToggleActive,
}: {
  row: BuyingMasterItem
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
      display: 'grid', gridTemplateColumns: '40px 1.5fr 80px 1.5fr 80px 110px',
      padding: '10px 12px', borderTop: '1px solid var(--cream2)', alignItems: 'center', gap: 8,
      fontSize: 13, color: 'var(--ink)', opacity: row.is_active ? 1 : 0.5,
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
      <div>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          {actionLabel(row.linked_action_type)}{tpl ? ` · ${tpl.name}` : ''}
        </span>
      </div>
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
  item: BuyingMasterItem | null
  templates: CommunicationTemplate[]
  existingMaxOrder: number
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle]             = useState(item?.title || '')
  const [description, setDescription] = useState(item?.description || '')
  const [days, setDays]               = useState(String(item?.days_before_event_start ?? '14'))
  const [linkedAction, setLinkedAction] = useState<'none' | 'send_communication'>(
    (item?.linked_action_type === 'send_communication' ? 'send_communication' : 'none')
  )
  const [linkedTpl, setLinkedTpl] = useState<string>(item?.linked_template_id || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) { alert('Title is required'); return }
    const daysNum = Number(days)
    if (!Number.isInteger(daysNum) || daysNum < 0) { alert('Days must be a non-negative integer'); return }
    if (linkedAction === 'send_communication' && !linkedTpl) {
      alert('Pick a template for the send-letter action.'); return
    }
    setSaving(true)
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      days_before_event_start: daysNum,
      linked_action_type: linkedAction,
      linked_template_id: linkedAction === 'send_communication' ? linkedTpl : null,
    }
    let error: any = null
    if (item) {
      ({ error } = await supabase.from('buying_event_checklist_master').update(payload).eq('id', item.id))
    } else {
      payload.display_order = existingMaxOrder + 1
      payload.is_active = true
      ;({ error } = await supabase.from('buying_event_checklist_master').insert(payload))
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
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Send pre-event confirmation" />
          </Field>
          <Field label="Description (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ width: '100%', fontFamily: 'inherit' }} />
          </Field>
          <Field label="Days before event">
            <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} />
          </Field>
          <Field label="Linked action">
            <select value={linkedAction} onChange={e => {
              const next = e.target.value as 'none' | 'send_communication'
              setLinkedAction(next)
              if (next !== 'send_communication') setLinkedTpl('')
            }}>
              <option value="none">None — manual checkbox</option>
              <option value="send_communication">Send letter (template)</option>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} className="btn-outline btn-sm" disabled={saving}>Cancel</button>
          <button onClick={save} className="btn-primary btn-sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="fl">{label}</label>
      {children}
    </div>
  )
}

const miniArrow: React.CSSProperties = {
  background: 'transparent', border: 0, cursor: 'pointer',
  color: 'var(--mist)', fontSize: 10, padding: '0 4px',
}
