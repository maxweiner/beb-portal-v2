'use client'

// Full-screen editor for one AI report. Two-column layout:
//   Left  — form fields (name, prompt, schedule, recipients, window)
//   Right — Claude chat sidebar that helps draft the prompt.
//
// The chat extracts any "DRAFT: ..." line from Claude's reply and
// shows it as a one-click "Use this draft" button below the message.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { AiReportRow, Brand, ScheduleType, TimeWindow } from '@/lib/ai-reports/types'
import { describeSchedule } from '@/lib/ai-reports/scheduleMatch'

interface Props {
  report: AiReportRow | null  // null = creating new
  onClose: () => void
  onSaved: () => void
}

interface ChatMsg { role: 'user' | 'assistant'; content: string }

interface UserOption { id: string; name: string; email: string; active: boolean }

export default function AiReportEditor({ report, onClose, onSaved }: Props) {
  const { user } = useApp()
  const isNew = !report

  // Form state
  const [name, setName] = useState(report?.name ?? '')
  const [prompt, setPrompt] = useState(report?.prompt ?? '')
  const [brand, setBrand] = useState<Brand>(report?.brand ?? 'beb')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(report?.schedule_type ?? 'weekly')
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState<number>(report?.schedule_day_of_week ?? 1)
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState<number>(report?.schedule_day_of_month ?? 1)
  const [scheduleHour, setScheduleHour] = useState<number>(report?.schedule_hour ?? 8)
  const [scheduleMinute, setScheduleMinute] = useState<number>(report?.schedule_minute ?? 0)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(report?.time_window ?? 'last_7d')
  const [recipientIds, setRecipientIds] = useState<string[]>(report?.recipient_user_ids ?? [])
  const [active, setActive] = useState<boolean>(report?.active ?? true)

  // Recipient picker
  const [users, setUsers] = useState<UserOption[]>([])
  const [userSearch, setUserSearch] = useState('')

  // Chat sidebar
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  // Voice dictation — appends spoken phrases into the target field.
  const promptMic = useDictation(chunk => setPrompt(p => (p ? p + ' ' : '') + chunk))
  const chatMic = useDictation(chunk => setChatInput(p => (p ? p + ' ' : '') + chunk))

  // Save / preview state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email, active')
        .order('name')
      if (cancelled) return
      setUsers(((data || []) as UserOption[]).filter(u => u.active))
    })()
    return () => { cancelled = true }
  }, [])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [users, userSearch])

  function toggleRecipient(id: string) {
    setRecipientIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function sendChat() {
    const text = chatInput.trim()
    if (!text || chatBusy) return
    const next: ChatMsg[] = [...chat, { role: 'user', content: text }]
    setChat(next)
    setChatInput('')
    setChatBusy(true)
    try {
      const res = await fetch('/api/ai-reports/chat-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail || json?.error || 'Chat failed')
      setChat([...next, { role: 'assistant', content: json.reply }])
    } catch (err) {
      setChat([...next, { role: 'assistant', content: `(error: ${err instanceof Error ? err.message : 'unknown'})` }])
    } finally {
      setChatBusy(false)
    }
  }

  function extractDraft(content: string): string | null {
    const m = content.match(/^DRAFT:\s*(.+)$/m)
    if (!m) return null
    return m[1].trim()
  }

  function validate(): string | null {
    if (!name.trim()) return 'Name is required'
    if (!prompt.trim()) return 'Prompt is required'
    if (recipientIds.length === 0) return 'Pick at least one recipient'
    if (scheduleType === 'weekly' && (scheduleDayOfWeek < 0 || scheduleDayOfWeek > 6)) return 'Pick a weekday'
    if (scheduleType === 'monthly' && (scheduleDayOfMonth < 1 || scheduleDayOfMonth > 31)) return 'Pick a day of month'
    return null
  }

  async function save() {
    const v = validate()
    if (v) { setError(v); return }
    setError(null); setBusy(true); setStatusMsg(null)
    try {
      const payload: Partial<AiReportRow> = {
        name: name.trim(),
        prompt: prompt.trim(),
        brand,
        schedule_type: scheduleType,
        schedule_day_of_week: scheduleType === 'weekly' ? scheduleDayOfWeek : null,
        schedule_day_of_month: scheduleType === 'monthly' ? scheduleDayOfMonth : null,
        schedule_hour: scheduleHour,
        schedule_minute: scheduleMinute,
        time_window: timeWindow,
        recipient_user_ids: recipientIds,
        active,
      }
      if (isNew) {
        const { error: insertErr } = await supabase.from('ai_reports').insert({ ...payload, created_by: user?.id })
        if (insertErr) throw new Error(insertErr.message)
      } else {
        const { error: updateErr } = await supabase.from('ai_reports').update(payload).eq('id', report!.id)
        if (updateErr) throw new Error(updateErr.message)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function preview() {
    if (!report) { setError('Save first, then preview'); return }
    setError(null); setBusy(true); setStatusMsg(null); setPreviewHtml(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`/api/ai-reports/${report.id}/preview`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail || json?.error || 'Preview failed')
      setPreviewHtml(json.html)
      setStatusMsg(`Preview generated — ${json.recipientCount} recipient(s) on the list.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function sendNow() {
    if (!report) { setError('Save first, then send'); return }
    if (!confirm(`Send "${report.name}" now to ${recipientIds.length} recipient(s)?`)) return
    setError(null); setBusy(true); setStatusMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`/api/ai-reports/${report.id}/send-now`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail || json?.error || 'Send failed')
      setStatusMsg(`Sent to ${json.recipientCount} recipient(s).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button onClick={onClose} className="btn-outline btn-sm">← Back</button>
        <h2 className="text-xl font-black" style={{ color: 'var(--ink)' }}>
          {isNew ? 'New Report' : 'Edit Report'}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 18 }}>
        {/* LEFT — form */}
        <div className="card" style={{ background: '#fff' }}>
          <Section title="Basics">
            <Field label="Name">
              <input style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Weekly Liberty Sales Summary" />
            </Field>
            <Field label="Brand">
              <select style={{ width: '100%' }} value={brand} onChange={e => setBrand(e.target.value as Brand)}>
                <option value="beb">BEB</option>
                <option value="liberty">Liberty</option>
              </select>
            </Field>
          </Section>

          <Section title="What should Claude write about?">
            <div style={{ position: 'relative' }}>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6}
                placeholder='e.g. "Summarize last week. Lead with total spend, call out top 3 stores, end with anything unusual."'
                style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical', paddingRight: 40 }} />
              <div style={{ position: 'absolute', top: 6, right: 6 }}>
                <MicButton
                  listening={promptMic.listening}
                  supported={promptMic.supported}
                  onClick={promptMic.toggle}
                  title="Dictate prompt"
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
              Use the chat on the right to brainstorm — Claude will offer drafts you can copy into this field.
              {promptMic.supported && ' Tap 🎤 to dictate.'}
            </div>
          </Section>

          <Section title="Schedule">
            <Field label="When">
              <select style={{ width: '100%' }} value={scheduleType} onChange={e => setScheduleType(e.target.value as ScheduleType)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
            {scheduleType === 'weekly' && (
              <Field label="Day of week">
                <select style={{ width: '100%' }} value={scheduleDayOfWeek} onChange={e => setScheduleDayOfWeek(parseInt(e.target.value))}>
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </Field>
            )}
            {scheduleType === 'monthly' && (
              <Field label="Day of month">
                <select style={{ width: '100%' }} value={scheduleDayOfMonth} onChange={e => setScheduleDayOfMonth(parseInt(e.target.value))}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Time (Eastern)">
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={scheduleHour} onChange={e => setScheduleHour(parseInt(e.target.value))} style={{ width: 80 }}>
                  {Array.from({ length: 24 }, (_, i) => i).map(h => (
                    <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
                  ))}
                </select>
                <span style={{ alignSelf: 'center', color: 'var(--mist)' }}>:</span>
                <select value={scheduleMinute} onChange={e => setScheduleMinute(parseInt(e.target.value))} style={{ width: 80 }}>
                  {[0, 15, 30, 45].map(m => (
                    <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </Field>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 6 }}>
              Will fire: <strong style={{ color: 'var(--ink)' }}>{describeSchedule({
                schedule_type: scheduleType,
                schedule_day_of_week: scheduleDayOfWeek,
                schedule_day_of_month: scheduleDayOfMonth,
                schedule_hour: scheduleHour,
                schedule_minute: scheduleMinute,
              })}</strong>
            </div>
          </Section>

          <Section title="Data window">
            <Field label="Time range to include">
              <select style={{ width: '100%' }} value={timeWindow} onChange={e => setTimeWindow(e.target.value as TimeWindow)}>
                <option value="last_7d">Last 7 days</option>
                <option value="last_30d">Last 30 days</option>
                <option value="last_90d">Last 90 days</option>
                <option value="current_month">Current month</option>
              </select>
            </Field>
          </Section>

          <Section title={`Recipients (${recipientIds.length} selected)`}>
            <input
              placeholder="Search by name or email"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <div style={{
              maxHeight: 220, overflowY: 'auto',
              border: '1px solid var(--pearl)',
              borderRadius: 6, background: 'var(--cream)',
            }}>
              {filteredUsers.map(u => {
                const checked = recipientIds.includes(u.id)
                return (
                  <label key={u.id} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '6px 10px', cursor: 'pointer',
                    borderBottom: '1px solid var(--pearl)',
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleRecipient(u.id)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u.email}</div>
                    </div>
                  </label>
                )
              })}
              {filteredUsers.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: 'var(--mist)', textAlign: 'center' }}>
                  No matching users
                </div>
              )}
            </div>
          </Section>

          <Section title="Active">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span style={{ fontSize: 13 }}>
                Fire on schedule (uncheck to pause without deleting)
              </span>
            </label>
          </Section>

          {error && (
            <div className="notice notice-ruby" style={{ marginTop: 12 }}>{error}</div>
          )}
          {statusMsg && (
            <div className="notice notice-jade" style={{ marginTop: 12 }}>{statusMsg}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={busy} className="btn-primary btn-sm">
              {busy ? 'Saving…' : isNew ? 'Save Report' : 'Save Changes'}
            </button>
            {!isNew && (
              <>
                <button onClick={preview} disabled={busy} className="btn-outline btn-sm">
                  Preview (don't send)
                </button>
                <button onClick={sendNow} disabled={busy} className="btn-ghost btn-sm">
                  Send Now
                </button>
              </>
            )}
            <button onClick={onClose} disabled={busy} className="btn-outline btn-sm">Cancel</button>
          </div>

          {previewHtml && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mist)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Preview
              </div>
              <iframe
                srcDoc={previewHtml}
                style={{ width: '100%', height: 520, border: '1px solid var(--pearl)', borderRadius: 8, background: '#fff' }}
                title="Preview"
              />
            </div>
          )}
        </div>

        {/* RIGHT — Claude chat sidebar */}
        <div className="card" style={{ background: '#fff', height: 'fit-content', position: 'sticky', top: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
            ✨ Brainstorm with Claude
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
            Describe what you want this report to cover. Claude will help shape the prompt.
          </div>

          <div style={{
            maxHeight: 420, overflowY: 'auto',
            border: '1px solid var(--pearl)',
            borderRadius: 6, padding: 8, background: 'var(--cream)',
            display: 'flex', flexDirection: 'column', gap: 8,
            marginBottom: 8,
          }}>
            {chat.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--mist)', textAlign: 'center', padding: 16 }}>
                Start the conversation — e.g. <em>"I want a weekly summary of our top stores"</em>
              </div>
            )}
            {chat.map((m, i) => {
              const draft = m.role === 'assistant' ? extractDraft(m.content) : null
              return (
                <div key={i} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  background: m.role === 'user' ? 'var(--green-pale)' : '#fff',
                  border: '1px solid var(--pearl)',
                  borderRadius: 8, padding: '6px 10px',
                  fontSize: 12, lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.content}
                  {draft && (
                    <button
                      type="button"
                      onClick={() => setPrompt(draft)}
                      className="btn-outline btn-xs"
                      style={{ marginTop: 6, display: 'block' }}
                    >
                      ↗ Use this draft
                    </button>
                  )}
                </div>
              )
            })}
            {chatBusy && (
              <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--mist)' }}>
                <em>Claude is thinking…</em>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendChat() } }}
              placeholder={chatMic.listening ? 'Listening… speak now' : 'Ask Claude to help draft your prompt…'}
              rows={2}
              style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical', paddingRight: 40 }}
            />
            <div style={{ position: 'absolute', top: 6, right: 6 }}>
              <MicButton
                listening={chatMic.listening}
                supported={chatMic.supported}
                onClick={chatMic.toggle}
                title="Dictate to Claude"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()} className="btn-primary btn-sm">
              {chatBusy ? 'Sending…' : 'Send'}
            </button>
            {chatMic.listening && (
              <span style={{ fontSize: 11, color: 'var(--ruby, #dc2626)', fontWeight: 600 }}>● Listening</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Browser-native voice input via the Web Speech API. Chrome / Edge / Safari support it;
// Firefox does not — the button is hidden when unsupported.
function useDictation(append: (chunk: string) => void) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recRef = useRef<unknown>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition))
  }, [])

  function toggle() {
    if (typeof window === 'undefined') return
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) return
    const current = recRef.current as { stop: () => void } | null
    if (current) { current.stop(); return }
    const rec = new SR() as {
      lang: string; interimResults: boolean; continuous: boolean
      onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void
      onend: () => void; onerror: () => void; start: () => void; stop: () => void
    }
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) append(r[0].transcript.trim())
      }
    }
    rec.onend = () => { recRef.current = null; setListening(false) }
    rec.onerror = () => { recRef.current = null; setListening(false) }
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return { listening, supported, toggle }
}

function MicButton({ listening, supported, onClick, title }: {
  listening: boolean; supported: boolean; onClick: () => void; title: string
}) {
  if (!supported) return null
  return (
    <button
      type="button"
      onClick={onClick}
      title={listening ? 'Stop dictation' : title}
      aria-label={listening ? 'Stop dictation' : title}
      style={{
        border: '1px solid var(--pearl)',
        background: listening ? 'var(--ruby, #dc2626)' : '#fff',
        color: listening ? '#fff' : 'var(--ink)',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 14,
        lineHeight: 1,
        cursor: 'pointer',
        animation: listening ? 'beb-mic-pulse 1.2s ease-in-out infinite' : undefined,
      }}
    >
      {listening ? '⏺︎' : '🎤'}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}
