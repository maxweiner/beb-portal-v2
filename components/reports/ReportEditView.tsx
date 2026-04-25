'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { Event } from '@/types'

export interface ReportDef {
  id: string                 // matches report_templates.id
  title: string
  description: string
  varHint: string            // human-readable list of available {{vars}}
  sendEndpoint: string | null  // POST endpoint, or null if not yet wired
  // Sample values for the live preview
  sampleVars: Record<string, string>
}

interface TemplateRow {
  id: string
  subject: string
  greeting: string
  header_subtitle: string
  footer: string
  shoutout_fallback: string
  enabled: boolean
  send_implemented: boolean
  updated_at: string
}

interface UserOpt { id: string; name: string; email: string }

function substitute(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildPreviewHtml(template: TemplateRow, vars: Record<string, string>): string {
  const subject = substitute(template.subject, vars)
  const greeting = substitute(template.greeting, vars)
  const subtitle = substitute(template.header_subtitle, vars)
  const footer = substitute(template.footer, vars)
  const shoutout = substitute(template.shoutout_fallback, vars)

  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f0e8;font-family:system-ui,-apple-system,sans-serif;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#2D3B2D,#1D6B44);padding:24px 28px;border-radius:12px 12px 0 0;color:#fff;">
        <div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Subject</div>
        <div style="font-size:14px;background:rgba(0,0,0,.3);padding:6px 10px;border-radius:6px;margin-bottom:18px;font-family:monospace;">${escapeHtml(subject)}</div>
        <div style="font-size:20px;font-weight:900;">${escapeHtml(greeting)}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:2px;">${escapeHtml(subtitle)}</div>
        ${shoutout ? `<div style="margin-top:14px;background:rgba(255,255,255,.1);border-radius:8px;padding:12px 14px;font-size:13px;color:rgba(255,255,255,.85);line-height:1.5;">${escapeHtml(shoutout)}</div>` : ''}
      </div>
      <div style="background:#fff;padding:24px 28px;font-size:13px;color:#737368;border-left:1px solid #d8d3ca;border-right:1px solid #d8d3ca;">
        <div style="text-align:center;padding:24px;background:#f5f0e8;border-radius:8px;color:#a8a89a;font-size:13px;">
          [Per-event data goes here — your report's live data is rendered here at send time]
        </div>
      </div>
      <div style="background:#fff;padding:14px 28px;border-top:1px solid #d8d3ca;border-left:1px solid #d8d3ca;border-right:1px solid #d8d3ca;border-bottom:1px solid #d8d3ca;border-radius:0 0 12px 12px;text-align:center;font-size:12px;color:#a8a89a;">
        ${escapeHtml(footer)}
      </div>
    </div>
  </body></html>`
}

export default function ReportEditView({ report, onBack }: { report: ReportDef; onBack: () => void }) {
  const { user, events, stores } = useApp()
  const isEventRecap = report.id === 'event-recap'
  const [template, setTemplate] = useState<TemplateRow | null>(null)
  const [users, setUsers] = useState<UserOpt[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  // Load template + active users
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('report_templates').select('*').eq('id', report.id).maybeSingle(),
      supabase.from('users').select('id, name, email').eq('active', true).order('name'),
    ]).then(([tplRes, usrRes]) => {
      if (cancelled) return
      // If the row (or even the table) is missing, fall back to a synthesized
      // default so the editor still loads. Save attempts will surface the
      // real error from Supabase if the table truly doesn't exist.
      if (tplRes.data) {
        setTemplate(tplRes.data as TemplateRow)
      } else {
        setTemplate({
          id: report.id,
          subject: '',
          greeting: '',
          header_subtitle: '',
          footer: '',
          shoutout_fallback: '',
          enabled: true,
          send_implemented: report.id === 'morning-briefing',
          updated_at: new Date().toISOString(),
        })
      }
      setUsers((usrRes.data || []) as UserOpt[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [report.id])

  function setField(field: keyof TemplateRow, value: string) {
    setTemplate(prev => prev ? ({ ...prev, [field]: value }) : prev)
    setSavedAt(null)
  }

  async function saveTemplate() {
    if (!template) return
    setSavingTemplate(true)
    const { error } = await supabase.from('report_templates').update({
      subject: template.subject,
      greeting: template.greeting,
      header_subtitle: template.header_subtitle,
      footer: template.footer,
      shoutout_fallback: template.shoutout_fallback,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    }).eq('id', template.id)
    setSavingTemplate(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSavedAt(new Date())
  }

  async function send() {
    if (!report.sendEndpoint || selected.size === 0) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(report.sendEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [...selected] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendResult(`✗ ${json.error || res.status}`)
      } else if (json.skipped) {
        setSendResult(`Skipped: ${json.skipped}`)
      } else {
        setSendResult(`✓ Sent to ${json.sent ?? selected.size} recipient${(json.sent ?? selected.size) === 1 ? '' : 's'}`)
      }
    } catch (e: any) {
      setSendResult(`✗ ${e?.message || 'Network error'}`)
    }
    setSending(false)
  }

  // For event-recap: pick a specific event so the preview/send uses real data.
  const recapEvents = useMemo(() => {
    if (!isEventRecap) return []
    // Most recent first; cap to last ~50 to keep the dropdown usable.
    return [...events]
      .filter(e => !!e.start_date)
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
      .slice(0, 50)
  }, [events, isEventRecap])
  const [recapEventId, setRecapEventId] = useState<string>('')
  useEffect(() => {
    if (isEventRecap && !recapEventId && recapEvents[0]) setRecapEventId(recapEvents[0].id)
  }, [isEventRecap, recapEventId, recapEvents])

  const previewHtml = useMemo(() => {
    if (!template) return ''
    return buildPreviewHtml(template, report.sampleVars)
  }, [template, report.sampleVars])

  // Live PDF-ish preview URL for event-recap (server-rendered standalone page)
  const recapPreviewUrl = isEventRecap && recapEventId
    ? `/api/event-recap/preview?event_id=${encodeURIComponent(recapEventId)}`
    : ''
  function downloadRecapPdf() {
    if (!recapEventId) return
    window.open(`/api/event-recap/preview?event_id=${encodeURIComponent(recapEventId)}&print=1`, '_blank')
  }
  async function sendRecap() {
    if (!recapEventId || selected.size === 0) return
    setSending(true); setSendResult(null)
    try {
      const res = await fetch('/api/event-recap/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: recapEventId, to: [...selected] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setSendResult(`✗ ${json.error || res.status}`)
      else setSendResult(`✓ Sent recap to ${json.sent ?? selected.size} recipient${(json.sent ?? selected.size) === 1 ? '' : 's'}`)
    } catch (e: any) {
      setSendResult(`✗ ${e?.message || 'Network error'}`)
    }
    setSending(false)
  }

  function eventLabel(ev: Event): string {
    const store = stores.find(s => s.id === ev.store_id)
    const name = store?.name || (ev as any).store_name || '(unknown store)'
    return `${name} · ${ev.start_date}`
  }

  function toggleUser(id: string) {
    setSelected(p => {
      const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n
    })
  }
  function selectAll() { setSelected(new Set(users.map(u => u.id))) }
  function clearAll()  { setSelected(new Set()) }

  if (loading || !template) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: 'var(--green-dark)',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          padding: '4px 0', marginBottom: 10,
        }}>← Back to Reports</button>
        <p style={{ color: 'var(--mist)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'var(--green-dark)',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        padding: '4px 0', marginBottom: 10,
      }}>← Back to Reports</button>

      <div style={{ marginBottom: 18 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>{report.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>{report.description}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        {/* LEFT: editor + recipients */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Template</div>
              {savedAt && (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                  ✓ Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </div>

            <div className="field">
              <label className="fl">Subject line</label>
              <input value={template.subject} onChange={e => setField('subject', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Greeting</label>
              <input value={template.greeting} onChange={e => setField('greeting', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Header subtitle</label>
              <input value={template.header_subtitle} onChange={e => setField('header_subtitle', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Shoutout / opening message (optional)</label>
              <textarea rows={3} value={template.shoutout_fallback}
                onChange={e => setField('shoutout_fallback', e.target.value)}
                placeholder="Leave blank for none. Used as the fallback when AI generation isn't available." />
            </div>
            <div className="field">
              <label className="fl">Footer</label>
              <input value={template.footer} onChange={e => setField('footer', e.target.value)} />
            </div>

            <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
              <strong>Variables:</strong> {report.varHint}
            </p>

            <button onClick={saveTemplate} disabled={savingTemplate} className="btn-primary btn-sm" style={{ marginTop: 10 }}>
              {savingTemplate ? 'Saving…' : 'Save template'}
            </button>
          </div>

          {isEventRecap && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Event</div>
              {recapEvents.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--mist)' }}>No events found.</p>
              ) : (
                <select value={recapEventId} onChange={e => setRecapEventId(e.target.value)} style={{ width: '100%' }}>
                  {recapEvents.map(ev => (
                    <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>
                  ))}
                </select>
              )}
              <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
                Pick the event to recap. The preview, PDF, and email all use this event's real data (per-day totals + per-buyer breakdown).
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={downloadRecapPdf} disabled={!recapEventId} className="btn-outline btn-sm">
                  Download PDF
                </button>
                <a href={recapPreviewUrl || '#'} target="_blank" rel="noreferrer"
                   className="btn-outline btn-sm"
                   style={!recapEventId ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>
                  Open standalone preview
                </a>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Recipients</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  {selected.size} of {users.length} selected
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={selectAll} className="btn-outline btn-xs">Select all</button>
                <button onClick={clearAll} className="btn-outline btn-xs">Clear</button>
              </div>
            </div>

            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--pearl)', borderRadius: 8, background: 'var(--cream2)' }}>
              {users.length === 0 ? (
                <div style={{ padding: 12, fontSize: 13, color: 'var(--mist)' }}>No active users.</div>
              ) : users.map(u => {
                const checked = selected.has(u.id)
                return (
                  <label key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderBottom: '1px solid var(--pearl)',
                    cursor: 'pointer', background: checked ? 'var(--green-pale)' : 'transparent',
                    position: 'relative',
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleUser(u.id)}
                      style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                    <span aria-hidden="true" style={{
                      width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                      border: `2px solid ${checked ? 'var(--green)' : 'var(--pearl)'}`,
                      background: checked ? 'var(--green)' : '#FFFFFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#FFFFFF', fontSize: 13, fontWeight: 900, lineHeight: 1,
                    }}>{checked ? '✓' : ''}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{u.name || u.email}</div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u.email}</div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
              {isEventRecap ? (
                <button
                  onClick={sendRecap}
                  disabled={sending || selected.size === 0 || !recapEventId}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {sending ? 'Sending…' : `Send recap (${selected.size})`}
                </button>
              ) : report.sendEndpoint && template.send_implemented ? (
                <button
                  onClick={send}
                  disabled={sending || selected.size === 0}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {sending ? 'Sending…' : `Send (${selected.size})`}
                </button>
              ) : (
                <button disabled className="btn-primary" style={{ flex: 1, opacity: 0.45, cursor: 'not-allowed' }}>
                  Send — coming soon
                </button>
              )}
              {sendResult && (
                <span style={{ fontSize: 12, color: sendResult.startsWith('✓') ? 'var(--green-dark)' : '#991b1b' }}>
                  {sendResult}
                </span>
              )}
            </div>
          </div>
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
          {isEventRecap && recapPreviewUrl ? (
            <iframe
              title="event recap preview"
              src={recapPreviewUrl}
              style={{ width: '100%', height: 600, border: 'none', display: 'block', background: '#f5f0e8' }}
            />
          ) : (
            <iframe
              title="report preview"
              srcDoc={previewHtml}
              style={{ width: '100%', height: 600, border: 'none', display: 'block', background: '#f5f0e8' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
