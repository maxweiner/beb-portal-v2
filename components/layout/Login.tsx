'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGoogle = async () => {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    })
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    })
    if (error) { setError(error.message); setLoading(false); return }
    setSent(true)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={{
          background: 'var(--cream)',
          borderRadius: 24,
          padding: '48px 48px 40px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
              <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 8, color: 'var(--ink)' }}>Check your email</div>
              <p style={{ fontSize: 15, color: 'var(--mist)', lineHeight: 1.6 }}>
                We sent a magic link to <strong>{email}</strong>
              </p>
              <button onClick={() => setSent(false)}
                style={{ marginTop: 24, fontSize: 13, color: 'var(--green)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}>
                Try a different email
              </button>
            </div>
          ) : (
            <>
              {/* Icon + Title */}
              <div style={{ textAlign: 'center', marginBottom: 36 }}>
                <div style={{
                  width: 72, height: 72,
                  background: 'var(--green)',
                  borderRadius: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px',
                  fontSize: 32,
                }}>◆</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--ink)', letterSpacing: '-.5px', marginBottom: 6 }}>
                  BuyerOS
                </div>
                <div style={{ fontSize: 14, color: 'var(--mist)' }}>Buyer Management</div>
              </div>

              {/* Google button */}
              <button onClick={handleGoogle} disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                  width: '100%', padding: '14px 20px', marginBottom: 24,
                  background: '#fff', color: '#3c4043',
                  border: '1.5px solid #dadce0', borderRadius: 10,
                  fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                  transition: 'box-shadow .15s, background .15s',
                  opacity: loading ? .7 : 1,
                }}>
                <svg width="22" height="22" viewBox="0 0 48 48">
                  <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
                  <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.5 19.2 14 24 14c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/>
                  <path fill="#FBBC05" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-6.6-5.4C29.8 37 27 38 24 38c-6 0-11.1-4-13-9.5l-7 5.4C7.9 41.7 15.4 46 24 46z"/>
                  <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.8 2.4-2.3 4.4-4.3 5.8l6.6 5.4C41.7 36.3 45 30.6 45 24c0-1.3-.2-2.7-.5-4z"/>
                </svg>
                Sign in with Google
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--pearl)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--silver)', letterSpacing: '.08em' }}>OR</span>
                <div style={{ flex: 1, height: 1, background: 'var(--pearl)' }} />
              </div>

              {/* Magic link */}
              <form onSubmit={handleMagicLink}>
                <div style={{ marginBottom: 6, fontWeight: 900, fontSize: 16, color: 'var(--ink)' }}>
                  Sign in with Magic Link
                </div>
                <div style={{ fontSize: 14, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.5 }}>
                  Enter your email and we'll send you a one-tap sign-in link. No password needed.
                </div>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com" required
                  style={{ marginBottom: 12 }}
                />
                {error && <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{error}</p>}
                <button type="submit" disabled={loading || !email}
                  className="btn-primary btn-full"
                  style={{ justifyContent: 'center', fontSize: 16, padding: '14px 20px', opacity: (!email || loading) ? .6 : 1 }}>
                  {loading ? 'Sending…' : 'Send Magic Link'}
                </button>
              </form>
            </>
          )}
        </div>

        <div style={{
          textAlign: 'center', marginTop: 20,
          fontSize: 12, color: 'var(--mist)',
        }}>
          <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</a>
          <span style={{ margin: '0 8px', opacity: .5 }}>·</span>
          <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</a>
        </div>
      </div>
    </div>
  )
}
