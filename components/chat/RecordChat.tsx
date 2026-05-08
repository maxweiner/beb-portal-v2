'use client'

// <RecordChat record_kind=… record_id=… /> — drop-in chat panel for
// any record. Lists existing threads, lets the operator start a new
// one (pick recipient from useApp().users), and shows the active
// thread's messages with a compose box.
//
// Outbound channels per message: in-app default + optional Email
// and SMS toggles. The thread row badges unread counts.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  recordKind: string
  recordId: string
  /** Visible heading; defaults to "💬 Chat". */
  title?: string
}

interface Thread {
  id: string
  external_user_id: string | null
  external_name: string | null
  external_email: string | null
  external_phone: string | null
  reply_token: string
  subject: string | null
  status: 'active' | 'closed'
  last_message_at: string
  unread: number
}

interface Message {
  id: string
  sender_user_id: string | null
  sender_display_name: string
  body: string
  channel_in: 'web' | 'email' | 'sms' | 'system'
  channels_out: string[]
  delivery_status?: Record<string, { status: string; error?: string }>
  created_at: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function RecordChat({ recordKind, recordId, title = '💬 Chat' }: Props) {
  const { users, user } = useApp()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [alsoEmail, setAlsoEmail] = useState(false)
  const [alsoSms, setAlsoSms] = useState(false)
  const [sending, setSending] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newRecipient, setNewRecipient] = useState('')
  const [newSubject, setNewSubject] = useState('')

  async function reloadThreads() {
    const r = await fetch(`/api/chat/threads?record_kind=${encodeURIComponent(recordKind)}&record_id=${encodeURIComponent(recordId)}`, {
      headers: await authHeaders(),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setThreads(j.threads || [])
      if (!activeId && (j.threads || []).length > 0) setActiveId(j.threads[0].id)
    }
  }
  useEffect(() => { reloadThreads() }, [recordKind, recordId])

  async function loadMessages(threadId: string) {
    const r = await fetch(`/api/chat/threads/${threadId}/messages`, { headers: await authHeaders() })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setMessages(j.messages || [])
      // Mark as read.
      void fetch(`/api/chat/threads/${threadId}/read`, { method: 'POST', headers: await authHeaders() })
    }
  }
  useEffect(() => {
    if (activeId) void loadMessages(activeId)
  }, [activeId])

  async function send() {
    if (!activeId || !draft.trim()) return
    setSending(true)
    try {
      const r = await fetch(`/api/chat/threads/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ body: draft, also_email: alsoEmail, also_sms: alsoSms }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert(`Send failed: ${j.error || r.statusText}`); return }
      setDraft('')
      await loadMessages(activeId)
      await reloadThreads()
    } finally {
      setSending(false)
    }
  }

  async function startThread() {
    if (!newRecipient) { alert('Pick a recipient'); return }
    const r = await fetch('/api/chat/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        record_kind: recordKind,
        record_id: recordId,
        external_user_id: newRecipient,
        subject: newSubject || null,
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(`Could not start thread: ${j.error || r.statusText}`); return }
    setShowNew(false)
    setNewRecipient(''); setNewSubject('')
    await reloadThreads()
    setActiveId(j.thread_id)
  }

  const eligibleRecipients = useMemo(
    () => (users || []).filter((u: any) => u.active !== false && u.id !== user?.id),
    [users, user?.id],
  )

  return (
    <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--cream2)', borderBottom: '1px solid var(--pearl)' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
        <button onClick={() => setShowNew(o => !o)} className="btn-outline btn-xs">
          {showNew ? '✕ Cancel' : '+ New'}
        </button>
      </div>

      {showNew && (
        <div style={{ padding: 14, borderBottom: '1px solid var(--cream2)' }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Recipient *</label>
            <select value={newRecipient} onChange={e => setNewRecipient(e.target.value)}>
              <option value="">Pick someone…</option>
              {eligibleRecipients.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Subject (optional)</label>
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="Did you book the rental car?" />
          </div>
          <button onClick={startThread} className="btn-primary btn-sm">Start chat</button>
        </div>
      )}

      {threads.length === 0 ? (
        !showNew && (
          <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13, textAlign: 'center' }}>
            No chat threads yet. Click + New to start one.
          </div>
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', minHeight: 320 }}>
          {/* Thread list */}
          <div style={{ borderRight: '1px solid var(--cream2)', overflowY: 'auto', maxHeight: 460 }}>
            {threads.map(t => {
              const sel = activeId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--cream2)',
                    background: sel ? 'var(--green-pale)' : 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.external_name || '(unknown)'}
                    </span>
                    {t.unread > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 99, background: 'var(--red)', color: '#fff' }}>{t.unread}</span>
                    )}
                  </div>
                  {t.subject && (
                    <div style={{ fontSize: 11, color: 'var(--mist)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {t.subject}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Active thread */}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 460 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 && (
                <div style={{ color: 'var(--mist)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  No messages yet. Type below and hit Send.
                </div>
              )}
              {messages.map(m => {
                const isInternal = !!m.sender_user_id
                const isSystem   = m.channel_in === 'system'
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isSystem ? 'center' : isInternal ? 'flex-end' : 'flex-start',
                      maxWidth: '78%',
                      background: isSystem ? 'transparent' : isInternal ? 'var(--green-pale)' : 'var(--cream2)',
                      color: isSystem ? 'var(--mist)' : 'var(--ink)',
                      fontSize: 13, lineHeight: 1.5,
                      padding: isSystem ? '4px 8px' : '8px 12px',
                      borderRadius: 10,
                      fontStyle: isSystem ? 'italic' : 'normal',
                    }}
                  >
                    {!isSystem && (
                      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, marginBottom: 2 }}>
                        {m.sender_display_name}
                        {m.channel_in === 'email' && ' · via email'}
                        {m.channel_in === 'sms' && ' · via SMS'}
                        {m.channels_out.length > 0 && ` · sent ${m.channels_out.join('+')}`}
                      </div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                    <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4 }}>
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Compose */}
            {activeId && (
              <div style={{ borderTop: '1px solid var(--cream2)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  rows={2}
                  style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Checkbox checked={alsoEmail} onChange={setAlsoEmail} label={<span style={{ fontSize: 12, color: 'var(--ash)' }}>📧 Also email</span>} />
                  <Checkbox checked={alsoSms}   onChange={setAlsoSms}   label={<span style={{ fontSize: 12, color: 'var(--ash)' }}>📱 Also SMS</span>} />
                  <button onClick={send} disabled={sending || !draft.trim()} className="btn-primary btn-sm" style={{ marginLeft: 'auto' }}>
                    {sending ? 'Sending…' : '📨 Send'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
