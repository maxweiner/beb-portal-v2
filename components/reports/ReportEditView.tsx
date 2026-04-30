'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { Event } from '@/types'
import Checkbox from '@/components/ui/Checkbox'

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

interface ScheduleRow {
  template_id: string
  brand: 'beb' | 'liberty'
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  time_of_day: string         // 'HH:MM:SS'
  weekly_day: number | null
  monthly_day: number | null
  last_sent_at: string | null
}

const WEEKDAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const BRAND_LABELS: Record<'beb'|'liberty', string> = { beb: 'Beneficial', liberty: 'Liberty' }

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
  const { user, events, stores, brand } = useApp()
  const isEventRecap = report.id === 'event-recap'
  const isChecksIssued = report.id === 'checks-issued'
  // Treat both event-scoped reports as a single "needs an event picker
  // + custom preview iframe" branch — they share UI shape (event
  // dropdown → standalone preview, Download PDF, Email).
  const isEventScoped = isEventRecap || isChecksIssued
  // Transactional templates (no broadcast send) — fired by their own
  // cron / trigger. Hide schedule, recipients, and broadcast-only fields.
  const isTransactional = report.sendEndpoint === null
  const [template, setTemplate] = useState<TemplateRow | null>(null)
  const [users, setUsers] = useState<UserOpt[]>([])
  // Persistent per-(template, brand) recipients. Toggling autosaves.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleSavedAt, setScheduleSavedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  // Load template + active users (template is shared across brands)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('report_templates').select('*').eq('id', report.id).maybeSingle(),
      supabase.from('users').select('id, name, email').eq('active', true).order('name'),
    ]).then(([tplRes, usrRes]) => {
      if (cancelled) return
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
          send_implemented: report.id === 'morning-briefing' || report.id === 'daily-briefing',
          updated_at: new Date().toISOString(),
        })
      }
      setUsers((usrRes.data || []) as UserOpt[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [report.id])

  // Load schedule + recipients for active brand. Re-runs on brand switch.
  useEffect(() => {
    let cancelled = false
    setScheduleSavedAt(null)
    Promise.all([
      supabase.from('report_template_schedules')
        .select('*')
        .eq('template_id', report.id).eq('brand', brand)
        .maybeSingle(),
      supabase.from('report_template_recipients')
        .select('user_id')
        .eq('template_id', report.id).eq('brand', brand),
    ]).then(([schedRes, recipRes]) => {
      if (cancelled) return
      setSchedule((schedRes.data as ScheduleRow | null) ?? {
        template_id: report.id,
        brand: brand as 'beb' | 'liberty',
        enabled: false,
        frequency: 'daily',
        time_of_day: '12:00:00',
        weekly_day: 0,
        monthly_day: 1,
        last_sent_at: null,
      })
      setSelected(new Set(((recipRes.data || []) as { user_id: string }[]).map(r => r.user_id)))
    })
    return () => { cancelled = true }
  }, [report.id, brand])

  function setField(field: keyof TemplateRow, value: string) {
    setTemplate(prev => prev ? ({ ...prev, [field]: value }) : prev)
    setSavedAt(null)
  }

  async function saveTemplate() {
    if (!template) return
    setSavingTemplate(true)
    // Upsert so the editor works for templates whose seed row hasn't been
    // applied yet — otherwise update on a missing id silently no-ops.
    const { error } = await supabase.from('report_templates').upsert({
      id: template.id,
      subject: template.subject,
      greeting: template.greeting,
      header_subtitle: template.header_subtitle,
      footer: template.footer,
      shoutout_fallback: template.shoutout_fallback,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    }, { onConflict: 'id' })
    setSavingTemplate(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSavedAt(new Date())
  }

  async function send() {
    if (!report.sendEndpoint || selected.size === 0) return
    setSending(true)
    setSendResult(null)
    try {
      // Append brand so the server-side handler scopes data + per-brand template overrides correctly.
      const url = `${report.sendEndpoint}?brand=${encodeURIComponent(brand)}`
      const res = await fetch(url, {
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

  // For event-scoped reports (event-recap + checks-issued): pick a
  // specific event so the preview/send uses real data.
  const recapEvents = useMemo(() => {
    if (!isEventScoped) return []
    // Most recent first; cap to last ~50 to keep the dropdown usable.
    return [...events]
      .filter(e => !!e.start_date)
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
      .slice(0, 50)
  }, [events, isEventScoped])
  const [recapEventId, setRecapEventId] = useState<string>('')
  useEffect(() => {
    if (isEventScoped && !recapEventId && recapEvents[0]) setRecapEventId(recapEvents[0].id)
  }, [isEventScoped, recapEventId, recapEvents])

  // Checks-issued only: filter by check number substring + exact amount.
  const [checkNumberFilter, setCheckNumberFilter] = useState('')
  const [amountFilter, setAmountFilter] = useState('')

  const previewHtml = useMemo(() => {
    if (!template) return ''
    return buildPreviewHtml(template, report.sampleVars)
  }, [template, report.sampleVars])

  // Live PDF-ish preview URL for event-scoped reports (server-rendered
  // standalone page). Checks Issued appends its filter querystring so
  // the preview iframe + PDF + email all reflect the same view.
  const recapPreviewUrl = (() => {
    if (!isEventScoped || !recapEventId) return ''
    if (isEventRecap) {
      return `/api/event-recap/preview?event_id=${encodeURIComponent(recapEventId)}`
    }
    // checks-issued
    const params = new URLSearchParams({ event_id: recapEventId })
    if (checkNumberFilter.trim()) params.set('check_number', checkNumberFilter.trim())
    if (amountFilter.trim()) params.set('amount', amountFilter.trim())
    return `/api/checks-issued/preview?${params.toString()}`
  })()
  function downloadRecapPdf() {
    if (!recapEventId) return
    window.open(`${recapPreviewUrl}${recapPreviewUrl.includes('?') ? '&' : '?'}print=1`, '_blank')
  }
  async function sendRecap() {
    if (!recapEventId || selected.size === 0) return
    setSending(true); setSendResult(null)
    try {
      const endpoint = isEventRecap ? '/api/event-recap/send' : '/api/checks-issued/send'
      const body: Record<string, unknown> = { event_id: recapEventId, to: [...selected] }
      if (isChecksIssued) {
        if (checkNumberFilter.trim()) body.check_number = checkNumberFilter.trim()
        if (amountFilter.trim()) body.amount = amountFilter.trim()
      }
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setSendResult(`✗ ${json.error || res.status}`)
      else setSendResult(`✓ Sent to ${json.sent ?? selected.size} recipient${(json.sent ?? selected.size) === 1 ? '' : 's'}`)
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

  // Toggling a recipient autosaves to report_template_recipients for the
  // active brand. Optimistic update with rollback on error.
  async function toggleUser(id: string) {
    const isAdding = !selected.has(id)
    setSelected(p => {
      const n = new Set(p); isAdding ? n.add(id) : n.delete(id); return n
    })
    const res = isAdding
      ? await supabase.from('report_template_recipients').insert({ template_id: report.id, brand, user_id: id })
      : await supabase.from('report_template_recipients').delete()
          .eq('template_id', report.id).eq('brand', brand).eq('user_id', id)
    if (res.error) {
      alert('Failed to update recipient: ' + res.error.message)
      setSelected(p => {
        const n = new Set(p); isAdding ? n.delete(id) : n.add(id); return n
      })
    }
  }
  async function selectAll() {
    const toAdd = users.map(u => u.id).filter(id => !selected.has(id))
    if (toAdd.length === 0) return
    setSelected(new Set(users.map(u => u.id)))
    const { error } = await supabase.from('report_template_recipients')
      .insert(toAdd.map(uid => ({ template_id: report.id, brand, user_id: uid })))
    if (error) alert('Failed to add all recipients: ' + error.message)
  }
  async function clearAll() {
    if (selected.size === 0) return
    setSelected(new Set())
    const { error } = await supabase.from('report_template_recipients').delete()
      .eq('template_id', report.id).eq('brand', brand)
    if (error) alert('Failed to clear recipients: ' + error.message)
  }

  function setScheduleField<K extends keyof ScheduleRow>(field: K, value: ScheduleRow[K]) {
    setSchedule(prev => prev ? ({ ...prev, [field]: value }) : prev)
    setScheduleSavedAt(null)
  }

  async function saveSchedule() {
    if (!schedule) return
    setSavingSchedule(true)
    const payload = {
      template_id: report.id,
      brand,
      enabled: schedule.enabled,
      frequency: schedule.frequency,
      time_of_day: schedule.time_of_day,
      weekly_day: schedule.frequency === 'weekly' ? schedule.weekly_day : null,
      monthly_day: schedule.frequency === 'monthly' ? schedule.monthly_day : null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('report_template_schedules')
      .upsert(payload, { onConflict: 'template_id,brand' })
    setSavingSchedule(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setScheduleSavedAt(new Date())
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 className="text-2xl font-black" style={{ color: 'var(--ink)', margin: 0 }}>{report.title}</h1>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em',
            padding: '3px 10px', borderRadius: 12,
            background: brand === 'beb' ? 'rgba(29,107,68,.12)' : 'rgba(124,58,237,.12)',
            color: brand === 'beb' ? '#1D6B44' : '#7C3AED',
          }}>{BRAND_LABELS[brand as 'beb' | 'liberty']}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)' }}>{report.description}</div>
        {!isTransactional && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
            Template body is shared across brands. Schedule + recipients below are per-brand — switch the brand toggle to manage the other side.
          </div>
        )}
        {isTransactional && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
            Sent transactionally — no broadcast schedule or recipient list. Edits go live immediately for the next send.
          </div>
        )}
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
              <label className="fl">{isTransactional ? 'Opening line' : 'Greeting'}</label>
              <input value={template.greeting} onChange={e => setField('greeting', e.target.value)} />
            </div>
            {!isTransactional && (
              <div className="field">
                <label className="fl">Header subtitle</label>
                <input value={template.header_subtitle} onChange={e => setField('header_subtitle', e.target.value)} />
              </div>
            )}
            <div className="field">
              <label className="fl">{isTransactional ? 'Body' : 'Shoutout / opening message (optional)'}</label>
              <textarea rows={3} value={template.shoutout_fallback}
                onChange={e => setField('shoutout_fallback', e.target.value)}
                placeholder={isTransactional ? 'Main paragraph of the email. Use {{vars}} as listed below.' : "Leave blank for none. Used as the fallback when AI generation isn't available."} />
            </div>
            <div className="field">
              <label className="fl">{isTransactional ? 'Closing line' : 'Footer'}</label>
              <input value={template.footer} onChange={e => setField('footer', e.target.value)} />
            </div>

            <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
              <strong>Variables:</strong> {report.varHint}
            </p>

            <button onClick={saveTemplate} disabled={savingTemplate} className="btn-primary btn-sm" style={{ marginTop: 10 }}>
              {savingTemplate ? 'Saving…' : 'Save template'}
            </button>
          </div>

          {isEventScoped && (
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
                {isEventRecap
                  ? "Pick the event to recap. The preview, PDF, and email all use this event's real data (per-day totals + per-buyer breakdown)."
                  : "Pick the event whose checks you want to list. Filters below narrow the result; the preview, PDF, and email all reflect the same view."}
              </p>

              {isChecksIssued && (
                <div style={{
                  marginTop: 12, padding: 12,
                  background: 'var(--cream2)', borderRadius: 'var(--r)',
                  border: '1px solid var(--pearl)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                    Filters (optional)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label className="fl">Check #</label>
                      <input type="text" value={checkNumberFilter}
                        onChange={e => setCheckNumberFilter(e.target.value)}
                        placeholder="contains…" />
                    </div>
                    <div>
                      <label className="fl">Amount</label>
                      <input type="number" min="0" step="0.01" value={amountFilter}
                        onChange={e => setAmountFilter(e.target.value)}
                        placeholder="exact, e.g. 250" />
                    </div>
                  </div>
                  {(checkNumberFilter || amountFilter) && (
                    <button onClick={() => { setCheckNumberFilter(''); setAmountFilter('') }}
                      className="btn-outline btn-xs" style={{ marginTop: 8 }}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}

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

          {/* Schedule (per-brand) — broadcast templates only */}
          {schedule && !isEventScoped && !isTransactional && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                  Schedule <span style={{ color: 'var(--mist)', fontWeight: 600 }}>· {BRAND_LABELS[brand as 'beb' | 'liberty']}</span>
                </div>
                {scheduleSavedAt && (
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                    ✓ Saved {scheduleSavedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>

              <div style={{ marginBottom: 12 }}>
                <Checkbox
                  checked={schedule.enabled}
                  onChange={v => setScheduleField('enabled', v)}
                  label={<span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Send on a schedule</span>}
                />
              </div>

              <div style={{ opacity: schedule.enabled ? 1 : 0.5, pointerEvents: schedule.enabled ? 'auto' : 'none' }}>
                <div className="field">
                  <label className="fl">Frequency</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['daily','weekly','monthly'] as const).map(f => {
                      const sel = schedule.frequency === f
                      return (
                        <button key={f} onClick={() => setScheduleField('frequency', f)} style={{
                          padding: '6px 14px', borderRadius: 6, border: '1px solid var(--pearl)', cursor: 'pointer',
                          background: sel ? 'var(--green-pale)' : 'white', color: sel ? 'var(--green-dark)' : 'var(--ash)',
                          fontSize: 13, fontWeight: 700, textTransform: 'capitalize', fontFamily: 'inherit',
                        }}>{f}</button>
                      )
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: schedule.frequency === 'daily' ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label className="fl">Time of day (UTC)</label>
                    <input type="time" value={schedule.time_of_day.slice(0, 5)}
                      onChange={e => setScheduleField('time_of_day', e.target.value + ':00')} />
                  </div>
                  {schedule.frequency === 'weekly' && (
                    <div className="field">
                      <label className="fl">Day of week</label>
                      <select value={schedule.weekly_day ?? 0}
                        onChange={e => setScheduleField('weekly_day', Number(e.target.value))}>
                        {WEEKDAY_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  {schedule.frequency === 'monthly' && (
                    <div className="field">
                      <label className="fl">Day of month</label>
                      <select value={schedule.monthly_day ?? 1}
                        onChange={e => setScheduleField('monthly_day', Number(e.target.value))}>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {schedule.last_sent_at && (
                  <p style={{ fontSize: 11, color: 'var(--mist)', margin: '4px 0 0' }}>
                    Last sent: {new Date(schedule.last_sent_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
              </div>

              <button onClick={saveSchedule} disabled={savingSchedule} className="btn-primary btn-sm" style={{ marginTop: 10 }}>
                {savingSchedule ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          )}

          {!isTransactional && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                  Recipients <span style={{ color: 'var(--mist)', fontWeight: 600 }}>· {BRAND_LABELS[brand as 'beb' | 'liberty']}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  {selected.size} of {users.length} selected · saved as you toggle
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
              {isEventScoped ? (
                <button
                  onClick={sendRecap}
                  disabled={sending || selected.size === 0 || !recapEventId}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {sending
                    ? 'Sending…'
                    : `Send ${isEventRecap ? 'recap' : 'report'} (${selected.size})`}
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
          )}
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
          {isEventScoped && recapPreviewUrl ? (
            <iframe
              title={isEventRecap ? 'event recap preview' : 'checks issued preview'}
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
