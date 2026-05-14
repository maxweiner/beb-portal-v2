'use client'

// W-9 panel inside the Accounting Hub. Header button "📧 Send W-9"
// opens a modal with two tabs (internal user picker / external name
// + email). Below the button a small history table lists recent
// W-9 requests with status, copy-link, resend, revoke.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import Checkbox from '@/components/ui/Checkbox'
import type { W9Request, User } from '@/types'

async function authHeader(): Promise<string> {
  const s = await supabase.auth.getSession()
  return s.data.session?.access_token || ''
}

export default function W9Panel() {
  const { brand, users } = useApp() as any
  const [modalOpen, setModalOpen] = useState(false)
  const [list, setList] = useState<W9Request[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!brand) return
    setLoading(true)
    try {
      const r = await fetch(`/api/w9?brand=${brand}&limit=50`, {
        headers: { Authorization: `Bearer ${await authHeader()}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Load failed')
      setList(j.requests || [])
    } catch (e: any) {
      setError(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [brand])

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>📧 W-9 Requests</h2>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          Send IRS Form W-9 to vendors / staff for tax documentation.
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setModalOpen(true)} className="btn-primary btn-sm">📧 Send W-9</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>No W-9 requests yet.</div>
      ) : (
        <W9History list={list} onChange={reload} />
      )}

      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>⚠ {error}</div>}

      {modalOpen && (
        <SendW9Modal
          brand={brand}
          users={users || []}
          onClose={() => setModalOpen(false)}
          onSent={() => { setModalOpen(false); reload() }}
        />
      )}
    </div>
  )
}


// ── History list ───────────────────────────────────────────────

function W9History({ list, onChange }: { list: W9Request[]; onChange: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function callAction(id: string, action: 'resend' | 'revoke', reason?: string) {
    setBusyId(id); setFlash(null)
    try {
      const r = await fetch(`/api/w9/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await authHeader()}` },
        body: JSON.stringify({ action, reason }),
      })
      const j = await r.json()
      if (!r.ok) { setFlash(`⚠ ${j.error || 'Failed'}`); }
      else if (action === 'resend' && j.sentTo) setFlash(`✓ Resent to ${j.sentTo}`)
      else if (action === 'revoke') setFlash('✓ Revoked')
      await onChange()
    } catch (e: any) {
      setFlash(`⚠ ${e?.message || 'Network error'}`)
    }
    setBusyId(null)
  }

  function copyLink(token: string) {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/w9/${token}` : `/w9/${token}`
    try {
      navigator.clipboard.writeText(url)
      setFlash('Copied URL to clipboard')
    } catch {
      setFlash('⚠ Could not copy')
    }
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: 'var(--cream2, #F5F5DC)' }}>
            <tr>
              <Th>Recipient</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
              <Th>Opened</Th>
              <Th>Signed</Th>
              <Th style={{ textAlign: 'right' }}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.map(w => {
              const isInternal = !!w.recipient_user_id
              const live = w.status === 'pending' || w.status === 'opened'
              return (
                <tr key={w.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{w.recipient_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--mist)' }}>{w.recipient_email}</div>
                  </td>
                  <td style={td}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 4,
                      background: isInternal ? '#E0E7FF' : '#FEF3C7',
                      color: isInternal ? '#3730A3' : '#92400E',
                    }}>{isInternal ? 'Internal' : 'External'}</span>
                  </td>
                  <td style={td}>
                    <StatusPill status={w.status} />
                  </td>
                  <td style={td}>{w.last_sent_at ? fmtRel(w.last_sent_at) : '—'}</td>
                  <td style={td}>{w.open_count > 0 ? `${w.open_count}× · ${fmtRel(w.last_opened_at!)}` : '—'}</td>
                  <td style={td}>{w.signed_at ? fmtRel(w.signed_at) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => copyLink(w.token)} className="btn-outline btn-xs" disabled={busyId === w.id}>Copy link</button>
                    {live && (
                      <>
                        {' '}
                        <button onClick={() => callAction(w.id, 'resend')} className="btn-outline btn-xs" disabled={busyId === w.id}>Resend</button>
                        {' '}
                        <button onClick={() => {
                          const reason = prompt('Reason for revoking? (optional)') ?? ''
                          if (confirm('Revoke this W-9 link? The recipient will no longer be able to submit.')) {
                            callAction(w.id, 'revoke', reason || undefined)
                          }
                        }} className="btn-outline btn-xs" disabled={busyId === w.id} style={{ color: '#991B1B' }}>Revoke</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {flash && <div style={{ marginTop: 8, fontSize: 12, color: flash.startsWith('⚠') ? '#991B1B' : '#065F46' }}>{flash}</div>}
    </div>
  )
}


// ── Send modal ─────────────────────────────────────────────────

function SendW9Modal({
  brand, users, onClose, onSent,
}: {
  brand: string
  users: User[]
  onClose: () => void
  onSent: () => void
}) {
  const [tab, setTab] = useState<'internal' | 'external'>('internal')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [externalEmail, setExternalEmail] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; sentTo: string | null } | null>(null)

  const activeUsers = useMemo(
    () => (users || []).filter((u: any) => u.active !== false).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')),
    [users],
  )

  async function send() {
    setError(null)
    if (tab === 'internal' && !selectedUserId) return setError('Pick a user.')
    if (tab === 'external') {
      if (!externalName.trim()) return setError('Recipient name required.')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalEmail.trim())) return setError('Valid email required.')
    }
    setBusy(true)
    try {
      const body: any = { brand, send_email: sendEmail }
      if (tab === 'internal') body.recipient_user_id = selectedUserId
      else { body.recipient_name = externalName.trim(); body.recipient_email = externalEmail.trim() }

      const r = await fetch('/api/w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await authHeader()}` },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || `Failed (${r.status})`)
      } else {
        setResult({ url: j.url, sentTo: j.sentTo })
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusy(false)
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, maxWidth: 540, width: '100%', padding: 22, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>📧 Send W-9</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9CA3AF', cursor: 'pointer' }}>×</button>
        </div>

        {result ? (
          <div>
            <div style={{ padding: 12, background: '#D1FAE5', color: '#065F46', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
              ✓ W-9 request created.
              {result.sentTo ? <> Email sent to <strong>{result.sentTo}</strong>.</> : <> Email not sent (no API key); copy the URL below.</>}
            </div>
            <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
              <code style={{ wordBreak: 'break-all' }}>{result.url}</code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(result.url)} className="btn-outline btn-sm">Copy URL</button>
              <button onClick={onSent} className="btn-primary btn-sm">Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <button onClick={() => setTab('internal')} style={tabBtn(tab === 'internal')}>👤 Internal user</button>
              <button onClick={() => setTab('external')} style={tabBtn(tab === 'external')}>📨 External (by email)</button>
            </div>

            {tab === 'internal' && (
              <div>
                <label style={lbl}>Pick a portal user</label>
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} style={ipt}>
                  <option value="">— choose —</option>
                  {activeUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
                  Will be hard-blocked from the portal on next login until they submit.
                </p>
              </div>
            )}

            {tab === 'external' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={lbl}>Recipient name</label>
                  <input value={externalName} onChange={e => setExternalName(e.target.value)} placeholder="Jane Smith" style={ipt} />
                </div>
                <div>
                  <label style={lbl}>Recipient email</label>
                  <input type="email" value={externalEmail} onChange={e => setExternalEmail(e.target.value)} placeholder="jane@example.com" style={ipt} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--mist)' }}>
                  External vendors don&apos;t need a portal account — they just open the link from the email and sign.
                </p>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <Checkbox
                checked={sendEmail}
                onChange={setSendEmail}
                label="Email the link now (uncheck if you just want the URL to copy)"
                labelStyle={{ fontSize: 13 }}
              />
            </div>

            {error && <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>⚠ {error}</div>}

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} className="btn-outline btn-sm" disabled={busy}>Cancel</button>
              <button onClick={send} className="btn-primary btn-sm" disabled={busy}>
                {busy ? 'Sending…' : 'Create request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ── small helpers ──────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending:   { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
    opened:    { bg: '#DBEAFE', fg: '#1E40AF', label: 'Opened' },
    completed: { bg: '#D1FAE5', fg: '#065F46', label: '✓ Completed' },
    expired:   { bg: '#F3F4F6', fg: '#6B7280', label: 'Expired' },
    revoked:   { bg: '#FEE2E2', fg: '#991B1B', label: 'Revoked' },
  }
  const s = map[status] || { bg: '#F3F4F6', fg: '#374151', label: status }
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', ...style }}>{children}</th>
}

const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' }

function fmtRel(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diffMs / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    return `${days}d ago`
  } catch { return '' }
}

const ipt: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '7px 9px',
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 800, color: '#374151',
  textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4,
}
function tabBtn(sel: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 6,
    fontSize: 13, fontWeight: 700, border: '1px solid var(--pearl)',
    background: sel ? 'var(--green-dark)' : '#fff',
    color: sel ? '#fff' : 'var(--ink)',
    cursor: 'pointer', fontFamily: 'inherit',
  }
}
