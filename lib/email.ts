import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/**
 * Resend API key lives in the settings table at key='resend_api_key'.
 * From-address default mirrors the existing marketing-email/daily-report routes.
 */
const DEFAULT_FROM = 'Beneficial Estate Buyers <noreply@updates.bebllp.com>'
// Used when the recipient is on the dev-allowlist (max et al) OR when
// we're running in a Vercel preview deploy. Keeps "Report Spam" clicks
// on test mail from poisoning the production sender reputation.
const DEFAULT_DEV_FROM = 'BEB Dev <dev@updates.bebllp.com>'
const DEFAULT_DEV_RECIPIENTS = ['max@bebllp.com']

let _settingsCache: { at: number; resendKey: string | null; devFrom: string; devRecipients: string[] } | null = null
const SETTINGS_TTL_MS = 60_000

async function loadSettings(): Promise<{ resendKey: string | null; devFrom: string; devRecipients: string[] }> {
  const now = Date.now()
  if (_settingsCache && now - _settingsCache.at < SETTINGS_TTL_MS) return _settingsCache
  const keys = ['resend_api_key', 'email.dev_sender_from', 'email.dev_recipients']
  const { data } = await sb.from('settings').select('key, value').in('key', keys)
  const byKey = new Map<string, any>(((data || []) as any[]).map(r => [r.key, r.value]))
  const stripQuotes = (v: any) => typeof v === 'string' ? v.replace(/^"|"$/g, '') : v
  const resendKey = stripQuotes(byKey.get('resend_api_key')) || null
  const devFrom   = stripQuotes(byKey.get('email.dev_sender_from')) || DEFAULT_DEV_FROM
  let devRecipients: string[] = DEFAULT_DEV_RECIPIENTS
  const drRaw = byKey.get('email.dev_recipients')
  if (Array.isArray(drRaw)) devRecipients = drRaw.map(String)
  else if (typeof drRaw === 'string') {
    try {
      const parsed = JSON.parse(drRaw)
      if (Array.isArray(parsed)) devRecipients = parsed.map(String)
    } catch { /* keep default */ }
  }
  _settingsCache = { at: now, resendKey, devFrom, devRecipients: devRecipients.map(s => s.toLowerCase().trim()) }
  return _settingsCache
}

/** True if every recipient is on the dev allowlist (or there are no
 *  recipients — degenerate case). Mixed sends (one dev + one real
 *  customer) intentionally fall through to the production sender. */
function isDevOnlyAudience(to: string | string[], devRecipients: string[]): boolean {
  const arr = Array.isArray(to) ? to : [to]
  if (arr.length === 0) return false
  return arr.every(addr => {
    // Pull bare email from "Name <email@x>" if present, else use as-is.
    const m = addr.match(/<([^>]+)>/)
    const bare = (m ? m[1] : addr).toLowerCase().trim()
    return devRecipients.includes(bare)
  })
}

function isPreviewDeploy(): boolean {
  return process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
}

export interface EmailAttachment {
  filename: string
  /** Base64-encoded file contents (no data: prefix). Resend's required format. */
  content: string
}

export interface SendEmailArgs {
  /** Single recipient OR an array of recipients. Resend accepts both
   *  shapes; we pass through unchanged. Each entry may be a bare
   *  email or a "Name <email@x.com>" string. */
  to: string | string[]
  subject: string
  html: string
  from?: string
  attachments?: EmailAttachment[]
  /** Override the Reply-To header. Used by marketing proof notifications
   *  to route replies into the inbound webhook. */
  replyTo?: string
}

/**
 * Send a transactional email via Resend. Silent no-op if no API key is
 * configured. Returns the Resend message id on success or throws on error.
 *
 * Sender-reputation guard: when every recipient is on the dev allowlist
 * (or we're on a Vercel preview build), the From address is swapped to
 * the dev sender so accidental "Report Spam" clicks on test mail don't
 * tank the production noreply@ reputation.
 */
export async function sendEmail({ to, subject, html, from, attachments, replyTo }: SendEmailArgs): Promise<string | null> {
  const { resendKey, devFrom, devRecipients } = await loadSettings()
  if (!resendKey) return null

  // Dev-context override beats even an explicit `from` — the goal is
  // to protect the production noreply@ reputation regardless of which
  // route is calling. In a real send (no dev recipients, no preview)
  // the caller's `from` wins, falling back to DEFAULT_FROM.
  const isDevContext = isPreviewDeploy() || isDevOnlyAudience(to, devRecipients)
  const effectiveFrom = isDevContext ? devFrom : (from || DEFAULT_FROM)

  const body: Record<string, unknown> = { from: effectiveFrom, to, subject, html }
  if (attachments && attachments.length > 0) body.attachments = attachments
  if (replyTo) body.reply_to = replyTo

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend ${res.status}: ${text}`)
  }
  const json = await res.json().catch(() => ({}))
  return json?.id ?? null
}
