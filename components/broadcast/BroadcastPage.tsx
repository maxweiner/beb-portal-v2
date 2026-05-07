'use client'

// Broadcast tool — superadmin/partner-only message blasts.
// Tabs: Compose (the editor) and History (past sends + duplicate).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import Checkbox from '@/components/ui/Checkbox'
import RichTextEditor from './RichTextEditor'

type Brand = 'beb' | 'liberty'
type ScopeKind = 'all' | 'role' | 'individual'

interface RecipientPreview {
  count: number
  sample: { id: string; name: string; email: string }[]
}

interface HistoryRow {
  id: string
  brand: Brand
  subject: string
  scope_kind: ScopeKind
  scope_role: string | null
  scope_user_ids: string[]
  show_in_app: boolean
  recipient_count: number
  sent_at: string
  sender_name: string
  cta_label?: string | null
  cta_url?: string | null
  body_html?: string
  stats: { sent: number; opened: number; clicked: number; failed: number }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

const ROLE_OPTIONS = [
  'buyer', 'admin', 'superadmin', 'marketing', 'accounting', 'sales_rep', 'pending',
]

export default function BroadcastPage() {
  const { user, users } = useApp()
  const isAllowed = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true

  const [tab, setTab] = useState<'compose' | 'history'>('compose')

  // Compose state
  const [brand, setBrand] = useState<Brand>('beb')
  const [scopeKind, setScopeKind] = useState<ScopeKind>('all')
  const [scopeRole, setScopeRole] = useState<string>('buyer')
  const [scopeUserIds, setScopeUserIds] = useState<Set<string>>(new Set())
  const [userSearch, setUserSearch] = useState('')

  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [showInApp, setShowInApp] = useState(false)

  const [recipients, setRecipients] = useState<RecipientPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  // Resolve recipients on every relevant change.
  useEffect(() => {
    if (!isAllowed) return
    const params = new URLSearchParams({ scope: scopeKind, brand })
    if (scopeKind === 'role') params.set('role', scopeRole)
    if (scopeKind === 'individual') params.set('user_ids', [...scopeUserIds].join(','))
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/broadcast/recipients?${params}`, { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.ok) setRecipients({ count: j.count || 0, sample: j.sample || [] })
      } catch { /* tolerate */ }
    })()
    return () => { cancelled = true }
  }, [isAllowed, brand, scopeKind, scopeRole, scopeUserIds])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return (users || [])
      .filter((u: any) => u.active !== false)
      .filter((u: any) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
  }, [users, userSearch])

  function toggleUserId(id: string) {
    setScopeUserIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const recipientCount = recipients?.count ?? 0
  const requiresTypeConfirm = recipientCount > 10

  async function sendTest() {
    setTestStatus(null)
    try {
      const r = await fetch('/api/broadcast/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          subject, body_html: bodyHtml, brand,
          cta_label: ctaLabel || undefined,
          cta_url: ctaUrl || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) { setTestStatus(`❌ ${j.error || r.statusText}`); return }
      setTestStatus(`✓ Test sent to ${j.sent_to}. Check your inbox.`)
    } catch (e: any) {
      setTestStatus(`❌ ${e?.message || 'Test failed'}`)
    }
  }

  function openConfirm() {
    if (!subject.trim()) { alert('Subject is required.'); return }
    if (!bodyHtml.trim() || bodyHtml === '<br>' || bodyHtml === '<p></p>') { alert('Write a message first.'); return }
    if (recipientCount === 0) { alert('No recipients match the current scope.'); return }
    if (ctaLabel && !ctaUrl)  { alert('CTA label set but no URL — fill in the URL or clear the label.'); return }
    if (ctaUrl && !ctaLabel)  { alert('CTA URL set but no label — fill in the label or clear the URL.'); return }
    setConfirmText('')
    setConfirmOpen(true)
  }

  async function send() {
    if (requiresTypeConfirm && confirmText.trim().toUpperCase() !== 'SEND') return
    setBusy(true); setSendResult(null)
    try {
      const r = await fetch('/api/broadcast/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          subject, body_html: bodyHtml, brand,
          cta_label: ctaLabel || undefined,
          cta_url: ctaUrl || undefined,
          show_in_app: showInApp,
          scope: {
            kind: scopeKind,
            ...(scopeKind === 'role' ? { role: scopeRole } : {}),
            ...(scopeKind === 'individual' ? { user_ids: [...scopeUserIds] } : {}),
          },
        }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Send failed: ${j.error || r.statusText}`); return }
      setSendResult({ sent: j.sent_count, failed: j.failed_count, total: j.total })
      setConfirmOpen(false)
      // Reset compose so a stray click doesn't re-send.
      setSubject(''); setBodyHtml(''); setCtaLabel(''); setCtaUrl(''); setShowInApp(false)
    } finally {
      setBusy(false)
    }
  }

  function loadIntoEditor(b: HistoryRow) {
    setSubject(b.subject)
    setBodyHtml(b.body_html || '')
    setCtaLabel(b.cta_label || '')
    setCtaUrl(b.cta_url || '')
    setShowInApp(!!b.show_in_app)
    setBrand(b.brand)
    setScopeKind(b.scope_kind)
    if (b.scope_role) setScopeRole(b.scope_role)
    if (b.scope_user_ids?.length) setScopeUserIds(new Set(b.scope_user_ids))
    setTab('compose')
  }

  if (!isAllowed) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ fontSize: 16 }}>Broadcast — superadmin/partner only</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>📣 Broadcast</h1>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--cream2)', borderRadius: 'var(--r)' }}>
          {(['compose', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              background: tab === t ? 'var(--sidebar-bg)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--ash)',
            }}>{t === 'compose' ? '✍️ Compose' : '📜 History'}</button>
          ))}
        </div>
      </div>

      {tab === 'compose' && (
        <ComposeView
          {...{
            brand, setBrand, scopeKind, setScopeKind, scopeRole, setScopeRole,
            scopeUserIds, toggleUserId, userSearch, setUserSearch, filteredUsers,
            subject, setSubject, bodyHtml, setBodyHtml,
            ctaLabel, setCtaLabel, ctaUrl, setCtaUrl, showInApp, setShowInApp,
            recipients, recipientCount,
            sendTest, openConfirm, sendResult, testStatus,
          }}
        />
      )}

      {tab === 'history' && (
        <HistoryView onDuplicate={loadIntoEditor} />
      )}

      {confirmOpen && (
        <ConfirmModal
          recipientCount={recipientCount}
          requiresTypeConfirm={requiresTypeConfirm}
          confirmText={confirmText}
          setConfirmText={setConfirmText}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={send}
          subject={subject}
          brand={brand}
        />
      )}
    </div>
  )
}

/* ─────── Compose view ─────── */

function ComposeView(props: any) {
  const {
    brand, setBrand, scopeKind, setScopeKind, scopeRole, setScopeRole,
    scopeUserIds, toggleUserId, userSearch, setUserSearch, filteredUsers,
    subject, setSubject, bodyHtml, setBodyHtml,
    ctaLabel, setCtaLabel, ctaUrl, setCtaUrl, showInApp, setShowInApp,
    recipients, recipientCount,
    sendTest, openConfirm, sendResult, testStatus,
  } = props
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.1fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* LEFT — editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card" style={{ background: '#fff', padding: 16 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Brand *</label>
            <select value={brand} onChange={e => setBrand(e.target.value)}>
              <option value="beb">BEB</option>
              <option value="liberty">Liberty</option>
            </select>
          </div>

          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Recipients *</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {([
                ['all', '👥 All users'],
                ['role', '🎭 By role'],
                ['individual', '👤 Pick people'],
              ] as [string, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScopeKind(k)}
                  style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                    border: `1.5px solid ${scopeKind === k ? 'var(--green-dark)' : 'var(--pearl)'}`,
                    background: scopeKind === k ? 'var(--green-pale)' : '#fff',
                    color: scopeKind === k ? 'var(--green-dark)' : 'var(--ash)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{label}</button>
              ))}
            </div>

            {scopeKind === 'role' && (
              <select value={scopeRole} onChange={e => setScopeRole(e.target.value)}>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}

            {scopeKind === 'individual' && (
              <div>
                <input
                  type="search" placeholder="Search users…"
                  value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  style={{ marginBottom: 6 }}
                />
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--pearl)', borderRadius: 6, padding: 8 }}>
                  {filteredUsers.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', padding: 6 }}>No users match.</div>}
                  {filteredUsers.map((u: any) => (
                    <div key={u.id} style={{ padding: '4px 0' }}>
                      <Checkbox
                        checked={scopeUserIds.has(u.id)}
                        onChange={() => toggleUserId(u.id)}
                        label={
                          <span style={{ fontSize: 13 }}>
                            {u.name || '(no name)'}{' '}
                            <span style={{ color: 'var(--mist)' }}>· {u.email}</span>
                          </span>
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Subject *</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Welcome to the new BEB Portal!" />
          </div>

          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Message *</label>
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Welcome to the new portal! Click around — every report you used to get from spreadsheets is now one click away…" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, marginBottom: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">CTA button label (optional)</label>
              <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Open the Portal" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">CTA button URL</label>
              <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://buyer.bebllp.com" />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <Checkbox
              checked={showInApp}
              onChange={setShowInApp}
              label={<span style={{ fontSize: 13 }}>📌 Also show as in-app banner (so phone-only users see it next time they sign in)</span>}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button onClick={sendTest} className="btn-outline">🧪 Send Test to Me</button>
            <button onClick={openConfirm} className="btn-primary" disabled={recipientCount === 0}>
              📨 Send to {recipientCount} {recipientCount === 1 ? 'person' : 'people'}…
            </button>
          </div>
          {testStatus && <div style={{ fontSize: 12, color: 'var(--ash)', marginTop: 6 }}>{testStatus}</div>}
          {sendResult && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#E6F4EC', fontSize: 13 }}>
              ✓ Sent {sendResult.sent} · {sendResult.failed > 0 ? `${sendResult.failed} failed · ` : ''}of {sendResult.total} total
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — preview + recipients sample */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 16 }}>
        <div style={{ background: '#F5F0E8', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Live preview
          </div>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
            <div style={{ padding: '20px 24px 12px', textAlign: 'center', borderBottom: '1px solid #EDE7DA' }}>
              <img src={`/api/brand-logo?brand=${brand}`} alt="logo" style={{ maxWidth: 200, height: 'auto' }} />
            </div>
            <div style={{ padding: '16px 24px 22px', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Subject: {subject || <em>(empty)</em>}
              </div>
              <div dangerouslySetInnerHTML={{ __html: bodyHtml || '<p style="color:#888"><em>(start typing the message)</em></p>' }} />
              {ctaLabel && ctaUrl && (
                <div style={{ marginTop: 16 }}>
                  <a href={ctaUrl} target="_blank" rel="noreferrer" style={{
                    display: 'inline-block', background: 'var(--green-dark)', color: '#fff',
                    textDecoration: 'none', padding: '12px 20px', borderRadius: 8,
                    fontWeight: 800, fontSize: 14,
                  }}>{ctaLabel}</a>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 24px', background: '#F5F0E8', borderTop: '1px solid #EDE7DA', textAlign: 'center', fontSize: 11, color: 'var(--mist)' }}>
              {brand === 'liberty' ? 'Liberty Estate Buyers' : 'Beneficial Estate Buyers'}
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            Recipients ({recipientCount})
          </div>
          {recipients?.sample.length ? (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--ash)' }}>
              {recipients.sample.map((r: any) => (
                <li key={r.id}>{r.name || r.email}</li>
              ))}
              {recipientCount > recipients.sample.length && (
                <li style={{ color: 'var(--mist)', fontStyle: 'italic' }}>+ {recipientCount - recipients.sample.length} more…</li>
              )}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>No recipients match the current scope.</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────── History view ─────── */

function HistoryView({ onDuplicate }: { onDuplicate: (b: HistoryRow) => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/broadcast/history', { headers: await authHeaders() })
      const j = await r.json()
      setRows(j.broadcasts || [])
    })()
  }, [])

  async function duplicate(id: string) {
    setBusyId(id)
    try {
      const r = await fetch(`/api/broadcast/${id}`, { headers: await authHeaders() })
      const j = await r.json()
      if (j.broadcast) onDuplicate(j.broadcast)
    } finally {
      setBusyId(null)
    }
  }

  if (rows == null) return <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
  if (rows.length === 0) {
    return <div style={{ color: 'var(--mist)', fontSize: 13, padding: 20, textAlign: 'center' }}>
      No broadcasts yet. Click Compose to send the first one.
    </div>
  }
  return (
    <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 100px 110px 140px', background: 'var(--cream2)', padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        <div>Subject</div>
        <div>Sent by · When</div>
        <div>Recipients</div>
        <div>Engagement</div>
        <div></div>
      </div>
      {rows.map(b => (
        <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 100px 110px 140px', padding: '10px 14px', borderTop: '1px solid var(--cream2)', alignItems: 'center', fontSize: 13 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{b.subject}</div>
            <div style={{ fontSize: 11, color: 'var(--mist)' }}>{b.brand.toUpperCase()} · {b.scope_kind === 'all' ? 'All users' : b.scope_kind === 'role' ? `Role: ${b.scope_role}` : `${b.scope_user_ids.length} picked`}{b.show_in_app ? ' · 📌' : ''}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink)' }}>{b.sender_name}</div>
            <div style={{ fontSize: 11, color: 'var(--mist)' }}>{new Date(b.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{b.recipient_count}</div>
          <div style={{ fontSize: 12, color: 'var(--ash)' }}>
            {b.stats.opened}/{b.stats.sent} opened
            {b.stats.clicked > 0 && <span style={{ color: 'var(--green-dark)' }}> · {b.stats.clicked} clicked</span>}
            {b.stats.failed > 0 && <span style={{ color: 'var(--red)' }}> · {b.stats.failed} failed</span>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <button onClick={() => duplicate(b.id)} disabled={busyId === b.id} className="btn-outline btn-xs">
              {busyId === b.id ? '…' : '📋 Duplicate'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─────── Confirm modal ─────── */

function ConfirmModal({
  recipientCount, requiresTypeConfirm, confirmText, setConfirmText,
  busy, onCancel, onConfirm, subject, brand,
}: {
  recipientCount: number
  requiresTypeConfirm: boolean
  confirmText: string
  setConfirmText: (s: string) => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  subject: string
  brand: string
}) {
  const canSend = !busy && (!requiresTypeConfirm || confirmText.trim().toUpperCase() === 'SEND')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: 12, width: 'min(520px, 100%)', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>📨 Send broadcast?</div>
        <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 14, lineHeight: 1.5 }}>
          About to send <b>"{subject}"</b> to <b>{recipientCount}</b> {recipientCount === 1 ? 'person' : 'people'} on the <b>{brand.toUpperCase()}</b> brand.
        </div>
        {requiresTypeConfirm && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--mist)' }}>
              Type <code style={{ background: 'var(--cream)', padding: '1px 6px', borderRadius: 4 }}>SEND</code> to confirm:
            </label>
            <input
              type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
              placeholder="SEND" autoFocus style={{ marginTop: 4 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn-outline" disabled={busy}>Cancel</button>
          <button onClick={onConfirm} className="btn-primary" disabled={!canSend}>
            {busy ? 'Sending…' : `📨 Send to ${recipientCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}
