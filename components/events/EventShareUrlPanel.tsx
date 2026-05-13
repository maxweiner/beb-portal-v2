'use client'

// Staff-side controls for the per-STORE share URL (the /e/[token]
// public dashboard with the event picker). Sits inside the internal
// event summary page at app/event/[id] for convenience, but the
// token itself is store-scoped — store owners get one durable URL.
//
// All mutations go through /api/store/[id]/share-token.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TokenRow {
  id: string
  token: string
  last_sent_at: string | null
  last_sent_to: string | null
  view_count: number
  first_viewed_at: string | null
  revoked_at: string | null
}

interface Props {
  storeId: string
  /** Pre-fetched current active token (or null). Avoids a flash of
   *  "Loading…" on first paint since the server already knows it. */
  initialToken: TokenRow | null
  /** Pre-fetched store owner_email for the recipient hint. */
  ownerEmail: string | null
}

async function authHeader(): Promise<string> {
  const s = await supabase.auth.getSession()
  return s.data.session?.access_token || ''
}

export default function EventShareUrlPanel({ storeId, initialToken, ownerEmail }: Props) {
  const [token, setToken] = useState<TokenRow | null>(initialToken)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [recipientOverride, setRecipientOverride] = useState('')

  // Build the public URL from the current token + origin (computed
  // client-side so preview deploys, custom domains, and localhost all
  // work without env variables).
  const publicUrl = token
    ? (typeof window !== 'undefined' ? `${window.location.origin}/e/${token.token}` : `/e/${token.token}`)
    : ''

  async function call(action: 'mint' | 'rotate' | 'revoke' | 'send', to?: string) {
    setBusy(true); setError(null); setFlash(null)
    try {
      const r = await fetch(`/api/store/${storeId}/share-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await authHeader()}` },
        body: JSON.stringify({ action, ...(to ? { to } : {}) }),
      })
      const json = await r.json()
      if (!r.ok) {
        setError(json.error || `Failed (${r.status})`)
        // Some errors (e.g. missing recipient) still include the token.
        if (json.token) setToken(json.token)
      } else {
        if (json.token) setToken(json.token)
        else if (action === 'revoke') setToken(null)
        if (action === 'send' && json.sentTo) {
          setFlash(`✓ URL sent to ${json.sentTo}`)
          setRecipientOverride('')
        } else if (action === 'rotate') {
          setFlash('✓ New URL minted — the old one no longer works')
        } else if (action === 'revoke') {
          setFlash('✓ URL revoked')
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusy(false)
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setFlash('Copied URL to clipboard')
      setError(null)
    } catch {
      setError('Could not copy — select the URL manually')
    }
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
      border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>📤 Store-owner URL</div>
        <div style={{ flex: 1 }} />
        {token && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {token.view_count > 0
              ? <>viewed {token.view_count}× · last opened {fmtRel(token.first_viewed_at, token.id)}</>
              : <>not opened yet</>
            }
            {token.last_sent_at && <> · sent {fmtRel(token.last_sent_at, token.id)} to {token.last_sent_to}</>}
          </div>
        )}
      </div>

      {/* URL display + copy */}
      {token ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: '#F9FAFB', borderRadius: 8, marginBottom: 10 }}>
          <code style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 12, color: '#0f172a',
          }}>
            {publicUrl}
          </code>
          <button onClick={copyUrl} className="btn-outline btn-xs">Copy</button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn-outline btn-xs">Open ↗</a>
        </div>
      ) : (
        <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 8, marginBottom: 10, fontSize: 13, color: '#6b7280' }}>
          No URL minted yet — click <strong>Mint URL</strong> to create one.
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {!token && (
          <button onClick={() => call('mint')} disabled={busy} className="btn-primary btn-sm">
            {busy ? '…' : 'Mint URL'}
          </button>
        )}
        {token && (
          <>
            <input
              type="email"
              value={recipientOverride}
              onChange={e => setRecipientOverride(e.target.value)}
              placeholder={ownerEmail || 'owner email (optional override)'}
              style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6 }}
            />
            <button
              onClick={() => call('send', recipientOverride.trim() || undefined)}
              disabled={busy || (!recipientOverride.trim() && !ownerEmail)}
              className="btn-primary btn-sm"
              title={!ownerEmail && !recipientOverride.trim() ? 'Set the store\'s owner_email or type one above' : 'Email this URL to the store'}>
              {busy ? '…' : '📤 Send URL'}
            </button>
            <button onClick={() => {
              if (!confirm('Mint a new URL and invalidate the current one? Whoever has the old link will lose access.')) return
              call('rotate')
            }} disabled={busy} className="btn-outline btn-sm">
              🔄 Rotate
            </button>
            <button onClick={() => {
              if (!confirm('Revoke this URL? Whoever has it will see a "revoked" page.')) return
              call('revoke')
            }} disabled={busy} className="btn-outline btn-sm" style={{ color: '#991B1B' }}>
              Revoke
            </button>
          </>
        )}
      </div>

      {flash && <div style={{ marginTop: 8, fontSize: 12, color: '#065F46' }}>{flash}</div>}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>⚠ {error}</div>}
    </div>
  )
}

function fmtRel(iso: string | null | undefined, _seed: string): string {
  if (!iso) return ''
  try {
    const t = new Date(iso).getTime()
    const diffMs = Date.now() - t
    const mins = Math.round(diffMs / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    return `${days}d ago`
  } catch { return '' }
}
