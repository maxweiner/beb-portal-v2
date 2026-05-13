// Public W-9 form route at /w9/[token]. Recipients (internal users
// or external vendors) load this page from the email link or the
// in-portal block, fill out the form, sign, and submit.
//
// Auth: token in the URL — no portal login required (external
// recipients won't have one). Service-role client looks up the
// w9_requests row. Submit goes through /api/w9/[token]/submit.
//
// First open: bumps first_opened_at / open_count and flips status
// pending → opened so Diane can see "they at least looked".

import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import W9FormClient from './W9FormClient'

export const metadata = { title: 'W-9 Tax Form' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export default async function Page({ params }: { params: { token: string } }) {
  const token = params.token
  if (!token || token.length < 8 || token.length > 64) {
    return <Stub title="Form not found" body="The link you followed doesn't match an active W-9 request." />
  }

  const sb = admin()
  const { data: w9 } = await sb.from('w9_requests')
    .select('id, brand, recipient_name, recipient_email, recipient_user_id, status, revoked_at, revoked_reason, expires_at, first_opened_at, open_count, requested_by_name, requested_by_email')
    .eq('token', token)
    .maybeSingle()

  if (!w9) return <Stub title="Form not found" body="The link you followed doesn't match an active W-9 request." />
  if (w9.revoked_at) {
    return <Stub title="This link has been revoked" body={w9.revoked_reason || 'The sender revoked this W-9 request.'} />
  }
  if (w9.status === 'completed') {
    return <Stub title="Already submitted" body="Thanks — this W-9 has already been signed and delivered. If you need to file an updated one, ask the accountant to send a new link." />
  }
  if (w9.expires_at && new Date(w9.expires_at).getTime() < Date.now()) {
    await sb.from('w9_requests').update({ status: 'expired' }).eq('id', w9.id).then(() => {}, () => {})
    return <Stub title="This link has expired" body="W-9 request links are valid for 30 days. Reply to the original email to request a fresh one." />
  }

  // Bump open-tracking (fire-and-forget; never block render).
  const nowIso = new Date().toISOString()
  sb.from('w9_requests').update({
    first_opened_at: w9.first_opened_at || nowIso,
    last_opened_at: nowIso,
    open_count: (w9.open_count || 0) + 1,
    ...(w9.status === 'pending' ? { status: 'opened' } : {}),
  }).eq('id', w9.id).then(() => {}, () => {})

  // BEB requester info — top-right "Person requesting" block.
  const { data: reqRow } = await sb.from('settings').select('value').eq('key', 'w9.requester_info').maybeSingle()
  const requester = (reqRow?.value as any) || null

  // For internal users, prefill what we can. The users table only
  // has `home_address` as a single text blob — we dump it into the
  // form's Line 5 (Address) and let the recipient split city/state/
  // zip themselves. External recipients fill everything fresh.
  let prefill: any = {
    name: w9.recipient_name,
    address: '', city: '', state: '', zip: '',
  }
  if (w9.recipient_user_id) {
    const { data: u } = await sb.from('users')
      .select('name, home_address')
      .eq('id', w9.recipient_user_id)
      .maybeSingle()
    if (u) {
      prefill.name = (u as any).name || prefill.name
      prefill.address = (u as any).home_address || ''
    }
  }

  // Absolute origin for the in-page submit so previews work.
  const h = headers()
  const host = h.get('host') || ''
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const origin = host ? `${proto}://${host}` : ''

  return (
    <W9FormClient
      token={token}
      origin={origin}
      requesterName={w9.requested_by_name || 'BEB Accounting'}
      requester={requester}
      prefill={prefill}
      recipientEmail={w9.recipient_email}
    />
  )
}


function Stub({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <div style={{ maxWidth: 540, margin: '64px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', margin: '0 0 8px' }}>{title}</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>{body}</p>
      </div>
    </div>
  )
}
