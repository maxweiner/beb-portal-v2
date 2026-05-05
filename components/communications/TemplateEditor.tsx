'use client'

import { useMemo, useRef, useState } from 'react'
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

        {/* Live preview */}
        <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Live preview · sample data
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
    </div>
  )
}
