// Server-side builder for the "Checks Issued" report. Lists every
// buyer_checks row for a given event with optional filters by check
// number (substring) and amount (exact match). Renders a print-ready
// HTML document; the same HTML powers the editor preview iframe, the
// standalone PDF (?print=1), and the email body.
//
// Pulls only day-level rows (entry_id IS NULL) — those are the rows
// the Day Entry UI persists for end-of-day checks.

import { createClient } from '@supabase/supabase-js'

interface CheckRow {
  id: string
  check_number: string | null
  buy_form_number: string | null
  amount: number | null
  payment_type: string | null
  commission_rate: number | null
  day_number: number | null
  created_at: string | null
}

interface BuildOpts {
  eventId: string
  /** Substring match on check_number (case-insensitive). */
  checkNumber?: string
  /** Exact match on amount. Empty / non-numeric = no filter. */
  amount?: string
  templateSubject?: string
  templateGreeting?: string
  templateHeaderSubtitle?: string
  templateFooter?: string
}

export interface ChecksIssuedResult {
  found: boolean
  storeName: string
  eventDate: string
  html: string
  subject: string
  /** How many rows the filters matched. */
  matchCount: number
  /** Total rows for the event before filtering — useful for "showing N of M" copy. */
  totalCount: number
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const fmtMoney = (n: number) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function sub(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

export async function buildChecksIssued(opts: BuildOpts): Promise<ChecksIssuedResult> {
  const sb = admin()

  const { data: event } = await sb
    .from('events')
    .select('id, store_id, start_date, store_name')
    .eq('id', opts.eventId)
    .maybeSingle()
  if (!event) {
    return {
      found: false,
      storeName: '(unknown)', eventDate: '', subject: 'Checks issued (event not found)',
      html: standalonePage('<p>Event not found.</p>'),
      matchCount: 0, totalCount: 0,
    }
  }

  let storeName: string = event.store_name || ''
  if (event.store_id) {
    const { data: store } = await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    if (store?.name) storeName = store.name
  }

  // Day-level checks only (entry_id IS NULL is what Day Entry writes).
  const { data: rows } = await sb
    .from('buyer_checks')
    .select('id, check_number, buy_form_number, amount, payment_type, commission_rate, day_number, created_at')
    .eq('event_id', opts.eventId)
    .is('entry_id', null)
    .order('day_number', { ascending: true })
    .order('created_at', { ascending: true })

  const allChecks = (rows || []) as CheckRow[]
  const totalCount = allChecks.length

  // Apply filters in JS (SQL ILIKE on check_number works too, but the
  // dataset is tiny — at most ~100 rows per event — so JS is simpler
  // and amount needs exact-decimal parity that's awkward in SQL).
  const checkNumQ = (opts.checkNumber || '').trim().toLowerCase()
  const amountQ = (opts.amount || '').trim()
  const amountTarget = amountQ === '' ? null : Number(amountQ)
  const matched = allChecks.filter(c => {
    if (checkNumQ) {
      const cn = (c.check_number || '').toLowerCase()
      if (!cn.includes(checkNumQ)) return false
    }
    if (amountTarget !== null && Number.isFinite(amountTarget)) {
      // Tolerate cents-precision mismatches (e.g. 100 matches 100.00)
      if (Math.abs(Number(c.amount || 0) - amountTarget) > 0.005) return false
    }
    return true
  })

  const eventDateStr = fmtDate(event.start_date)
  const vars = { storeName, eventDate: eventDateStr, date: eventDateStr }
  const headerSubtitle = opts.templateHeaderSubtitle ? sub(opts.templateHeaderSubtitle, vars) : `${storeName} · ${eventDateStr}`
  const footer = opts.templateFooter ? sub(opts.templateFooter, vars) : 'BEB Portal · Checks Issued'
  const subject = opts.templateSubject ? sub(opts.templateSubject, vars) : `Checks issued — ${storeName} · ${eventDateStr}`

  const inner = renderBody({
    storeName, eventDateStr, headerSubtitle, footer,
    rows: matched, totalCount, matchCount: matched.length,
    checkNumberFilter: opts.checkNumber || '',
    amountFilter: opts.amount || '',
  })

  return {
    found: true,
    storeName,
    eventDate: eventDateStr,
    subject,
    html: standalonePage(inner),
    matchCount: matched.length,
    totalCount,
  }
}

function renderBody(opts: {
  storeName: string
  eventDateStr: string
  headerSubtitle: string
  footer: string
  rows: CheckRow[]
  matchCount: number
  totalCount: number
  checkNumberFilter: string
  amountFilter: string
}): string {
  const filterLine: string[] = []
  if (opts.checkNumberFilter.trim()) filterLine.push(`check # contains "${escapeHtml(opts.checkNumberFilter.trim())}"`)
  if (opts.amountFilter.trim()) filterLine.push(`amount = $${escapeHtml(opts.amountFilter.trim())}`)
  const filterSummary = filterLine.length > 0
    ? `<div style="font-size:12px;color:#737368;margin-top:6px"><strong>Filters:</strong> ${filterLine.join(' · ')}</div>`
    : ''

  const countSummary = opts.totalCount === opts.matchCount
    ? `${opts.totalCount} check${opts.totalCount === 1 ? '' : 's'}`
    : `${opts.matchCount} of ${opts.totalCount} checks`

  const rowsHtml = opts.rows.length === 0
    ? `<tr><td colspan="5" style="padding:24px;text-align:center;color:#9CA3AF;font-style:italic">No checks match the current filters.</td></tr>`
    : opts.rows.map(r => `
      <tr style="border-top:1px solid #f3efe6">
        <td style="padding:8px 10px;color:#737368;font-size:12px">Day ${r.day_number ?? '—'}</td>
        <td style="padding:8px 10px;font-weight:700">${escapeHtml(r.check_number || '—')}</td>
        <td style="padding:8px 10px;color:#737368">${escapeHtml(r.buy_form_number || '—')}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#1D6B44">${fmtMoney(Number(r.amount || 0))}</td>
        <td style="padding:8px 10px;text-align:right;color:#737368;font-size:12px">${formatPaymentMeta(r)}</td>
      </tr>`).join('')

  const matchedTotal = opts.rows.reduce((s, r) => s + Number(r.amount || 0), 0)

  return `
    <header style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:800;color:#737368;text-transform:uppercase;letter-spacing:.06em">Checks issued</div>
      <h1 style="font-size:26px;font-weight:900;color:#1a1a16;margin:4px 0 2px">${escapeHtml(opts.storeName)}</h1>
      <div style="font-size:13px;color:#737368">${escapeHtml(opts.headerSubtitle)}</div>
      <div style="font-size:12px;color:#9CA3AF;margin-top:6px">${countSummary}</div>
      ${filterSummary}
    </header>

    <section style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:16px;margin-bottom:14px">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #d8d3ca">
            <th style="text-align:left;padding:6px 10px;color:#737368;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Day</th>
            <th style="text-align:left;padding:6px 10px;color:#737368;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Check #</th>
            <th style="text-align:left;padding:6px 10px;color:#737368;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Buy Form #</th>
            <th style="text-align:right;padding:6px 10px;color:#737368;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Amount</th>
            <th style="text-align:right;padding:6px 10px;color:#737368;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Payment</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${opts.rows.length > 0 ? `
          <tr style="border-top:2px solid #d8d3ca;background:#f5f0e8">
            <td colspan="3" style="padding:10px;font-weight:900">Total ${countSummary === `${opts.totalCount} check${opts.totalCount === 1 ? '' : 's'}` ? '' : '(filtered)'}</td>
            <td style="padding:10px;text-align:right;font-weight:900;color:#1D6B44">${fmtMoney(matchedTotal)}</td>
            <td></td>
          </tr>` : ''}
        </tbody>
      </table>
    </section>

    <footer style="margin-top:24px;text-align:center;font-size:12px;color:#a8a89a">${escapeHtml(opts.footer)}</footer>
  `
}

function formatPaymentMeta(c: CheckRow): string {
  const bits: string[] = []
  if (c.payment_type) bits.push(escapeHtml(c.payment_type))
  if (c.commission_rate != null) bits.push(`${c.commission_rate}%`)
  return bits.join(' · ') || '—'
}

function standalonePage(inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Checks Issued</title>
<style>
  @page { size: letter; margin: 0.6in; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1f2937; background: #f5f0e8; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width: 720px; margin: 0 auto; padding: 24px; }
  @media print {
    body { background: white; }
    .page { padding: 0; max-width: 100%; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="page">
    ${inner}
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
