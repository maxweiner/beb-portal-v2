// Server-side trunk-comms letter PDF generator. Mirrors the
// pattern in lib/expenses/generatePdf.ts:
//   1. Load the bundled logo (cached after first read)
//   2. renderToBuffer the React-PDF Document
//   3. Upload to a private Supabase Storage bucket
//   4. Persist the storage path on the communication_sends row
//
// The generated PDF is also returned in-memory so the caller
// can attach it to the outgoing email without re-downloading.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LetterPdf, type LetterPdfData } from './letterPdf'

const PDFS_BUCKET = 'communication-pdfs'
const LOGO_PATH = path.join(process.cwd(), 'public', 'beb-wordmark.png')
let bundledLogoBuf: Buffer | null = null

async function loadBundledLogo(): Promise<{ data: Buffer; format: 'png' } | null> {
  if (bundledLogoBuf) return { data: bundledLogoBuf, format: 'png' }
  try {
    bundledLogoBuf = await readFile(LOGO_PATH)
    return { data: bundledLogoBuf, format: 'png' }
  } catch { return null }
}

export interface RenderLetterArgs {
  subject: string
  body: string
  storeContact: { name: string | null; email: string | null }
  rep: { name: string; email: string; phone: string }
  sentAt?: string  // ISO; defaults to now
}

/** Render-only — no upload, no DB write. Used by the preview
 *  endpoint and reused by the send endpoint before upload. */
export async function renderLetterBuffer(args: RenderLetterArgs): Promise<Buffer> {
  const data: LetterPdfData = {
    subject: args.subject,
    body: args.body,
    storeContact: args.storeContact,
    rep: args.rep,
    sentAt: args.sentAt || new Date().toISOString(),
    logo: await loadBundledLogo(),
  }
  return renderToBuffer(LetterPdf(data) as any)
}

/** Render + upload + return the storage path. Caller must
 *  back-patch the path onto the communication_sends row.
 *  Uses the canonical key `communications/{send_id}.pdf`. */
export async function renderAndUploadLetter(
  sb: SupabaseClient,
  sendId: string,
  args: RenderLetterArgs,
): Promise<{ storagePath: string; buffer: Buffer }> {
  const buffer = await renderLetterBuffer(args)
  const storagePath = `communications/${sendId}.pdf`
  const { error } = await sb.storage.from(PDFS_BUCKET).upload(storagePath, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw new Error(`PDF upload failed: ${error.message}`)
  return { storagePath, buffer }
}

/** Re-sign an existing letter PDF for download. Used by the
 *  per-trunk-show Communications tab in phase 7. */
export async function signLetterPdf(
  sb: SupabaseClient,
  storagePath: string,
  ttlSeconds = 3600,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(PDFS_BUCKET).createSignedUrl(storagePath, ttlSeconds)
  if (error || !data) throw new Error(`Sign failed: ${error?.message ?? 'no signed url'}`)
  return data.signedUrl
}
