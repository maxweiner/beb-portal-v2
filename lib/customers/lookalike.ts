// Lookalike export — find customers at the SAME store who match the
// profile signature of a source segment but aren't in that segment.
//
// Simple v1 per spec: same store, top-10 zip codes from the source
// segment, exclude DNC + soft-deleted + the source-segment IDs
// themselves. More sophisticated lookalike modeling (ML, address
// vectors, etc.) is explicitly out of scope.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportFilters } from './exportFilters'
import { runExportQuery } from './exportQuery'

export interface LookalikeSignature {
  sourceCount: number
  topZips: { zip: string; count: number }[]
  topSources: { label: string; count: number }[]
  avgLifetimeAppts: number
}

export interface LookalikeResult {
  signature: LookalikeSignature
  lookalikeCount: number
  /** When loadRows=true, the matching customers' core fields. */
  rows?: Record<string, unknown>[]
}

interface SourceCust {
  id: string
  zip: string | null
  how_did_you_hear: string | null
  how_did_you_hear_legacy: string | null
  lifetime_appointment_count: number
}

/** Compute the signature for a set of source customers. */
function computeSignature(rows: SourceCust[]): LookalikeSignature {
  if (rows.length === 0) {
    return { sourceCount: 0, topZips: [], topSources: [], avgLifetimeAppts: 0 }
  }
  // Top zips
  const zipBuckets = new Map<string, number>()
  let totalAppts = 0
  for (const r of rows) {
    if (r.zip) zipBuckets.set(r.zip, (zipBuckets.get(r.zip) ?? 0) + 1)
    totalAppts += Number(r.lifetime_appointment_count || 0)
  }
  const topZips = Array.from(zipBuckets.entries())
    .map(([zip, count]) => ({ zip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  // Top sources (combined enum + legacy)
  const sourceBuckets = new Map<string, number>()
  for (const r of rows) {
    const label = r.how_did_you_hear || r.how_did_you_hear_legacy || '(unknown)'
    sourceBuckets.set(label, (sourceBuckets.get(label) ?? 0) + 1)
  }
  const topSources = Array.from(sourceBuckets.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  return {
    sourceCount: rows.length,
    topZips,
    topSources,
    avgLifetimeAppts: totalAppts / rows.length,
  }
}

/**
 * Run the lookalike pipeline:
 *   1. Resolve source segment customers via runExportQuery.
 *   2. Compute the signature (top 10 zips, top sources, avg appts).
 *   3. Find candidates at the same store whose zip is in top10,
 *      excluding the source IDs + always-on suppressions.
 *
 * Returns { signature, lookalikeCount }. Pass loadRows=true to also
 * get the row payload (used by the export route).
 */
export async function runLookalike(opts: {
  sb: SupabaseClient
  sourceFilters: ExportFilters
  loadRows?: boolean
}): Promise<LookalikeResult> {
  const { sb, sourceFilters, loadRows } = opts

  // Pull source customers (lightweight column set for signature math).
  const { rows: srcRaw } = await runExportQuery({
    sb, filters: sourceFilters,
    selectCols: 'id, zip, how_did_you_hear, how_did_you_hear_legacy, lifetime_appointment_count',
    countOnly: false,
  })
  const src = srcRaw as unknown as SourceCust[]
  const signature = computeSignature(src)

  if (signature.topZips.length === 0) {
    return { signature, lookalikeCount: 0, rows: loadRows ? [] : undefined }
  }

  // Build the lookalike query: same store, zip in top10, NOT in source.
  // do_not_contact + deleted_at suppression handled by the manual
  // .eq/.is below (we're not going through runExportQuery here because
  // we need a NOT-IN on customer ids).
  const sourceIds = src.map(r => r.id)
  const topZipList = signature.topZips.map(z => z.zip)
  const cols = loadRows
    ? 'id, first_name, last_name, address_line_1, address_line_2, city, state, zip'
    : 'id'

  let q = sb.from('customers')
    .select(cols, { count: 'exact', head: !loadRows })
    .eq('store_id', sourceFilters.storeId)
    .eq('do_not_contact', false)
    .is('deleted_at', null)
    .in('zip', topZipList)
  if (sourceIds.length > 0) {
    const list = '(' + sourceIds.map(id => `"${id}"`).join(',') + ')'
    q = q.not('id', 'in', list)
  }
  if (loadRows) q = q.limit(50_000).order('last_name').order('first_name')
  const { data, count, error } = await q
  if (error) throw new Error(error.message)

  return {
    signature,
    lookalikeCount: count ?? 0,
    rows: loadRows ? (data as unknown as Record<string, unknown>[]) : undefined,
  }
}
