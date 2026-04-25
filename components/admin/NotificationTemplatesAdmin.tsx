'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { listTriggers, type TriggerType } from '@/lib/notifications/triggers'
import NotificationTemplateV2Editor, { type V2TemplateRow } from './NotificationTemplateV2Editor'

interface TemplateRow {
  id: string
  channel: 'sms' | 'email'
  subject: string | null
  body: string
  description: string
  updated_at: string
  // v2 fields — present on per-brand rows, null on legacy rows
  brand: 'beb' | 'liberty' | null
  trigger_type: string | null
  name: string | null
  enabled: boolean
  channels: string[] | null
  delay_minutes: number | null
  email_subject: string | null
  email_body_html: string | null
  email_body_text: string | null
  sms_body: string | null
  respect_quiet_hours_email: boolean
  respect_quiet_hours_sms: boolean
}

// Variables documented per template id (mirrors what the send code injects).
const VAR_HINT: Record<string, string[]> = {
  sms_confirmation:        ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  email_confirmation:      ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  sms_reminder_24h:        ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  email_reminder_24h:      ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  sms_reminder_2h:         ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  email_reminder_2h:       ['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  sms_cancellation:        ['customer_name', 'store_name', 'date', 'time', 'rebook_link'],
  email_cancellation:      ['customer_name', 'store_name', 'date', 'time', 'rebook_link'],
  sms_contact_info_updated:['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  email_contact_info_updated:['customer_name', 'store_name', 'date', 'time', 'manage_link'],
  email_welcome:           ['employee_name', 'store_name', 'portal_link'],
}

function sampleVars(id: string): Record<string, string> {
  return {
    customer_name: 'Sam Customer',
    store_name: 'Sample Store',
    date: 'Sunday, April 26, 2026',
    time: '10:20 AM',
    manage_link: 'https://beb-portal-v2.vercel.app/book/manage/sample-token',
    rebook_link: 'https://beb-portal-v2.vercel.app/book/sample-store',
    employee_name: 'Alex Smith',
    portal_link: 'https://beb-portal-v2.vercel.app/store-portal/sample-token',
    store_phone: '555-123-4567',
    store_email: 'hello@samplestore.com',
  }
}

function sub(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

function shellHtml(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f0e8;font-family:system-ui,sans-serif;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      ${inner}
      <p style="font-size:12px;color:#6b7280;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
        Beneficial Estate Buyers
      </p>
    </div>
  </body></html>`
}

export default function NotificationTemplatesAdmin() {
  const { user, brand } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('notification_templates')
      .select('*')
      .order('id')
      .then(({ data }) => {
        setTemplates((data || []) as TemplateRow[])
        setLoaded(true)
      })
  }, [])

  if (!isSuperAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)' }}>Superadmin only</div>
        </div>
      </div>
    )
  }

  if (activeId) {
    const tpl = templates.find(t => t.id === activeId)
    if (tpl) {
      // v2 brand-scoped templates open the new editor; legacy rows
      // (brand IS NULL) keep the old editor.
      if (tpl.brand && tpl.trigger_type) {
        return (
          <NotificationTemplateV2Editor
            template={tpl as unknown as V2TemplateRow}
            onBack={() => setActiveId(null)}
            onSaved={(updated) => setTemplates(p => p.map(t => t.id === updated.id ? { ...t, ...updated } : t))}
          />
        )
      }
      return (
        <NotificationTemplateEditor
          template={tpl}
          onBack={() => setActiveId(null)}
          onSaved={(updated) => {
            setTemplates(p => p.map(t => t.id === updated.id ? { ...t, ...updated } : t))
          }}
        />
      )
    }
  }

  if (!loaded) {
    return <div className="p-6"><p style={{ color: 'var(--mist)' }}>Loading…</p></div>
  }

  const triggerDefs = listTriggers()
  const v2ForBrand = templates.filter(t => t.brand === brand && t.trigger_type)
  const legacy = templates.filter(t => !t.brand)

  return (
    <div className="p-6" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Notification Templates</h1>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Editing templates for <strong style={{ textTransform: 'uppercase' }}>{brand}</strong>.
          Switch brand in the sidebar to edit the other set.
        </p>
      </div>

      {/* v2 per-brand triggers */}
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          Per-brand triggers
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {triggerDefs.map(def => {
            const row = v2ForBrand.find(t => t.trigger_type === def.type)
            return (
              <button key={def.type}
                onClick={() => row && setActiveId(row.id)}
                disabled={!row}
                style={{
                  background: 'white', border: '1px solid var(--pearl)',
                  borderRadius: 10, padding: '12px 14px', textAlign: 'left',
                  cursor: row ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                  opacity: row ? 1 : 0.5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{def.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {row?.enabled ? (
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--green-dark)', background: 'var(--green-pale)', padding: '2px 6px', borderRadius: 4 }}>ENABLED</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', background: 'var(--cream2)', padding: '2px 6px', borderRadius: 4 }}>DISABLED</span>
                    )}
                    {!def.implemented && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#92400E', background: '#FEF3C7', padding: '2px 6px', borderRadius: 4 }}>SCAFFOLD</span>
                    )}
                    {row && (
                      <span style={{ fontSize: 10, color: 'var(--mist)' }}>
                        {(row.channels || []).join('+').toUpperCase()} · {row.delay_minutes ?? def.defaultDelayMinutes}m
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{def.description}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* legacy templates */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          Legacy appointment templates (global)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {legacy.map(t => (
            <button key={t.id}
              onClick={() => setActiveId(t.id)}
              style={{
                background: 'white', border: '1px solid var(--pearl)',
                borderRadius: 10, padding: '12px 14px', textAlign: 'left',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{prettyName(t.id)}</div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function prettyName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function NotificationTemplateEditor({
  template,
  onBack,
  onSaved,
}: {
  template: TemplateRow
  onBack: () => void
  onSaved: (t: TemplateRow) => void
}) {
  const [subject, setSubject] = useState(template.subject ?? '')
  const [body, setBody] = useState(template.body)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const vars = sampleVars(template.id)
  const allowed = VAR_HINT[template.id] ?? Object.keys(vars)

  const previewBody = useMemo(() => sub(body, vars), [body, vars])
  const previewSubject = useMemo(() => sub(subject, vars), [subject, vars])

  async function save() {
    setSaving(true)
    const { data, error } = await supabase.from('notification_templates')
      .update({
        subject: template.channel === 'email' ? subject : null,
        body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id)
      .select('*')
      .single()
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSavedAt(new Date())
    onSaved(data as TemplateRow)
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'var(--green-dark)',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        padding: '4px 0', marginBottom: 10,
      }}>← Back to Templates</button>

      <div style={{ marginBottom: 18 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>{prettyName(template.id)}</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>{template.description}</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Available variables: {allowed.map(v => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        {/* LEFT: editor */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Template</div>
            {savedAt && (
              <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                ✓ Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>

          {template.channel === 'email' && (
            <div className="field">
              <label className="fl">Subject line</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
          )}

          <div className="field">
            <label className="fl">Body {template.channel === 'sms' ? '(plain text)' : '(HTML)'}</label>
            <textarea
              rows={template.channel === 'sms' ? 4 : 14}
              value={body}
              onChange={e => setBody(e.target.value)}
              style={{
                fontFamily: template.channel === 'email' ? 'ui-monospace, monospace' : 'inherit',
                fontSize: 12, resize: 'vertical',
              }}
            />
          </div>

          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>

        {/* RIGHT: live preview */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '10px 14px', background: 'var(--cream2)',
            fontSize: 13, fontWeight: 800, color: 'var(--ink)',
            borderBottom: '1px solid var(--pearl)',
          }}>
            Live preview
          </div>
          {template.channel === 'sms' ? (
            <div style={{ padding: 16 }}>
              <div style={{
                background: '#E5E5EA', borderRadius: 18,
                padding: '10px 14px', display: 'inline-block',
                maxWidth: '85%', fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap',
              }}>
                {previewBody}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
                Preview rendered with sample data.
              </div>
            </div>
          ) : (
            <>
              <div style={{
                padding: '8px 14px', background: 'white',
                fontSize: 12, color: 'var(--mist)',
                borderBottom: '1px solid var(--pearl)',
              }}>
                <strong>Subject:</strong> {previewSubject || <em>(empty)</em>}
              </div>
              <iframe
                title="email preview"
                srcDoc={shellHtml(previewBody)}
                style={{ width: '100%', height: 540, border: 'none', display: 'block', background: '#f5f0e8' }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
