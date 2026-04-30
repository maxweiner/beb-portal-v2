// Marketing module dual-auth helper: every Collected-actionable route
// can be reached either by an authed user with marketing_access OR by
// a magic-link token (scoped to a single campaign).
//
// Approver-only actions (approve planning, approve proof, authorize
// payment) intentionally do NOT use this — they require knowing who
// you are, and magic-link actors are anonymous beyond the email
// recipient on the token row.

import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export interface MarketingActor {
  type: 'user' | 'magic_link'
  /** Display name for audit trails (commenter_name, sent_by, etc.). */
  displayName: string
  /** Set when type='user'. */
  userId?: string
  /** Set when type='magic_link' — recipient email from the token row. */
  email?: string
  /** Magic links are scoped to one campaign; user actors aren't. */
  scopedCampaignId?: string
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Read the magic token from common locations on the request:
 *   - JSON body field `magic_token`
 *   - FormData field `magic_token`
 *   - URL query string `?magic_token=`
 *
 * Returns the cloned Request so the caller can still read the body.
 */
export async function readMagicToken(req: Request): Promise<{ token: string | null; req: Request }> {
  const url = new URL(req.url)
  const fromQs = url.searchParams.get('magic_token')
  if (fromQs) return { token: fromQs, req }

  // We need to peek at the body without consuming it for the caller.
  const ct = req.headers.get('content-type') || ''
  const cloned = req.clone()
  if (ct.includes('application/json')) {
    try {
      const body = await cloned.json()
      const t = (body?.magic_token || '').toString()
      return { token: t || null, req }
    } catch { /* fall through */ }
  } else if (ct.includes('multipart/form-data')) {
    try {
      const form = await cloned.formData()
      const t = (form.get('magic_token') || '').toString()
      return { token: t || null, req }
    } catch { /* fall through */ }
  }
  return { token: null, req }
}

/**
 * Resolve the actor + assert they're allowed to act on the given
 * campaign. Returns null on failure — caller should send 401/403.
 *
 * Pass `requireUser=true` to disallow magic-link access (used by
 * routes that need a real user_id, e.g. approver actions).
 */
export async function resolveMarketingActor(
  req: Request,
  campaignId: string,
  opts: { requireUser?: boolean } = {},
): Promise<{ actor: MarketingActor; reason?: undefined } | { actor?: undefined; reason: 'no_auth' | 'no_marketing_access' | 'token_invalid' | 'token_expired' | 'token_wrong_campaign' | 'requires_user' }> {
  const sb = admin()

  // 1. Try authed user path
  const authed = await getAuthedUser(req)
  if (authed) {
    const { data: meRow } = await sb.from('users')
      .select('marketing_access, name').eq('id', authed.id).maybeSingle()
    if (!(meRow as any)?.marketing_access) {
      return { reason: 'no_marketing_access' }
    }
    return {
      actor: {
        type: 'user',
        displayName: (meRow as any)?.name || authed.email || authed.id,
        userId: authed.id,
      },
    }
  }

  if (opts.requireUser) return { reason: 'requires_user' }

  // 2. Magic-link path
  const { token } = await readMagicToken(req)
  if (!token) return { reason: 'no_auth' }

  const { data: row } = await sb.from('magic_link_tokens')
    .select('id, campaign_id, email, expires_at')
    .eq('token', token).maybeSingle()
  if (!row) return { reason: 'token_invalid' }
  if (row.campaign_id !== campaignId) return { reason: 'token_wrong_campaign' }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { reason: 'token_expired' }
  }

  // Touch last_used_at (best-effort)
  await sb.from('magic_link_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)

  return {
    actor: {
      type: 'magic_link',
      displayName: row.email || '(magic link)',
      email: row.email,
      scopedCampaignId: row.campaign_id,
    },
  }
}
