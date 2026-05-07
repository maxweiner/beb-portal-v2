'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import {
  MERGE_FIELDS,
  SAMPLE_FIXTURE,
  applyMergeFields,
  findUnknownMergeFields,
} from '@/lib/communications/mergeFields'
import type { CommunicationTemplate } from '@/types'

interface Props {
  template: CommunicationTemplate | null
  canEdit: boolean
  onClose: () => void
}

export default function TemplateEditor({ template, canEdit, onClose }: Props) {
  const { user } = useApp()
  const [name, setName] = useState(template?.name || '')
  const [subject, setSubject] = useState(template?.subject_line || '')
  const [body, setBody] = useState(template?.body || '')
  const [isActive, setIsActive] = useState(template?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Type-to-confirm delete: must type exactly "delete" to enable button.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef    = useRef<HTMLTextAreaElement | null>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  const previewSubject = useMemo(() => applyMergeFields(subject, SAMPLE_FIXTURE), [subject])
  const previewBody    = useMemo(() => applyMergeFields(body, SAMPLE_FIXTURE), [body])
  const unknownFields  = useMemo(
    () => Array.from(new Set([...findUnknownMergeFields(subject), ...findUnknownMergeFields(body)])),
    [subject, body]
  )

  function insertAtCursor(field: string) {
    if (!canEdit) return
    const placeholder = `{${field}}`
    if (lastFocused.current === 'subject') {
      const el = subjectRef.current; if (!el) return
      const s = el.selectionStart ?? subject.length
      const e = el.selectionEnd ?? subject.length
      const next = subject.slice(0, s) + placeholder + subject.slice(e)
      setSubject(next)
      requestAnimationFrame(() => {
        el.focus()
        const pos = s + placeholder.length
        el.setSelectionRange(pos, pos)
      })
    } else {
      const el = bodyRef.current; if (!el) return
      const s = el.selectionStart ?? body.length
      const e = el.selectionEnd ?? body.length
      const next = body.slice(0, s) + placeholder + body.slice(e)
      setBody(next)
      requestAnimationFrame(() => {
        el.focus()
        const pos = s + placeholder.length
        el.setSelectionRange(pos, pos)
      })
    }
  }

  async function save() {
    if (!canEdit) return
    if (!name.trim() || !subject.trim() || !body.trim()) {
      setError('Name, subject, and body are all required.')
      return
    }
    if (unknownFields.length > 0) {
      const ok = confirm(
        `The following placeholders don't match any known merge field and will appear literally in the sent letter:\n\n` +
        unknownFields.map(f => `  {${f}}`).join('\n') +
        `\n\nSave anyway?`
      )
      if (!ok) return
    }
    setSaving(true); setError(null)
    try {
      if (template) {
        const { error } = await supabase
          .from('communication_templates')
          .update({
            name: name.trim(),
            subject_line: subject,
            body,
            is_active: isActive,
          })
          .eq('id', template.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('communication_templates')
          .insert({
            name: name.trim(),
            subject_line: subject,
            body,
            is_active: isActive,
            created_by: user?.id || null,
          })
        if (error) throw error
      }
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <button onClick={onClose} className="btn-outline btn-xs" style={{ marginBottom: 6 }}>← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
            {template ? `Edit: ${template.name}` : 'New template'}
          </h1>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ash)' }}>
              <input
                type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                style={{ width: 16, height: 16, padding: 0, margin: 0, appearance: 'auto', WebkitAppearance: 'checkbox' } as React.CSSProperties}
              /> Active
            </label>
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: '#fdecea', color: '#7a1f0f', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px 1fr', gap: 14, alignItems: 'start' }}>
        {/* Editor */}
        <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Template name</label>
            <input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit}
              placeholder="Confirmation Letter" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Subject line</label>
            <input
              ref={subjectRef}
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onFocus={() => { lastFocused.current = 'subject' }}
              disabled={!canEdit}
              placeholder="Estate Trunk Show Confirmation — {store_name}"
            />
          </div>
          <div className="field">
            <label className="fl">Body</label>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onFocus={() => { lastFocused.current = 'body' }}
              disabled={!canEdit}
              rows={28}
              placeholder="Dear {store_name}, …"
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
            />
          </div>
          {unknownFields.length > 0 && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 6,
              background: '#fff8e1', color: '#7a5b00', fontSize: 12,
            }}>
              ⚠ Unknown placeholders: {unknownFields.map(f => <code key={f} style={{ marginRight: 6 }}>{`{${f}}`}</code>)}
              <div style={{ marginTop: 4, opacity: .8 }}>These will appear literally in the sent letter. Did you mean a known field?</div>
            </div>
          )}
        </div>

        {/* Merge field side panel */}
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 12, position: 'sticky', top: 14, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Merge fields
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
            {canEdit ? 'Click to insert at cursor.' : 'Click to copy.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {MERGE_FIELDS.map(f => (
              <button
                key={f.name}
                onClick={() => canEdit ? insertAtCursor(f.name) : navigator.clipboard.writeText(`{${f.name}}`)}
                title={f.description}
                style={{
                  fontFamily: 'inherit', textAlign: 'left',
                  background: 'var(--cream2)', border: 'none', borderRadius: 6,
                  padding: '6px 8px', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>
                  <code>{`{${f.name}}`}</code>
                </div>
                <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2 }}>{f.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Live preview — mirrors what the recipient sees: BEB
            letterhead at the top, subject pill, body. The actual
            sent PDF is generated server-side via lib/communications/
            generatePdf.ts using the same /public/beb-wordmark.png. */}
        <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Live preview · sample data
          </div>
          {/* BEB letterhead — included on every Beneficial letter sent
              from this module. Pulled from the static asset. */}
          <div style={{ borderBottom: '1px solid var(--cream2)', paddingBottom: 12, marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/beb-wordmark.png"
              alt="Beneficial Estate Buyers"
              style={{ height: 48, width: 'auto', display: 'block', objectFit: 'contain' }}
            />
            <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 4 }}>
              Estate Trunk Show
            </div>
          </div>
          <div style={{
            background: 'var(--cream2)', borderRadius: 6, padding: '8px 10px',
            fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 10,
            wordBreak: 'break-word',
          }}>
            <span style={{ color: 'var(--mist)', fontWeight: 600 }}>Subject:</span> {previewSubject || <em style={{ color: 'var(--mist)' }}>(empty)</em>}
          </div>
          <pre style={{
            margin: 0, padding: 0,
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55,
            color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{previewBody || <em style={{ color: 'var(--mist)' }}>(empty)</em>}</pre>
        </div>
      </div>

      {/* Schedules — only meaningful for saved templates */}
      {template && (
        <SchedulesSection templateId={template.id} canEdit={canEdit} />
      )}

      {/* Danger zone — type-to-confirm delete. Only shown for
          existing (saved) templates and only to editors. New
          templates have nothing to delete yet. */}
      {template && canEdit && (
        <div style={{
          marginTop: 32, padding: 16,
          background: '#FFF7F7', border: '1px dashed #fecdd3', borderRadius: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#B22234', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            ⚠ Danger Zone
          </div>
          <div style={{ fontSize: 12, color: 'var(--ash)', marginBottom: 10, lineHeight: 1.5 }}>
            Permanently deletes this template. Past sends already created from
            it stay intact. If you just want to stop using it, uncheck
            <b> Active</b> at the top instead.
          </div>
          {!deleteOpen ? (
            <button
              onClick={() => setDeleteOpen(true)}
              className="btn-outline btn-sm"
              style={{ color: '#B22234', borderColor: '#fecdd3' }}
            >
              🗑 Delete this template…
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                Type <b><code>delete</code></b> to confirm:
              </div>
              <input
                type="text"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="delete"
                autoFocus
                style={{ maxWidth: 240 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    if (deleteConfirm.trim().toLowerCase() !== 'delete') return
                    setDeleting(true)
                    try {
                      const { error } = await supabase
                        .from('communication_templates')
                        .delete()
                        .eq('id', template.id)
                      if (error) {
                        alert('Delete failed: ' + error.message)
                        return
                      }
                      onClose()
                    } finally {
                      setDeleting(false)
                    }
                  }}
                  disabled={deleting || deleteConfirm.trim().toLowerCase() !== 'delete'}
                  className="btn-danger btn-sm"
                >
                  {deleting ? 'Deleting…' : '🗑 Permanently Delete'}
                </button>
                <button
                  onClick={() => { setDeleteOpen(false); setDeleteConfirm('') }}
                  disabled={deleting}
                  className="btn-outline btn-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SchedulesSection({ templateId, canEdit }: { templateId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<{
    id: string; days_before_event_start: number; send_window_days: number; is_active: boolean
  }[]>([])
  const [loading, setLoading] = useState(true)
  const [draftDays, setDraftDays] = useState('')
  const [draftWindow, setDraftWindow] = useState('7')
  const [busy, setBusy] = useState(false)

  async function reload() {
    setLoading(true)
    const { data } = await supabase
      .from('communication_send_schedules')
      .select('id, days_before_event_start, send_window_days, is_active')
      .eq('template_id', templateId)
      .order('days_before_event_start', { ascending: false })
    setRows((data || []) as any)
    setLoading(false)
  }
  useEffect(() => { reload() }, [templateId])

  async function add() {
    const days = Number(draftDays)
    const window = Number(draftWindow)
    if (!Number.isInteger(days) || days < 0) { alert('Days before event must be a non-negative integer'); return }
    if (!Number.isInteger(window) || window <= 0) { alert('Send window must be a positive integer'); return }
    setBusy(true)
    const { error } = await supabase.from('communication_send_schedules').insert({
      template_id: templateId,
      days_before_event_start: days,
      send_window_days: window,
      is_active: true,
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setDraftDays(''); setDraftWindow('7')
    reload()
  }

  async function toggleActive(id: string, current: boolean) {
    setBusy(true)
    const { error } = await supabase
      .from('communication_send_schedules')
      .update({ is_active: !current })
      .eq('id', id)
    setBusy(false)
    if (error) { alert(error.message); return }
    reload()
  }

  async function remove(id: string) {
    if (!confirm('Delete this schedule? Pending checklist items it created on future trunk shows will remain — un-check or delete those manually if needed.')) return
    setBusy(true)
    const { error } = await supabase.from('communication_send_schedules').delete().eq('id', id)
    setBusy(false)
    if (error) { alert(error.message); return }
    reload()
  }

  if (loading) return null

  return (
    <div style={{ marginTop: 18, background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>📅 Send schedules</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
        When this template fires on a trunk show. Adding a schedule auto-creates per-show checklist items
        on every future trunk show whose event date is at least <em>{'{days before}'}</em> days out.
        Past-due items are NOT created retroactively.
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', padding: '10px 0', textAlign: 'center' }}>
          No schedules yet. {canEdit ? 'Add one below.' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {rows.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 6,
              background: r.is_active ? 'var(--green-pale)' : 'var(--cream2)',
              border: `1px solid ${r.is_active ? 'var(--green3)' : 'var(--cream2)'}`,
              opacity: r.is_active ? 1 : 0.6,
            }}>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>
                <strong>{r.days_before_event_start}</strong> day{r.days_before_event_start === 1 ? '' : 's'} before event
                <span style={{ color: 'var(--mist)', marginLeft: 8 }}>· {r.send_window_days}-day send window</span>
              </div>
              {canEdit && (
                <>
                  <button onClick={() => toggleActive(r.id, r.is_active)} disabled={busy} className="btn-outline btn-xs">
                    {r.is_active ? 'Archive' : 'Activate'}
                  </button>
                  <button onClick={() => remove(r.id)} disabled={busy} className="btn-outline btn-xs" title="Delete schedule">✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{
          padding: 10, border: '1px dashed var(--pearl)', borderRadius: 8,
          display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 8, alignItems: 'flex-end',
        }}>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Days before event
            <input type="number" min="0" value={draftDays}
              onChange={e => setDraftDays(e.target.value)}
              placeholder="60"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Send window (days)
            <input type="number" min="1" value={draftWindow}
              onChange={e => setDraftWindow(e.target.value)}
              placeholder="7"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <button onClick={add} disabled={busy || !draftDays} className="btn-primary btn-sm">
            {busy ? '…' : '+ Add'}
          </button>
        </div>
      )}
    </div>
  )
}
