// POST /api/wholesale/diamond-lookup
// Body: { lab: string, report_number: string }
//
// Three-tier lookup: RapNet → GIA Report Check scrape → manual.
// Today's implementation:
//   - If RAPNET_API_KEY env var is set, calls the RapNet API and
//     returns the parsed payload. Without docs/credentials we ship
//     a placeholder request shape; replace with the real endpoint
//     when access is provisioned.
//   - GIA scrape is a stub that returns null so the UI falls
//     through to manual. The page surfaces "verify all fields"
//     copy whenever source != 'manual'.
//
// Always returns the same shape so the frontend can render results
// without knowing which tier hit.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

interface DiamondLookup {
  shape?: string | null
  carat?: number | null
  color?: string | null
  clarity?: string | null
  cut?: string | null
  polish?: string | null
  symmetry?: string | null
  fluorescence?: string | null
  measurements?: string | null
  depth_pct?: number | null
  table_pct?: number | null
}

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined) {
  return role === 'superadmin' || role === 'admin' || isPartner === true
}

async function rapnetLookup(lab: string, reportNumber: string): Promise<DiamondLookup | null> {
  const key = process.env.RAPNET_API_KEY
  if (!key) return null
  // Placeholder: RapNet's marketplace API returns by stock — see
  // https://app.rapaport.com/Apidocumentation. Replace this body with
  // the real endpoint + auth flow when access is provisioned.
  try {
    const res = await fetch('https://technet.rapaport.com/HTTP/JSON/RapAPI/RapAPI.aspx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ method: 'GetSingleDiamond', report_number: reportNumber, lab }),
    })
    if (!res.ok) return null
    const json: any = await res.json()
    const d = json?.diamond ?? json
    if (!d) return null
    return {
      shape: d.shape ?? null,
      carat: d.carat != null ? Number(d.carat) : null,
      color: d.color ?? null,
      clarity: d.clarity ?? null,
      cut: d.cut ?? null,
      polish: d.polish ?? null,
      symmetry: d.symmetry ?? null,
      fluorescence: d.fluorescence ?? null,
      measurements: d.measurements ?? null,
      depth_pct: d.depth != null ? Number(d.depth) : null,
      table_pct: d.table != null ? Number(d.table) : null,
    }
  } catch {
    return null
  }
}

async function giaScrape(reportNumber: string): Promise<DiamondLookup | null> {
  // Stub — GIA's Report Check page is JS-driven and ToS-restricted.
  // Implement with a headless browser or licensed lab API only after
  // legal review. Returns null today so the UI falls through to
  // manual entry.
  return null
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const lab = String(body?.lab || '').trim()
  const reportNumber = String(body?.report_number || '').trim()
  if (!reportNumber) return NextResponse.json({ error: 'report_number required' }, { status: 400 })

  // Tier 1: RapNet
  const rap = await rapnetLookup(lab || 'GIA', reportNumber)
  if (rap) return NextResponse.json({ source: 'rapnet', diamond: rap })

  // Tier 2: GIA scrape (today: stub)
  if (lab === 'GIA' || !lab) {
    const gia = await giaScrape(reportNumber)
    if (gia) return NextResponse.json({ source: 'gia_scrape', diamond: gia })
  }

  // Tier 3: nothing automated
  return NextResponse.json({
    source: 'manual',
    diamond: null,
    reason: process.env.RAPNET_API_KEY
      ? 'Stone not found in RapNet or GIA Report Check; fill in manually.'
      : 'RapNet API key not configured (set RAPNET_API_KEY); fill in manually.',
  })
}
