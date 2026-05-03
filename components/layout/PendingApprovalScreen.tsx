'use client'

import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

export default function PendingApprovalScreen({ user }: { user: User }) {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{
          background: 'var(--cream)', borderRadius: 24,
          padding: '48px 48px 36px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', marginBottom: 12 }}>
            Pending approval
          </div>
          <p style={{ fontSize: 15, color: 'var(--mist)', lineHeight: 1.6, marginBottom: 24 }}>
            Thanks for signing in, <strong>{user.name || user.email}</strong>.
            Your account is awaiting review by an administrator.
            We&apos;ll let you know when you&apos;re approved.
          </p>
          <div style={{
            background: '#FFF7ED', border: '1px solid #FED7AA',
            borderRadius: 8, padding: '12px 16px', marginBottom: 24,
            fontSize: 13, color: '#9A3412', lineHeight: 1.5,
          }}>
            Signed in as <strong>{user.email}</strong>
          </div>
          <button
            onClick={handleSignOut}
            style={{
              padding: '12px 28px',
              background: 'var(--green)', color: '#fff',
              border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
