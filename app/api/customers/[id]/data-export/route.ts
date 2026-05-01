// POST /api/customers/[id]/data-export
//
// "Export all data for this customer." Generates a JSON dump of:
//   - the customer row
//   - every customer_tags row
//   - every customer_mailings row
//   - every customer_events row
//   - every appointment matched by email or normalized phone at the
//     same store (the appointments table has no customer FK yet —
//     Phase 12 backfills + adds it)
//
// Stores the JSON to the customer-data-exports private bucket and
// emails a signed download link to the configured recipient. Logs
// a compliance_actions row of type 'data_export_request'.
//
// Admin-only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function loadStringSetting(sb: ReturnType<typeof admin>, key: string): Promise<string | null> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
  if (!data) return null
  const v = (data as any).value
  if (typeof v === 'string') return v.replace(/^"|"$/g, '') || null
  return null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const sb = admin()
  const { data: customer } = await sb.from('customers').select('*').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Resolve email recipient: explicit setting first, fall back to
  // accountant_email which always exists on this codebase.
  let recipient = await loadStringSetting(sb, 'customers.data_export_recipient')
  if (!recipient) recipient = await loadStringSetting(sb, 'accountant_email')
  if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
    return NextResponse.json({
      error: 'No recipient configured. Set customers.data_export_recipient (or accountant_email) in settings first.',
    }, { status: 400 })
  }

  // Pull related rows in parallel
  const [tagsRes, mailingsRes, eventsRes] = await Promise.all([
    sb.from('customer_tags').select('*').eq('customer_id', customer.id),
    sb.from('customer_mailings').select('*').eq('customer_id', customer.id),
    sb.from('customer_events').select('*').eq('customer_id', customer.id),
  ])

  // Appointments matched by email/phone at the same store
  const filters: string[] = []
  if (customer.email_normalized) filters.push(`customer_email.ilike.${customer.email_normalized}`)
  if (customer.phone_normalized) {
    const d = customer.phone_normalized
    const variants = [
      d, `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`,
      `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`,
      `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`,
    ]
    for (const v of variants) filters.push(`customer_phone.eq.${v}`)
  }
  let appointments: any[] = []
  if (filters.length > 0) {
    const { data: a } = await sb.from('appointments')
      .select('*').eq('store_id', customer.store_id).or(filters.join(','))
    appointments = a || []
  }

  const dump = {
    exported_at: new Date().toISOString(),
    exported_by: { id: me.id, name: me.name, email: me.email },
    customer,
    tags: tagsRes.data || [],
    mailings: mailingsRes.data || [],
    events: eventsRes.data || [],
    appointments,
  }
  const json = JSON.stringify(dump, null, 2)
  const buf = Buffer.from(json, 'utf-8')

  // Upload to storage
  const path = `${customer.store_id}/${customer.id}-${Date.now()}.json`
  const { error: upErr } = await sb.storage.from('customer-data-exports')
    .upload(path, buf, { contentType: 'application/json', upsert: false })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  // Sign URL good for 24h
  const { data: signed } = await sb.storage.from('customer-data-exports')
    .createSignedUrl(path, 60 * 60 * 24)

  // Email the recipient
  const customerName = `${customer.first_name} ${customer.last_name}`.trim()
  const subject = `Customer data export — ${customerName}`
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h2 style="margin: 0 0 12px;">Customer data export</h2>
      <p style="font-size: 14px; line-height: 1.6;">
        ${me.name} requested a full data export for <strong>${customerName}</strong>.
      </p>
      <p style="font-size: 14px;">
        Tags: ${tagsRes.data?.length || 0} ·
        Mailings: ${mailingsRes.data?.length || 0} ·
        Events: ${eventsRes.data?.length || 0} ·
        Appointments: ${appointments.length}
      </p>
      ${signed?.signedUrl
        ? `<p><a href="${signed.signedUrl}" style="display: inline-block; background: #2D3B2D; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Download JSON (24h link)</a></p>`
        : `<p style="color: #888;">Signed URL unavailable; admin can pull from storage at <code>${path}</code>.</p>`}
      <p style="font-size: 11px; color: #888;">Beneficial Estate Buyers · Customers compliance</p>
    </div>`

  try {
    await sendEmail({ to: recipient, subject, html })
  } catch { /* best-effort — file is in storage either way */ }

  await sb.from('compliance_actions').insert({
    customer_id: customer.id,
    store_id: customer.store_id,
    customer_email_snapshot: customer.email,
    customer_name_snapshot: customerName,
    action: 'data_export_request',
    initiated_by: me.id,
    meta: {
      file_path: path,
      recipient,
      counts: {
        tags: tagsRes.data?.length || 0,
        mailings: mailingsRes.data?.length || 0,
        events: eventsRes.data?.length || 0,
        appointments: appointments.length,
      },
    },
  })

  return NextResponse.json({
    ok: true, recipient, file_path: path,
    signed_url: signed?.signedUrl || null,
  })
}
