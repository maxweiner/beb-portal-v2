// GET /api/reconciliation/findings/[id]/dispute-letter
//
// Renders a one-page PDF dispute letter for a finding. Body is shaped
// by finding_type (amount_mismatch / duplicate_clearing / orphan_cleared
// / outstanding). Returns application/pdf inline so the browser can
// preview before saving.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { renderToBuffer } from '@react-pdf/renderer'
import { readFile } from 'fs/promises'
import path from 'path'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { DisputeLetterPdf, type DisputeLetterData } from '@/lib/reconciliation/disputeLetterPdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const BRAND_FULL_NAME: Record<string, string> = {
  beb: 'Beneficial Estate Buyers, LLP',
  liberty: 'Liberty Estate Buyers, LLC',
}

// ── Logo loader ─────────────────────────────────────────────
// Mirrors the pattern in lib/expenses/generatePdf.ts:
//   1. Per-brand uploaded logo in `brand_logos` table.
//   2. Bundled `public/beb-wordmark.png` fallback (BEB only —
//      Liberty without an upload renders no logo rather than
//      showing the BEB wordmark on a Liberty letter).

const BUNDLED_BEB_WORDMARK = path.join(process.cwd(), 'public', 'beb-wordmark.png')
let bundledBebBuf: Buffer | null = null

function detectImageFormat(buf: Buffer): 'png' | 'jpg' {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg'
  return 'png'
}

async function loadLogo(
  sb: SupabaseClient,
  brand: string,
): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  // 1. Per-brand uploaded logo (Settings → Brand Logos).
  try {
    const { data: row } = await sb
      .from('brand_logos').select('logo_path').eq('brand', brand).maybeSingle()
    const logoPath = (row as any)?.logo_path
    if (logoPath) {
      const { data: file } = await sb.storage.from('brand-logos').download(logoPath)
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer())
        return { data: buf, format: detectImageFormat(buf) }
      }
    }
  } catch { /* fall through */ }

  // 2. BEB-only bundled fallback.
  if (brand !== 'beb') return null
  if (bundledBebBuf) return { data: bundledBebBuf, format: 'png' }
  try {
    bundledBebBuf = await readFile(BUNDLED_BEB_WORDMARK)
    return { data: bundledBebBuf, format: 'png' }
  } catch { return null }
}

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined): boolean {
  return role === 'accounting' || role === 'admin' || role === 'superadmin' || isPartner === true
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = ctx.params.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sb = admin()
  const { data: finding, error } = await sb
    .from('reconciliation_findings')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !finding) {
    return NextResponse.json({ error: error?.message || 'Finding not found' }, { status: 404 })
  }

  // Pull the cleared rows for this check.
  const { data: clearings } = await sb
    .from('cleared_checks')
    .select('cleared_date, cleared_amount, description')
    .eq('brand', finding.brand)
    .eq('check_number', finding.check_number)
    .order('cleared_date', { ascending: true })

  // Optional: brand address from a settings row, if you ever populate one.
  // For now, leave null — the buyer can fill it in by hand on the printed
  // letter, or we can wire this up once the addresses are in `settings`.
  let brandAddress: string | null = null
  let accountLastFour: string | null = null
  const { data: settingsRows } = await sb
    .from('settings')
    .select('key, value')
    .in('key', [`reconciliation.${finding.brand}.address`, `reconciliation.${finding.brand}.account_last_four`])
  for (const r of (settingsRows || []) as any[]) {
    const v = typeof r.value === 'string' ? r.value : (r.value as any)
    const stripped = typeof v === 'string' ? v.replace(/^"|"$/g, '') : null
    if (r.key.endsWith('.address')) brandAddress = stripped
    if (r.key.endsWith('.account_last_four')) accountLastFour = stripped
  }

  const data: DisputeLetterData = {
    brand: finding.brand,
    brandFullName: BRAND_FULL_NAME[finding.brand] || finding.brand.toUpperCase(),
    brandAddress,
    preparedByName: me.name || me.email || '(unknown)',
    preparedByEmail: me.email || '',
    preparedAtIso: new Date().toISOString(),
    findingType: finding.finding_type as DisputeLetterData['findingType'],
    checkNumber: finding.check_number,
    writtenAmount: finding.written_amount != null ? Number(finding.written_amount) : null,
    writtenDate: finding.written_date,
    payeeLabel: finding.payee_label,
    eventLabel: finding.event_label,
    clearings: (clearings || []).map((c: any) => ({
      cleared_date: c.cleared_date,
      cleared_amount: Number(c.cleared_amount),
      description: c.description || '',
    })),
    totalCleared: finding.cleared_amount_total != null ? Number(finding.cleared_amount_total) : 0,
    amountDelta: finding.amount_delta != null ? Number(finding.amount_delta) : null,
    bankName: 'Wells Fargo Bank, N.A.',
    accountLastFour,
    logo: await loadLogo(sb, finding.brand),
  }

  const buffer = await renderToBuffer(DisputeLetterPdf({ data }) as any)
  const filename = `dispute-${finding.brand}-check-${finding.check_number}.pdf`
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
