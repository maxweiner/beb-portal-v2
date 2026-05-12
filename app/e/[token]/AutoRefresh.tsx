'use client'

// 30-second auto-refresh for the public event dashboard. Calls
// router.refresh() (NOT window.location.reload()) so the server
// component re-fetches without a hard navigation — preserves scroll
// position and doesn't flash white. Lightweight; one timer, no state.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [router, intervalMs])
  return null
}
