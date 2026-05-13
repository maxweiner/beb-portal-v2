// POST /api/w9/[id]/submit
//
// Public endpoint (no auth) — the recipient fills the form via
// /w9/[token] and POSTs here. We validate the token, generate the
// signed PDF, store it, update the w9_requests row, and email the
// accountant a copy with the PDF attached.
//
// Slug-name note: this directory is `[id]` (not `[token]`) so the
// dynamic segment matches its sibling admin routes (`[id]/pdf`,
// `[id]/action`). Next.js refuses to build sibling dynamic segments
// with mismatched slug names. The URL still passes the token in
// this position — the handler looks it up via the `token` column,
// not the `id` column.
//
// Body shape (JSON):
//   {
//     formData: W9FormData,
//     tin: string (9 digits),
//     signatureDrawnDataUrl?: string,
//     signatureTypedName?: string,
//   }

import { NextResponse } from 'next/server'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'
import { generateSignedW9Pdf } from '@/lib/w9/pdf'
import { sendEmail } from '@/lib/email'
import type { W9FormData, W9RequesterInfo } from '@/types'

export const dynamic = 'force-dynamic'
// PDF generation + storage upload + email send can take a few
// seconds. Bump the Vercel function timeout.
export const maxDuration = 60

const W9_BUCKET = 'wholesale-documents'  // reuse existing private bucket

interface SubmitBody {
  formData: Partial<W9FormData>
  tin?: string
  signatureDrawnDataUrl?: string
  signatureTypedName?: string
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const sb = pdfAdmin()

  // The URL slug is named `id` for Next.js routing reasons, but the
  // value is always a token. Look it up against the `token` column.
  const token = ctx.params.id

  // 1. Token lookup + state validation.
  const { data: w9, error: lookupErr } = await sb.from('w9_requests')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!w9) return NextResponse.json({ error: 'W-9 request not found' }, { status: 404 })
  if (w9.revoked_at) return NextResponse.json({ error: 'This W-9 link has been revoked.' }, { status: 410 })
  if (w9.status === 'completed') {
    return NextResponse.json({ error: 'This W-9 has already been signed.' }, { status: 409 })
  }
  if (w9.expires_at && new Date(w9.expires_at).getTime() < Date.now()) {
    await sb.from('w9_requests').update({ status: 'expired' }).eq('id', w9.id)
    return NextResponse.json({ error: 'This W-9 link has expired.' }, { status: 410 })
  }

  // 2. Body + minimal validation.
  const body = (await req.json().catch(() => null)) as SubmitBody | null
  if (!body || !body.formData) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  const f = body.formData
  if (!f.name?.trim()) return NextResponse.json({ error: 'Name is required (Line 1)' }, { status: 422 })
  if (!f.address?.trim()) return NextResponse.json({ error: 'Address is required' }, { status: 422 })
  if (!f.city?.trim() || !f.state?.trim() || !f.zip?.trim()) {
    return NextResponse.json({ error: 'City, state, and ZIP are required' }, { status: 422 })
  }
  if (!f.tax_classification) return NextResponse.json({ error: 'Tax classification is required' }, { status: 422 })
  if (!f.tin_type) return NextResponse.json({ error: 'TIN type is required' }, { status: 422 })
  const tin = (body.tin || '').replace(/\D/g, '')
  if (tin.length !== 9) {
    return NextResponse.json({ error: 'TIN must be 9 digits' }, { status: 422 })
  }
  if (!body.signatureDrawnDataUrl && !body.signatureTypedName?.trim()) {
    return NextResponse.json({ error: 'Signature is required' }, { status: 422 })
  }

  const formData: W9FormData = {
    name: f.name.trim(),
    business_name: f.business_name?.trim() || null,
    tax_classification: f.tax_classification,
    llc_classification: f.tax_classification === 'llc' ? (f.llc_classification ?? null) : null,
    other_classification: f.tax_classification === 'other' ? (f.other_classification?.trim() ?? null) : null,
    exempt_payee_code: f.exempt_payee_code?.trim() || null,
    exempt_fatca_code: f.exempt_fatca_code?.trim() || null,
    address: f.address.trim(),
    city: f.city.trim(),
    state: f.state.trim().toUpperCase(),
    zip: f.zip.trim(),
    tin_type: f.tin_type,
    signed_name: (body.signatureTypedName || f.signed_name || f.name || '').trim(),
    signed_at: new Date().toISOString(),
  }

  // 3. Load BEB requester info from settings.
  const { data: reqRow } = await sb.from('settings').select('value').eq('key', 'w9.requester_info').maybeSingle()
  const requester: W9RequesterInfo = (reqRow?.value as any) ?? {
    name: 'Beneficial Estate Buyers, LLC',
    address: '', city: '', state: '', zip: '',
    phone: null, tin: null, contact_name: null, contact_email: null,
  }

  // 4. Generate the signed PDF.
  let pdfBytes: Uint8Array
  try {
    pdfBytes = await generateSignedW9Pdf({
      formData,
      tin,
      requester,
      signatureDrawnDataUrl: body.signatureDrawnDataUrl ?? null,
      signatureTypedName: body.signatureTypedName ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `PDF generation failed: ${e?.message || e}` }, { status: 500 })
  }

  // 5. Upload to private storage. Path: w9/{request_id}/W9-{lastname}-{YYYY-MM-DD}.pdf
  const lastName = formData.name.split(/\s+/).pop() || 'recipient'
  const dateStamp = new Date().toISOString().slice(0, 10)
  const safeName = lastName.replace(/[^A-Za-z0-9._-]/g, '_')
  const storagePath = `w9/${w9.id}/W9-${safeName}-${dateStamp}.pdf`
  const { error: upErr } = await sb.storage.from(W9_BUCKET).upload(storagePath, Buffer.from(pdfBytes), {
    contentType: 'application/pdf',
    upsert: true,
    cacheControl: '3600',
  })
  if (upErr) return NextResponse.json({ error: `Storage upload: ${upErr.message}` }, { status: 500 })

  // 6. Email the accountant with the PDF attached.
  //
  // Destination priority: the *configured* accountant address
  // (settings.w9.requester_info.contact_email) wins over the
  // who-clicked-Send fallback (requested_by_email). The
  // requester_info contact is the stable place to point W-9s at
  // a shared mailbox like accounting@bebllp.com regardless of
  // which admin pressed the button.
  const accountantEmail = requester.contact_email || w9.requested_by_email || null
  let deliveredAt: string | null = null
  let deliveredTo: string | null = null
  if (accountantEmail) {
    try {
      const sent = await emailW9ToAccountant({
        toEmail: accountantEmail,
        toName: w9.requested_by_name || null,
        recipientName: formData.name,
        pdfBytes,
        pdfFilename: `W9-${safeName}-${dateStamp}.pdf`,
        brand: w9.brand as 'beb' | 'liberty',
      })
      if (sent) {
        deliveredAt = new Date().toISOString()
        deliveredTo = accountantEmail
      }
    } catch (e) {
      console.warn('[w9 submit] email failed (non-fatal — PDF saved):', e)
    }
  }

  // 7. Mark complete.
  const { error: updErr } = await sb.from('w9_requests').update({
    status: 'completed',
    form_data: formData,
    signed_pdf_path: storagePath,
    signed_at: formData.signed_at,
    delivered_at: deliveredAt,
    delivered_pdf_to: deliveredTo,
  }).eq('id', w9.id)
  if (updErr) return NextResponse.json({ error: `DB update: ${updErr.message}` }, { status: 500 })

  return NextResponse.json({
    ok: true,
    deliveredTo,
    storagePath,
  })
}


async function emailW9ToAccountant({
  toEmail, toName, recipientName, pdfBytes, pdfFilename, brand,
}: {
  toEmail: string
  toName: string | null
  recipientName: string
  pdfBytes: Uint8Array
  pdfFilename: string
  brand: 'beb' | 'liberty'
}): Promise<boolean> {
  // Use the shared sendEmail() helper rather than calling Resend
  // directly. The previous implementation read its API key from
  // a different settings row (`email.apiKey` JSON) than the rest
  // of the app (`resend_api_key` flat value), which silently
  // failed once the canonical key was set. Now both create + submit
  // routes participate in the same config + dev-recipient logic.
  const fromAddr = brand === 'liberty'
    ? 'Liberty Estate Buyers <noreply@libertyestatebuyers.com>'
    : 'BEB Portal <noreply@updates.bebllp.com>'

  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hi,'
  const subject = `Signed W-9 from ${recipientName}`
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1f2937; max-width:560px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 12px;">${greeting}</p>
  <p style="margin:0 0 16px;">${escapeHtml(recipientName)} just submitted their signed W-9. The completed form is attached to this email and has also been saved in the portal's Documents section + audit log.</p>
  <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">This email was generated automatically by the BEB portal.</p>
</body></html>`

  try {
    const id = await sendEmail({
      to: toEmail,
      subject,
      html,
      from: fromAddr,
      attachments: [
        { filename: pdfFilename, content: Buffer.from(pdfBytes).toString('base64') },
      ],
    })
    return !!id
  } catch (err) {
    console.warn(`[w9 submit] sendEmail failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
