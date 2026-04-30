'use client'

// Read-only QR codes section. Pulls active QR codes for the campaign's
// store from /api/marketing/campaigns/[id]/qr-codes (dual-auth aware,
// service-role bypasses qr_codes RLS).
//
// Surfaces the per-code permanent URL (/q/{code}) so marketing
// partners can copy it for their proofs without needing portal admin
// access to the QR module.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface QrCode {
  id: string
  code: string
  type: string | null
  lead_source: string | null
  custom_label: string | null
  label: string | null
  active: boolean
}

export default function MarketingQrSection({ campaignId, magicToken }: {
  campaignId: string
  /** When set (magic-link page), append the token to the auth header path. */
  magicToken?: string
}) {
  const [codes, setCodes] = useState<QrCode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const headers: Record<string, string> = {}
        if (!magicToken) {
          const { data: sess } = await supabase.auth.getSession()
          const t = sess.session?.access_token
          if (t) headers.Authorization = `Bearer ${t}`
        }
        const url = magicToken
          ? `/api/marketing/campaigns/${campaignId}/qr-codes?magic_token=${encodeURIComponent(magicToken)}`
          : `/api/marketing/campaigns/${campaignId}/qr-codes`
        const res = await fetch(url, { headers })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || `Failed (${res.status})`)
          setCodes([])
        } else {
          setCodes(json.qr_codes ?? [])
        }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Network error'); setCodes([]) }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, magicToken])

  if (loading) return (
    <div className="card" style={{ padding: 18, marginBottom: 14, color: 'var(--mist)' }}>
      Loading QR codes…
    </div>
  )

  if (codes && codes.length === 0 && !error) {
    return (
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
          QR codes
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>
          No QR codes configured for this store yet. Admins can add them in the Stores section.
        </div>
      </div>
    )
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        QR codes
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Read-only. Use these short URLs on proofs or business cards. Scans land on the corresponding lead-source.
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(codes ?? []).map(c => {
          const url = `${baseUrl}/q/${c.code}`
          const display = c.label || c.custom_label || c.lead_source || c.type || c.code
          return (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center',
              padding: '10px 12px',
              border: '1px solid var(--pearl)', borderRadius: 8,
              background: c.active ? '#fff' : 'var(--cream2)',
              opacity: c.active ? 1 : 0.65,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {display}
                  {!c.active && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--pearl)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>inactive</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {url}
                </div>
              </div>
              <a href={url} target="_blank" rel="noreferrer" className="btn-outline btn-xs"
                style={{ textDecoration: 'none' }}>
                Open
              </a>
              <button className="btn-outline btn-xs" onClick={() => {
                navigator.clipboard?.writeText(url)
              }}>
                Copy
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
