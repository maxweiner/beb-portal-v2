'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      router.replace('/')
    }

    // Session is persisted to storage before onAuthStateChange fires,
    // so no artificial delay is needed — redirect immediately.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) go()
    })

    // Also handle the case where detectSessionInUrl has already run.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go()
    })

    // Last-resort fallback.
    const fallback = setTimeout(go, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(fallback)
    }
  }, [router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--sidebar-bg, #2D3B2D)',
      color: 'white',
      fontFamily: 'Lato, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>Signing you in…</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>One moment</div>
      </div>
    </div>
  )
}
