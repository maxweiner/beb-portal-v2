// Completion notification for a white-sheet upload.
//
// Called by the OCR worker (lib/white-sheets/process.ts) the
// moment finalize_white_sheet_upload_if_done returns
// 'just_finalized' — that's the one-shot signal that THIS run
// flipped the upload from 'processing' to 'complete'.
//
// The flow:
//   1. Read the upload row + the event + the uploader's email.
//   2. Send an email summary via lib/email.ts.
//   3. Stamp notification_sent_at so a retried cron tick can't
//      double-send.
//
// Errors don't propagate: the worker logs and moves on. The
// upload row stays in 'complete'; only notification_sent_at
// stays NULL, which means the next cron tick can retry the
// send. Phase 8 could add a separate dunning cron for stuck
// uploads; for now a single retry per tick is plenty.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _admin
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  )
}

interface UploadSummary {
  id: string
  event_id: string
  brand: string
  uploaded_by_user_id: string | null
  original_filename: string | null
  pages_total: number
  pages_auto_committed: number
  pages_in_review: number
  pages_errored: number
  estimated_cost_cents: number
  created_at: string
  completed_at: string | null
  notification_sent_at: string | null
}

/** Compose the HTML body for the completion email. */
function emailHtml(args: {
  storeName: string
  upload: UploadSummary
  reviewPileUrl: string
}): string {
  const { storeName, upload, reviewPileUrl } = args
  const filename = upload.original_filename || 'White sheet upload'
  const elapsedSec = upload.completed_at
    ? Math.max(0, Math.round(
        (new Date(upload.completed_at).getTime() - new Date(upload.created_at).getTime()) / 1000,
      ))
    : null
  const elapsedLabel = elapsedSec === null ? '' :
    elapsedSec < 90  ? `${elapsedSec}s` :
    elapsedSec < 7200 ? `${Math.round(elapsedSec / 60)}m` :
                        `${(elapsedSec / 3600).toFixed(1)}h`

  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px; line-height: 1.55;">
  <h2 style="font-size: 18px; font-weight: 800; margin: 0 0 4px;">📄 White sheets processed</h2>
  <div style="font-size: 13px; color: #6B7280; margin-bottom: 18px;">
    ${escapeHtml(storeName)} · ${escapeHtml(filename)}
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #E5E7EB;">
        <div style="font-size: 11px; color: #6B7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">Pages</div>
        <div style="font-size: 22px; font-weight: 800;">${upload.pages_total}</div>
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #E5E7EB; text-align: right;">
        ${elapsedLabel ? `<div style="font-size: 11px; color: #6B7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">Elapsed</div>
        <div style="font-size: 22px; font-weight: 800;">${elapsedLabel}</div>` : ''}
      </td>
    </tr>
  </table>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr>
      <td style="padding: 8px 12px; background: #DCFCE7; border-radius: 6px;">
        <div style="font-size: 12px; font-weight: 700; color: #166534;">✅ Auto-committed</div>
        <div style="font-size: 20px; font-weight: 800; color: #166534;">${upload.pages_auto_committed}</div>
      </td>
    </tr>
    ${upload.pages_in_review > 0 ? `
    <tr><td style="height: 6px;"></td></tr>
    <tr>
      <td style="padding: 8px 12px; background: #FEF3C7; border-radius: 6px;">
        <div style="font-size: 12px; font-weight: 700; color: #92400E;">⚠️ Need review</div>
        <div style="font-size: 20px; font-weight: 800; color: #92400E;">${upload.pages_in_review}</div>
      </td>
    </tr>` : ''}
    ${upload.pages_errored > 0 ? `
    <tr><td style="height: 6px;"></td></tr>
    <tr>
      <td style="padding: 8px 12px; background: #FEE2E2; border-radius: 6px;">
        <div style="font-size: 12px; font-weight: 700; color: #991B1B;">❌ Errored</div>
        <div style="font-size: 20px; font-weight: 800; color: #991B1B;">${upload.pages_errored}</div>
      </td>
    </tr>` : ''}
  </table>

  ${(upload.pages_in_review > 0 || upload.pages_errored > 0) ? `
  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${reviewPileUrl}" style="display: inline-block; padding: 10px 20px; background: #1D6B44; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 800; font-size: 14px;">
      Open review pile →
    </a>
  </div>` : `
  <div style="padding: 12px; background: #F3F4F6; border-radius: 6px; font-size: 13px; color: #4B5563; text-align: center; margin-bottom: 24px;">
    All pages auto-committed — nothing to review. 🎉
  </div>`}

  <div style="font-size: 11px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 12px;">
    Processing cost: ~\$${(upload.estimated_cost_cents / 100).toFixed(2)} ·
    <a href="${portalUrl()}" style="color: #6B7280;">portal.bebllp.com</a>
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Compose + send the completion email. Returns true on success
 *  (or graceful skip), false on a thrown send failure. */
export async function sendCompletionEmail(uploadId: string): Promise<boolean> {
  const sb = admin()

  // Pull the upload + its event + the uploader's email in one
  // round trip.
  const { data, error } = await sb
    .from('white_sheet_uploads')
    .select(`
      id, event_id, brand, uploaded_by_user_id,
      original_filename, pages_total,
      pages_auto_committed, pages_in_review, pages_errored,
      estimated_cost_cents, created_at, completed_at,
      notification_sent_at,
      events!inner(id, store_name),
      uploader:users!white_sheet_uploads_uploaded_by_user_id_fkey(email, name)
    `)
    .eq('id', uploadId)
    .maybeSingle()
  if (error || !data) {
    console.warn('[whiteSheets.notify] upload not found', uploadId, error?.message)
    return false
  }

  const upload = data as any as UploadSummary & {
    events: { store_name: string }
    uploader?: { email: string | null; name: string | null } | null
  }

  // Guard: already sent — fall through as success (idempotent).
  if (upload.notification_sent_at) return true

  // No uploader to email (orphaned via ON DELETE SET NULL) —
  // log + stamp so we don't keep retrying. The launcher badge
  // still surfaces the result in-app.
  const uploaderEmail = upload.uploader?.email
  if (!uploaderEmail) {
    console.warn('[whiteSheets.notify] no uploader email; stamping anyway', uploadId)
    await sb.from('white_sheet_uploads')
      .update({ notification_sent_at: new Date().toISOString() })
      .eq('id', uploadId)
    return true
  }

  const storeName = upload.events?.store_name || 'White sheet upload'
  const reviewPileUrl = `${portalUrl()}/?event_id=${upload.event_id}#white-sheet-review`

  // Subject mirrors the in-app notification body — most readable
  // glance gives you the headline counts without opening the mail.
  const piecesParts: string[] = [`✅ ${upload.pages_auto_committed}`]
  if (upload.pages_in_review > 0) piecesParts.push(`⚠️ ${upload.pages_in_review}`)
  if (upload.pages_errored > 0)    piecesParts.push(`❌ ${upload.pages_errored}`)
  const subject = `${storeName} · ${upload.pages_total} white sheets processed (${piecesParts.join(' · ')})`

  try {
    await sendEmail({
      to: upload.uploader?.name ? `${upload.uploader.name} <${uploaderEmail}>` : uploaderEmail,
      subject,
      html: emailHtml({ storeName, upload, reviewPileUrl }),
    })
  } catch (e: any) {
    console.warn('[whiteSheets.notify] send failed; leaving notification_sent_at NULL for retry', uploadId, e?.message)
    return false
  }

  // Mark sent so a retry doesn't double-fire.
  await sb.from('white_sheet_uploads')
    .update({ notification_sent_at: new Date().toISOString() })
    .eq('id', uploadId)

  return true
}
