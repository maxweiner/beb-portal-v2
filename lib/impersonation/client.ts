// Client helpers for the "View As" switcher. Wraps the
// /api/impersonation/* routes and exposes a small hook that
// keeps a local copy of the active session.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Mirror of the public bits of IMPERSONATOR_EMAIL on the server.
 *  Only used to gate UI rendering; the server route is the actual
 *  enforcement and re-checks the email. */
export const IMPERSONATOR_EMAIL = 'max@bebllp.com'

export function isImpersonatorEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === IMPERSONATOR_EMAIL
}

export interface ImpersonationTarget {
  id: string
  name: string
  email: string
  role: string
}

export interface ImpersonationStatus {
  active: boolean
  session?: {
    id: string
    target: ImpersonationTarget
    startedAt: string
    expiresAt: string
  }
}

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

export async function fetchImpersonationStatus(): Promise<ImpersonationStatus> {
  const res = await authedFetch('/api/impersonation/status')
  if (!res.ok) return { active: false }
  return (await res.json()) as ImpersonationStatus
}

export async function startImpersonation(targetUserId: string): Promise<void> {
  const res = await authedFetch('/api/impersonation/start', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Start failed (${res.status})`)
  // Force a JWT refresh so the next request carries the
  // impersonating_user_id claim minted by the Auth Hook. Then
  // hard-reload so every cached query re-runs as the target.
  await supabase.auth.refreshSession()
  if (typeof window !== 'undefined') window.location.reload()
}

export async function stopImpersonation(): Promise<void> {
  const res = await authedFetch('/api/impersonation/stop', { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Stop failed (${res.status})`)
  await supabase.auth.refreshSession()
  if (typeof window !== 'undefined') window.location.reload()
}

/**
 * Lightweight hook for the switcher. Polls status once on mount,
 * and re-polls on visibility change so a long idle (e.g. tab in
 * the background past the 4-hour expiry) doesn't leave the
 * switcher stuck on "Viewing as …" after the server has expired
 * the session. After start/stop the page reloads, so we don't
 * need a continuous interval poll.
 */
export function useImpersonationStatus(eligible: boolean) {
  const [status, setStatus] = useState<ImpersonationStatus | null>(null)
  const [loading, setLoading] = useState(eligible)

  const refresh = useCallback(async () => {
    if (!eligible) { setStatus({ active: false }); setLoading(false); return }
    setLoading(true)
    try { setStatus(await fetchImpersonationStatus()) }
    finally { setLoading(false) }
  }, [eligible])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!eligible || typeof document === 'undefined') return
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [eligible, refresh])

  return { status, loading, refresh }
}
