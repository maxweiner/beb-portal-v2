import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  }
)

// Manually refresh token on tab focus and every 10 minutes
if (typeof window !== 'undefined') {
  const refreshToken = async () => {
    try { await supabase.auth.refreshSession() } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshToken()
  })

  setInterval(refreshToken, 10 * 60 * 1000)
}
