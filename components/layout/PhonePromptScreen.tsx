'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import PhoneInput from '@/components/ui/PhoneInput'
import type { User } from '@/types'

/**
 * Shown after sign-in when the user has no phone number on file.
 * The phone is just data capture — no SMS verification — and saves
 * directly to public.users.phone via the existing RLS-allowed
 * self-update path. Hidden once the user fills it in.
 */
export default function PhonePromptScreen({ user }: { user: User }) {
  const { reload } = useApp()
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = phone.length === 10

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('users')
      .update({ phone })
      .eq('id', user.id)
    if (updErr) {
      setError(updErr.message)
      setBusy(false)
      return
    }
    await reload()
    // The context refresh will surface the updated user with phone set;
    // the page-level guard in app/page.tsx will then route normally.
    setBusy(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{
          background: 'var(--cream)', borderRadius: 24,
          padding: '40px 40px 32px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>📱</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>
              Add your phone number
            </div>
            <p style={{ fontSize: 14, color: 'var(--mist)', lineHeight: 1.55, margin: 0 }}>
              Hi {user.name?.split(' ')[0] || user.email}! We don&apos;t have a phone
              number for you yet. Please add one so the team can reach you.
            </p>
          </div>

          <label style={{
            display: 'block', fontSize: 13, fontWeight: 700,
            color: 'var(--ink)', marginBottom: 6,
          }}>Phone number</label>
          <PhoneInput
            value={phone}
            onChange={setPhone}
            disabled={busy}
            autoFocus
            style={{ marginBottom: 14, fontSize: 16 } as any}
          />

          {error && (
            <div style={{
              background: '#FEE2E2', color: '#991B1B',
              padding: '10px 14px', borderRadius: 8,
              fontSize: 13, marginBottom: 14,
            }}>{error}</div>
          )}

          <button
            onClick={handleSave}
            disabled={!canSave || busy}
            className="btn-primary"
            style={{
              width: '100%', justifyContent: 'center',
              fontSize: 15, padding: '12px 20px',
              opacity: (!canSave || busy) ? .6 : 1,
            }}
          >
            {busy ? 'Saving…' : 'Save & continue'}
          </button>

          <div style={{
            marginTop: 16, fontSize: 12, color: 'var(--mist)',
            textAlign: 'center', lineHeight: 1.5,
          }}>
            Used by the team to reach you about events and shows.
            You can update it anytime from Settings.
          </div>
        </div>
      </div>
    </div>
  )
}
