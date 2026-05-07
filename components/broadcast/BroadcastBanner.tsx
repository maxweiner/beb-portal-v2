'use client'

// In-app banner for broadcasts marked show_in_app. Mounted near the
// top of the authed layout. Fetches active banners on mount, shows
// the most recent one, dismisses on click → hides + persists via
// /api/broadcast/dismiss so it doesn't come back next session.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Banner {
  id: string
  brand: 'beb' | 'liberty'
  subject: string
  body_html: string
  cta_label: string | null
  cta_url: string | null
  sent_at: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function BroadcastBanner() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [dismissing, setDismissing] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/broadcast/active-banners', { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        setBanners(j.banners || [])
      } catch {/* tolerate */}
    })()
    return () => { cancelled = true }
  }, [])

  async function dismiss(id: string) {
    setDismissing(prev => new Set(prev).add(id))
    setBanners(prev => prev.filter(b => b.id !== id))
    try {
      await fetch('/api/broadcast/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ broadcast_id: id }),
      })
    } catch {/* tolerate */}
  }

  if (banners.length === 0) return null

  // Show only the most recent banner — stacking gets overwhelming.
  const b = banners[0]
  const accent = b.brand === 'liberty' ? '#1E3A8A' : '#1D6B44'
  return (
    <div style={{
      background: '#fff', borderBottom: `3px solid ${accent}`,
      padding: '12px 24px', display: 'flex', alignItems: 'center',
      gap: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: 22 }}>📣</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 2 }}>
          {b.subject}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ash)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: b.body_html }} />
        {b.cta_label && b.cta_url && (
          <div style={{ marginTop: 8 }}>
            <a href={b.cta_url} target="_blank" rel="noreferrer" style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 6,
              background: accent, color: '#fff', textDecoration: 'none',
              fontWeight: 700, fontSize: 12,
            }}>{b.cta_label} →</a>
          </div>
        )}
      </div>
      <button
        onClick={() => dismiss(b.id)}
        disabled={dismissing.has(b.id)}
        title="Dismiss"
        style={{
          background: 'transparent', border: 'none', fontSize: 18, color: 'var(--mist)',
          cursor: 'pointer', padding: 6, fontFamily: 'inherit', flexShrink: 0,
        }}
      >✕</button>
    </div>
  )
}
