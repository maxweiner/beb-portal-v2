'use client'

// Portal hard-block for users with a pending W-9. Mounted globally
// at the portal shell (app/page.tsx). Polls w9_requests on user
// change; when a pending row exists for me, renders a full-screen
// modal with a "Complete W-9 →" CTA that navigates to /w9/[token].
// After the recipient submits and lands back in the portal, the
// next render finds no pending row and the modal goes away.
//
// Admin escape hatch: anyone with the role/perm-set that can
// SEND a W-9 (admin / superadmin / accounting / partner) also
// sees a small "✕ Skip for now" link in the modal's top-right.
// Click → tab-session dismissal (sessionStorage) so they can keep
// working / testing. Refresh re-arms the block. Non-admin
// recipients (the buyers we actually want signed W-9s from) see
// no escape — same hard-block as before.
//
// We don't try to render the W-9 form inline inside the modal —
// that form is 400+ lines and tightly coupled to a token-only
// public route. Sending the user to /w9/[token] keeps that route
// the single source of truth and avoids drift between two copies
// of the same form.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

const DISMISS_SESSION_KEY = 'beb-pending-w9-dismissed'

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
  // Tab-session dismiss flag — set when an admin clicks "Skip for
  // now". Cleared on refresh so the block re-arms.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(DISMISS_SESSION_KEY) === '1'
  })

  // Anyone who can SEND a W-9 can also dismiss one targeted at them.
  // Mirrors the gating in components/accounting/W9Panel.tsx so the
  // capability is consistent: if you have audit-level access, you're
  // trusted to escape your own test send.
  const canDismiss =
    user?.role === 'admin'
    || user?.role === 'superadmin'
    || user?.role === 'accounting'
    || user?.is_partner === true

  useEffect(() => {
    if (!user?.id) { setRow(null); setLoading(false); return }
    let cancelled = false

    async function load() {
      // Use array form (no .maybeSingle) — when no row matches,
      // PostgREST returns 200 + [] cleanly instead of the 404
      // that .maybeSingle() sometimes emits, which was spamming
      // the console on every page load for users who never have
      // a pending W-9 (i.e., almost everyone).
      const { data } = await supabase
        .from('w9_requests')
        .select('id, token, recipient_name, requested_by_name, expires_at, status, revoked_at')
        .eq('recipient_user_id', user!.id)
        .in('status', ['pending', 'opened'])
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      const first = (data && data.length > 0) ? data[0] : null
      setRow(first as any)
      setLoading(false)
    }

    load()
    // Re-check on focus so completing the form in another tab clears
    // the modal when this tab regains focus.
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [user?.id])

  if (loading || !row || dismissed) return null

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
        position: 'relative',
      }}>
        {/* Admin escape hatch — only renders for users who can also
            send W-9s. Clears the modal for the rest of this tab
            session; a refresh re-arms the block. */}
        {canDismiss && (
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.sessionStorage.setItem(DISMISS_SESSION_KEY, '1')
              }
              setDismissed(true)
            }}
            title="Dismiss this block for the rest of the tab session (admin only). Refresh re-arms it."
            style={{
              position: 'absolute', top: 12, right: 14,
              background: 'transparent', border: 'none',
              fontSize: 12, color: '#9CA3AF', cursor: 'pointer',
              fontFamily: 'inherit', padding: '4px 6px',
            }}
          >
            ✕ Skip for now (admin)
          </button>
        )}

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
