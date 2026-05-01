// Server-side query builder for Marketing Export filters. Used by
// both the preview route (count only) and the run route (full row
// fetch + CSV generation). Lives in /lib/ so the win-back segment
// + lookalike export phases can reuse it.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportFilters } from './exportFilters'

interface QueryOpts {
  sb: SupabaseClient
  filters: ExportFilters
  /** Columns to select. Use 'id' (head=true) for a count-only query;
   *  use the full address column set for a CSV-row fetch. */
  selectCols: string
  countOnly?: boolean
}

/**
 * Run the filtered customer query. Returns either the row array OR
 * the count, depending on countOnly. Always-on suppressions:
 *   - do_not_contact = false
 *   - deleted_at IS NULL
 *
 * Tag filters use a pre-fetched id-set since supabase-js doesn't
 * easily express "customer_id IN (SELECT customer_id FROM
 * customer_tags GROUP BY customer_id HAVING ...)" inline.
 *
 * Mailing-recency uses a similar pre-fetch — get the set of
 * customer_ids mailed in the last N days, then exclude.
 */
export async function runExportQuery(opts: QueryOpts): Promise<{
  rows: Record<string, unknown>[]
  count: number
}> {
  const { sb, filters, selectCols, countOnly } = opts

  // ── Tag pre-fetch ────────────────────────────────────────
  let allowedTagIds: Set<string> | null = null
  if (filters.tags && filters.tags.length > 0) {
    const { data: tagRows } = await sb.from('customer_tags')
      .select('customer_id, tag').in('tag', filters.tags)
    const byCust = new Map<string, Set<string>>()
    for (const r of (tagRows ?? []) as { customer_id: string; tag: string }[]) {
      const s = byCust.get(r.customer_id) ?? new Set<string>()
      s.add(r.tag); byCust.set(r.customer_id, s)
    }
    allowedTagIds = new Set<string>()
    if ((filters.tagsLogic ?? 'or') === 'and') {
      for (const [cust, set] of byCust) {
        if (set.size === filters.tags.length) allowedTagIds.add(cust)
      }
    } else {
      for (const cust of byCust.keys()) allowedTagIds.add(cust)
    }
    // No matches → return early
    if (allowedTagIds.size === 0) return { rows: [], count: 0 }
  }

  // ── Mailing-recency pre-fetch (exclude set) ──────────────
  let excludeMailedIds: Set<string> | null = null
  if (filters.daysSinceLastMailing && filters.daysSinceLastMailing > 0) {
    const cutoffIso = new Date(Date.now() - filters.daysSinceLastMailing * 86_400_000).toISOString()
    const { data: recent } = await sb.from('customer_mailings')
      .select('customer_id').gte('mailed_at', cutoffIso)
    excludeMailedIds = new Set<string>(
      ((recent ?? []) as { customer_id: string }[]).map(r => r.customer_id),
    )
  }

  // ── Main query ───────────────────────────────────────────
  let q = sb.from('customers')
    .select(selectCols, { count: 'exact', head: !!countOnly })
    .eq('store_id', filters.storeId)
    .eq('do_not_contact', false)
    .is('deleted_at', null)

  if (filters.tiers && filters.tiers.length > 0) q = q.in('engagement_tier', filters.tiers)
  if (filters.howHeardEnum && filters.howHeardEnum.length > 0) q = q.in('how_did_you_hear', filters.howHeardEnum)
  if (filters.howHeardLegacy && filters.howHeardLegacy.length > 0) q = q.in('how_did_you_hear_legacy', filters.howHeardLegacy)
  if (typeof filters.lifetimeApptMin === 'number') q = q.gte('lifetime_appointment_count', filters.lifetimeApptMin)
  if (typeof filters.lifetimeApptMax === 'number') q = q.lte('lifetime_appointment_count', filters.lifetimeApptMax)
  if (filters.firstApptStart)   q = q.gte('first_appointment_date',  filters.firstApptStart)
  if (filters.firstApptEnd)     q = q.lte('first_appointment_date',  filters.firstApptEnd)
  if (filters.lastContactStart) q = q.gte('last_contact_date',       filters.lastContactStart)
  if (filters.lastContactEnd)   q = q.lte('last_contact_date',       filters.lastContactEnd)

  if (allowedTagIds) q = q.in('id', Array.from(allowedTagIds))
  if (excludeMailedIds && excludeMailedIds.size > 0) {
    // supabase-js doesn't have a NOT IN convenience; use .not()
    const list = '(' + Array.from(excludeMailedIds).map(id => `"${id}"`).join(',') + ')'
    q = q.not('id', 'in', list)
  }

  // Cap row fetch to keep payloads sane. CSV exports of >50k people
  // would be unusual at our scale.
  if (!countOnly) q = q.limit(50_000).order('last_name').order('first_name')

  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return { rows: ((data ?? []) as unknown) as Record<string, unknown>[], count: count ?? 0 }
}
