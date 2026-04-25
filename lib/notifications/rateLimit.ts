// Rate limit gate for the dispatcher. Counts per-channel sends in the
// last 60 seconds globally (across both brands) and blocks new sends
// once we've hit 5/min. Held rows stay 'pending' and the next cron
// cycle picks them up — natural smoothing.
//
// Manual "Send Now" actions can pass `bypass: true` to allow up to a
// small burst above the limit (logged at the call site).

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const LIMIT_PER_MINUTE = 5
const BURST_ALLOWANCE = 2 // for manual Send Now bypass

let _client: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

export type SendChannel = 'email' | 'sms'

/**
 * Returns the count of successful sends for `channel` in the last 60s.
 * Scans scheduled_notifications.sent_at; cheap because of the
 * `(status, scheduled_for)` index covering the dispatcher hot path.
 */
async function recentSendCount(channel: SendChannel): Promise<number> {
  const sb = admin()
  const sinceIso = new Date(Date.now() - 60 * 1000).toISOString()
  const statusCol = channel === 'email' ? 'email_status' : 'sms_status'
  const { count } = await sb
    .from('scheduled_notifications')
    .select('id', { count: 'exact', head: true })
    .eq(statusCol, 'sent')
    .gte('sent_at', sinceIso)
  return count ?? 0
}

export interface RateGateResult {
  allowed: boolean
  count: number
  limit: number
}

export async function checkRateLimit(
  channel: SendChannel,
  opts: { bypass?: boolean } = {},
): Promise<RateGateResult> {
  const count = await recentSendCount(channel)
  const limit = opts.bypass ? LIMIT_PER_MINUTE + BURST_ALLOWANCE : LIMIT_PER_MINUTE
  return { allowed: count < limit, count, limit }
}
