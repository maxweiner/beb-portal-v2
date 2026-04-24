// Twilio inbound-SMS webhook for "CANCEL" replies.
//
// Twilio config: in your Twilio console, set the Messaging Service / phone
// number's "Incoming messages" webhook to:
//   https://beb-portal-v2.vercel.app/api/appointments/webhook/sms  (POST)
//
// Security: verifies the X-Twilio-Signature HMAC against your Twilio auth
// token (loaded from public.settings key='sms'). To skip during local dev,
// set SKIP_TWILIO_SIG_CHECK=true in .env.local.
//
// Reserved keywords: STOP / HELP / etc. are intercepted by Twilio itself
// (carrier-mandated). We only act on plain "CANCEL" / "C".

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { formatPhone } from '@/lib/sms'
import { sendCancellation } from '@/lib/appointments/notifications'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function twiml(message: string | null): Response {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response/>'
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}

const CANCEL_KEYWORDS = ['CANCEL', 'C', 'CANCELLED', 'CANCELED']

async function verifySignature(req: Request, params: URLSearchParams, sb: ReturnType<typeof admin>): Promise<boolean> {
  if (process.env.SKIP_TWILIO_SIG_CHECK === 'true') return true
  const sig = req.headers.get('x-twilio-signature')
  if (!sig) return false
  const { data } = await sb.from('settings').select('value').eq('key', 'sms').maybeSingle()
  const authToken = data?.value?.authToken as string | undefined
  if (!authToken) return false
  // Twilio signs URL + sorted "key+value" concatenation of POST params.
  // The URL must be the *exact* one Twilio is calling — Vercel forwards the
  // public URL on req.url so this works in prod.
  const url = req.url
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const data_str = url + sorted.map(([k, v]) => k + v).join('')
  const expected = crypto.createHmac('sha1', authToken).update(data_str).digest('base64')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
}

export async function POST(req: Request) {
  const text = await req.text()
  const params = new URLSearchParams(text)
  const sb = admin()

  const ok = await verifySignature(req, params, sb)
  if (!ok) {
    return new Response('Forbidden', { status: 403 })
  }

  const from = String(params.get('From') || '')
  const body = String(params.get('Body') || '').trim().toUpperCase()
  if (!from || !body) return twiml(null)

  if (!CANCEL_KEYWORDS.includes(body)) {
    return twiml('Reply CANCEL to cancel your upcoming appointment, or use the manage link in your confirmation.')
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const { data: appts } = await sb
    .from('appointments')
    .select('id, cancel_token, customer_name, customer_phone, customer_email, appointment_date, appointment_time, store_id')
    .eq('status', 'confirmed')
    .gte('appointment_date', todayStr)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })

  // Match by E.164-normalized phone
  const match = (appts ?? []).find(a => formatPhone(a.customer_phone) === from)
  if (!match) {
    return twiml("We couldn't find an upcoming appointment under this number. If you need help, please call the store.")
  }

  const { error } = await sb.from('appointments').update({ status: 'cancelled' }).eq('id', match.id)
  if (error) {
    console.error('inbound cancel update failed', error)
    return twiml("Sorry, we hit an issue cancelling. Please use the manage link in your confirmation.")
  }

  // Send cancellation EMAIL (skip SMS — the TwiML reply below is the SMS confirmation).
  const { data: store } = await sb.from('stores')
    .select('name, slug, owner_phone, owner_email')
    .eq('id', match.store_id).maybeSingle()
  if (store) {
    sendCancellation({
      appt: {
        id: match.id, cancel_token: match.cancel_token,
        customer_name: match.customer_name,
        customer_phone: match.customer_phone,
        customer_email: match.customer_email,
        appointment_date: match.appointment_date,
        appointment_time: match.appointment_time,
      },
      store: {
        name: store.name, slug: store.slug,
        owner_phone: store.owner_phone, owner_email: store.owner_email,
      },
      skipSms: true,
    }).catch(err => console.error('inbound cancellation notify failed', err))
  }

  return twiml('Your appointment has been cancelled. To rebook, use the link from our previous message.')
}
