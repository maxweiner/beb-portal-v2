import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { event_id, vendor_ids, message, sent_by } = await req.json()

    // Get event and token
    const { data: ev } = await sb.from('events')
      .select('store_name, start_date, marketing_token')
      .eq('id', event_id)
      .single()

    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // Get vendors — pull id too so the log row can FK back when the
    // vendor still exists.
    const { data: vendors } = await sb.from('marketing_vendors')
      .select('id, name, email')
      .in('id', vendor_ids)

    if (!vendors?.length) return NextResponse.json({ error: 'No vendors found' }, { status: 400 })

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
    const portalLink = `${baseUrl}/marketing/${ev.marketing_token}`
    const eventDate = new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    // Get Resend API key from settings
    const { data: settings } = await sb.from('settings').select('value').eq('key', 'resend_api_key').maybeSingle()
    const resendKey = settings?.value

    if (!resendKey) {
      return NextResponse.json({ error: 'Resend API key not configured' }, { status: 500 })
    }

    // Send to each vendor
    const results = []
    for (const vendor of vendors) {
      const emailBody = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #2D3B2D; padding: 24px; border-radius: 8px 8px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 20px;">◆ Beneficial Estate Buyers</h1>
            <p style="color: rgba(255,255,255,.6); margin: 4px 0 0; font-size: 14px;">Marketing Vendor Portal</p>
          </div>
          <div style="background: #fff; padding: 24px; border: 1px solid #e8e0d0; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #333; font-size: 15px;">Hi ${vendor.name},</p>
            <p style="color: #333; font-size: 15px;">You've been invited to submit artwork proofs for the following event:</p>
            <div style="background: #f5f0e8; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <strong style="font-size: 16px; color: #1a1a1a;">◆ ${ev.store_name}</strong><br/>
              <span style="color: #666; font-size: 14px;">${eventDate}</span>
            </div>
            ${message ? `<p style="color: #333; font-size: 14px; font-style: italic;">"${message}"</p>` : ''}
            <p style="color: #333; font-size: 15px;">Use the link below to upload proofs. No login required — just click and upload.</p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${portalLink}" style="display: inline-block; padding: 14px 32px; background: #2D3B2D; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                Open Vendor Portal →
              </a>
            </div>
            <p style="color: #888; font-size: 12px; text-align: center;">${portalLink}</p>
            <hr style="border: none; border-top: 1px solid #e8e0d0; margin: 20px 0;"/>
            <p style="color: #888; font-size: 12px; margin: 0;">Questions? Contact your BEB representative. This link is unique to this event.</p>
          </div>
        </div>
      `

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'BEB Marketing <marketing@updates.bebllp.com>',
          to: vendor.email,
          subject: `Proof Request — ${ev.store_name} (${eventDate})`,
          html: emailBody,
        })
      })

      const status: 'sent' | 'failed' = res.ok ? 'sent' : 'failed'
      let errorMessage: string | null = null
      if (!res.ok) {
        try { const j = await res.json(); errorMessage = j?.message || j?.error || `HTTP ${res.status}` }
        catch { errorMessage = `HTTP ${res.status}` }
      }

      // Log the send. Best-effort — failures here don't fail the request
      // since the email already went out (or didn't, which we record).
      try {
        await sb.from('marketing_emails_sent').insert({
          event_id,
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          vendor_email: vendor.email,
          message: message || null,
          sent_by: sent_by || null,
          status,
          error_message: errorMessage,
        })
      } catch (logErr) {
        console.error('Failed to log marketing email send', logErr)
      }

      results.push({ vendor: vendor.name, status })
    }

    return NextResponse.json({ success: true, results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
