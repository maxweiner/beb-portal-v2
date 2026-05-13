'use client'

// Store-owner Dashboard URL card. Mounted in the store detail modal
// directly below "Store Portal Access". Manages the single per-store
// share token that drives /e/[token] — the public dashboard with the
// event picker.
//
// All mutations hit /api/store/[id]/share-token (mint / send /
// rotate / revoke). Replaces the previous StoreEventShareUrlsCard
// which managed one token per event.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TokenRow {
  id: string
  store_id: string
  token: string
  last_sent_at: string | null
  last_sent_to: string | null
  view_count: number
  first_viewed_at: string | null
  revoked_at: string | null
}

interface Props {
  storeId: string
  ownerEmail?: string | null
}

async function authHeader(): Promise<string> {
  const s = await supabase.auth.getSession()
  return s.data.session?.access_token || ''
}

export default function StoreShareUrlCard({ storeId, ownerEmail }: Props) {
  const [token, setToken] = useState<TokenRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [recipientOverride, setRecipientOverride] = useState('')

  async function reload() {
    setLoading(true)
    const { data } = await supabase.from('store_share_tokens')
      .select('id, store_id, token, last_sent_at, last_sent_to, view_count, first_viewed_at, revoked_at')
      .eq('store_id', storeId)
      .is('revoked_at', null)
      .maybeSingle()
    setToken((data as any) || null)
    setLoading(false)
  }
  useEffect(() => { reload() }, [storeId])

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
      } else {
        if (action === 'send' && json.sentTo) {
          setFlash(`✓ Sent to ${json.sentTo}`); setRecipientOverride('')
        } else if (action === 'rotate') {
          setFlash('✓ New URL minted — the old one no longer works')
        } else if (action === 'revoke') {
          setFlash('✓ URL revoked')
        } else if (action === 'mint') {
          setFlash('✓ URL minted')
        }
        await reload()
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
      setFlash('Copied URL to clipboard'); setError(null)
    } catch {
      setError('Could not copy — select manually')
    }
  }

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title">📤 Store-owner Dashboard URL</div>
      <p style={{ color: 'var(--mist)', fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        One durable URL per store. The public page shows the current event (defaults to today's live event, with a picker for upcoming + recently-ended events). Past events stay hidden.
      </p>

      {loading ? (
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            {token && (
              <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                {token.view_count > 0
                  ? <>viewed {token.view_count}× · last opened {fmtRel(token.first_viewed_at)}</>
                  : <>not opened yet</>
                }
                {token.last_sent_at && <> · sent {fmtRel(token.last_sent_at)} to {token.last_sent_to}</>}
              </div>
            )}
          </div>

          {token ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 10, background: '#F9FAFB', borderRadius: 8, marginBottom: 10 }}>
              <code style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 12, color: 'var(--ink)',
              }}>{publicUrl}</code>
              <button onClick={copyUrl} className="btn-outline btn-xs">Copy</button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn-outline btn-xs">Open ↗</a>
            </div>
          ) : (
            <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 8, marginBottom: 10, fontSize: 13, color: 'var(--mist)' }}>
              No URL minted yet — click <strong>Mint URL</strong> to create one for this store.
            </div>
          )}

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
                  placeholder={ownerEmail || 'owner email (optional)'}
                  style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '6px 8px', border: '1px solid var(--pearl)', borderRadius: 6 }}
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
                }} disabled={busy} className="btn-outline btn-sm">🔄 Rotate</button>
                <button onClick={() => {
                  if (!confirm('Revoke this URL? Whoever has it will see a "revoked" page.')) return
                  call('revoke')
                }} disabled={busy} className="btn-outline btn-sm" style={{ color: '#991B1B' }}>Revoke</button>
              </>
            )}
          </div>

          {flash && <div style={{ marginTop: 8, fontSize: 12, color: '#065F46' }}>{flash}</div>}
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>⚠ {error}</div>}
        </>
      )}
    </div>
  )
}

function fmtRel(iso: string | null | undefined): string {
  if (!iso) return ''
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
