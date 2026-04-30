// Server-side PDF generator: pulls report + expenses + event + receipt
// signed URLs, renders the @react-pdf/renderer document to a Buffer,
// uploads to the private expense-pdfs bucket, and returns both the
// storage path (for persisting on the report row) and a signed URL
// (for the immediate "open the PDF" button on the client).

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ExpenseReportPdf, type PdfData, type PdfReceipt } from './pdf'
import type { Expense, ExpenseReport } from '@/types'

// Wordmark logo for the PDF header. Cached on first read so subsequent
// renders within the same warm function instance skip the disk hit.
const LOGO_PATH = path.join(process.cwd(), 'public', 'beb-wordmark.png')
let bundledLogoBuf: Buffer | null = null
async function loadBundledLogo(): Promise<Buffer | null> {
  if (bundledLogoBuf) return bundledLogoBuf
  try { bundledLogoBuf = await readFile(LOGO_PATH); return bundledLogoBuf }
  catch { return null }  // Fall back to text wordmark if the asset is missing.
}

// Per-brand uploaded logo (Settings → Brand Logos). Falls back to the
// bundled wordmark when no upload exists for the resolved brand.
async function loadBrandLogo(sb: SupabaseClient, brand: 'beb' | 'liberty' | null): Promise<Buffer | null> {
  if (!brand) return loadBundledLogo()
  const { data } = await sb.from('brand_logos').select('logo_path').eq('brand', brand).maybeSingle()
  const logoPath = (data as any)?.logo_path
  if (!logoPath) return loadBundledLogo()
  const { data: file, error } = await sb.storage.from('brand-logos').download(logoPath)
  if (error || !file) return loadBundledLogo()
  return Buffer.from(await file.arrayBuffer())
}

const RECEIPTS_BUCKET = 'expense-receipts'
const PDFS_BUCKET = 'expense-pdfs'
const RECEIPT_SIGNED_URL_TTL = 60 * 10 // 10 minutes — comfortably longer than a render

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Render a report's PDF, upload it, return storage path + 1h signed URL. */
export async function generateAndStoreReportPdf(reportId: string): Promise<{
  pdfPath: string
  signedUrl: string
}> {
  const sb = adminClient()

  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('*').eq('id', reportId).maybeSingle()
  if (rErr || !report) throw new Error(rErr?.message ?? 'Report not found')

  const [{ data: expensesRaw }, { data: eventRaw }, { data: ownerRaw }] = await Promise.all([
    sb.from('expenses').select('*').eq('expense_report_id', reportId)
      .order('expense_date', { ascending: true }).order('created_at', { ascending: true }),
    sb.from('events').select('store_name, start_date').eq('id', report.event_id).maybeSingle(),
    sb.from('users').select('name, signature_url, last_active_brand').eq('id', report.user_id).maybeSingle(),
  ])

  const expenses = (expensesRaw ?? []) as Expense[]
  const event = eventRaw ? { store_name: eventRaw.store_name, start_date: eventRaw.start_date } : null
  const owner = { name: (ownerRaw as any)?.name ?? '(unknown)' }
  const signatureUrl = (ownerRaw as any)?.signature_url ?? null
  const ownerBrand = ((ownerRaw as any)?.last_active_brand ?? 'beb') as 'beb' | 'liberty'

  // Sign receipt URLs in batch — only those with an actual receipt_url.
  const receiptExpenses = expenses.filter(e => !!e.receipt_url)
  const receipts: PdfReceipt[] = []
  if (receiptExpenses.length > 0) {
    // createSignedUrls accepts a list of object paths in one call.
    const paths = receiptExpenses.map(e => e.receipt_url!) as string[]
    const { data: signed } = await sb.storage.from(RECEIPTS_BUCKET).createSignedUrls(paths, RECEIPT_SIGNED_URL_TTL)
    const byPath = new Map<string, string>()
    for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
      if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl)
    }
    for (const e of receiptExpenses) {
      const url = byPath.get(e.receipt_url!)
      if (!url) continue
      receipts.push({
        id: e.id,
        url,
        vendor: e.vendor,
        date: e.expense_date,
        amount: Number(e.amount || 0),
      })
    }
  }

  const data: PdfData = {
    report: report as ExpenseReport,
    expenses,
    event,
    owner,
    receipts,
    signatureUrl,
    logo: await loadBrandLogo(sb, ownerBrand),
  }

  const buffer = await renderToBuffer(ExpenseReportPdf(data) as any)

  const path = `${report.user_id}/${report.id}.pdf`
  const { error: upErr } = await sb.storage.from(PDFS_BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  // Persist the path on the report row for the history page in later PRs.
  await sb.from('expense_reports').update({ pdf_url: path }).eq('id', report.id)

  const { data: signed, error: signErr } = await sb.storage.from(PDFS_BUCKET)
    .createSignedUrl(path, 60 * 60)
  if (signErr || !signed) throw new Error(`Sign failed: ${signErr?.message ?? 'no signed url'}`)

  return { pdfPath: path, signedUrl: signed.signedUrl }
}

/** Re-sign an existing PDF without regenerating. */
export async function signReportPdf(pdfPath: string, ttlSeconds = 3600): Promise<string> {
  const sb = adminClient()
  const { data, error } = await sb.storage.from(PDFS_BUCKET).createSignedUrl(pdfPath, ttlSeconds)
  if (error || !data) throw new Error(`Sign failed: ${error?.message ?? 'no signed url'}`)
  return data.signedUrl
}

/** Returns the raw PDF bytes for use as an email attachment. */
export async function fetchReportPdfBytes(pdfPath: string): Promise<Buffer> {
  const sb = adminClient()
  const { data, error } = await sb.storage.from(PDFS_BUCKET).download(pdfPath)
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? 'no data'}`)
  const arr = await data.arrayBuffer()
  return Buffer.from(arr)
}
