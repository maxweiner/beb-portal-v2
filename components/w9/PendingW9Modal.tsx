'use client'

// Portal hard-block for users with a pending W-9. Mounted globally
// at the portal shell (app/page.tsx). Polls w9_requests on user
// change; when a pending row exists for me, renders a non-
// dismissible full-screen modal with a "Complete W-9 →" CTA that
// navigates to /w9/[token]. After the recipient submits and lands
// back in the portal, the next render finds no pending row and the
// modal goes away.
//
// We don't try to render the W-9 form inline inside the modal —
// that form is 400+ lines and tightly coupled to a token-only
// public route. Sending the user to /w9/[token] keeps that route
// the single source of truth and avoids drift between two copies
// of the same form.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface PendingRow {
  id: string
  token: string
  recipient_name: string
  requested_by_name: string | null
  expires_at: string
}

export default function PendingW9Modal() {
  const { user } = useApp()
  const [row, setRow] = useState<PendingRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) { setRow(null); setLoading(false); return }
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('w9_requests')
        .select('id, token, recipient_name, requested_by_name, expires_at, status, revoked_at')
        .eq('recipient_user_id', user!.id)
        .in('status', ['pending', 'opened'])
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setRow(data as any || null)
      setLoading(false)
    }

    load()
    // Re-check on focus so completing the form in another tab clears
    // the modal when this tab regains focus.
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [user?.id])

  if (loading || !row) return null

  const expiry = (() => {
    const days = Math.max(0, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 86_400_000))
    return days === 0 ? 'today' : days === 1 ? 'in 1 day' : `in ${days} days`
  })()

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15, 23, 42, 0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    }}>
      <div style={{
        maxWidth: 540, width: '100%',
        background: '#fff', borderRadius: 14,
        padding: '32px 28px',
        boxShadow: '0 12px 32px rgba(0,0,0,.35)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#1D6B44', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Action required
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          You have a W-9 to complete
        </h1>
        <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.5, margin: '0 0 16px' }}>
          {row.requested_by_name ? <strong>{row.requested_by_name}</strong> : 'BEB Accounting'} is waiting on a signed IRS Form W-9 from you for tax documentation. It takes ~2 minutes — fill the form, draw a signature, and submit.
        </p>
        <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 22px' }}>
          The link expires {expiry}. The rest of the portal is unavailable until this is done.
        </p>
        <a
          href={`/w9/${row.token}`}
          style={{
            display: 'inline-block', background: '#1D6B44', color: '#fff',
            padding: '14px 28px', borderRadius: 10,
            fontSize: 15, fontWeight: 800, textDecoration: 'none',
          }}
        >
          Complete W-9 →
        </a>
        <p style={{ marginTop: 20, fontSize: 11, color: '#9CA3AF' }}>
          If this is unexpected, contact <strong>{row.requested_by_name || 'accounting'}</strong> before submitting.
        </p>
      </div>
    </div>
  )
}
