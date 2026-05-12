// Insert-once audit log helper. Every meaningful mutation in the
// wholesale module passes through here so the per-record timeline
// (Item / Memo / Invoice detail pages) and the global audit feed
// stay consistent. before/after diffs are stored as JSONB; pass
// only the fields that changed for tighter rows.

import { supabase } from '@/lib/supabase'
import type { WholesaleAuditLogEntry } from '@/types/wholesale'

export type AuditEntityType =
  | 'inventory_item'
  | 'inventory_photo'
  | 'inventory_document'
  | 'wholesale_vendor'
  | 'wholesale_customer'
  | 'wholesale_memo'
  | 'wholesale_memo_line'
  | 'wholesale_invoice'
  | 'wholesale_invoice_line'
  | 'wholesale_invoice_tradein_line'
  | 'wholesale_invoice_payment'
  | 'inventory_location'

export type AuditAction =
  | 'created' | 'updated' | 'archived' | 'unarchived' | 'deleted'
  | 'status_changed' | 'cost_edited' | 'memo_converted'
  | 'scrapped'
  | 'document_uploaded' | 'document_deleted'
  | 'photo_uploaded' | 'photo_deleted' | 'photo_set_primary'
  | 'payment_added' | 'payment_voided'
  | 'tradein_created'

export interface AuditEntryInput {
  brand: string
  entity_type: AuditEntityType
  entity_id: string | null
  action: AuditAction
  before?: Record<string, any> | null
  after?: Record<string, any> | null
  actor_id?: string | null
  actor_email?: string | null
}

/** Fire-and-forget audit log insert. Errors are logged but never
 *  bubble — an audit failure must not block the user's mutation. */
export async function logAudit(entry: AuditEntryInput): Promise<void> {
  try {
    const { error } = await supabase.from('wholesale_audit_log').insert({
      brand:        entry.brand,
      entity_type:  entry.entity_type,
      entity_id:    entry.entity_id,
      action:       entry.action,
      before:       entry.before ?? null,
      after:        entry.after ?? null,
      actor_id:     entry.actor_id ?? null,
      actor_email:  entry.actor_email ?? null,
    })
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('audit log insert failed:', error.message)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('audit log insert threw:', e)
  }
}

/** Fetch an item's full lifecycle history — its own audit rows PLUS
 *  rows for related entities (photos, documents, memo lines, invoice
 *  lines, the memos/invoices/payments that touched it). Merged and
 *  sorted by created_at desc.
 *
 *  Each returned entry has the original WholesaleAuditLogEntry shape
 *  so the renderer can use entity_type to label the source.
 *
 *  Why this exists: the per-item History tab used to only show
 *  inventory_item rows, so "sold on memo 124 → returned → re-sold on
 *  invoice 88" was invisible. This stitches the whole story together
 *  client-side. PostgREST can't do an OR over multiple (entity_type,
 *  entity_id) tuples cheaply, so we issue a handful of parallel
 *  queries and merge in JS — fine for a single item's history. */
export async function fetchItemHistory(
  itemId: string,
  limit = 200,
): Promise<WholesaleAuditLogEntry[]> {
  // First gather every related row's id so we know which audit rows
  // to pull. Cheap parallel queries against indexed item_id columns.
  const [photos, docs, memoLines, invoiceLines] = await Promise.all([
    supabase.from('inventory_photos').select('id').eq('item_id', itemId),
    supabase.from('inventory_documents').select('id').eq('item_id', itemId),
    supabase.from('wholesale_memo_lines').select('id, memo_id').eq('item_id', itemId),
    supabase.from('wholesale_invoice_lines').select('id, invoice_id').eq('item_id', itemId),
  ])
  const photoIds       = ((photos.data || []) as any[]).map(r => r.id)
  const docIds         = ((docs.data || []) as any[]).map(r => r.id)
  const memoLineIds    = ((memoLines.data || []) as any[]).map(r => r.id)
  const invoiceLineIds = ((invoiceLines.data || []) as any[]).map(r => r.id)
  const memoIds        = Array.from(new Set(((memoLines.data || []) as any[]).map(r => r.memo_id).filter(Boolean)))
  const invoiceIds     = Array.from(new Set(((invoiceLines.data || []) as any[]).map(r => r.invoice_id).filter(Boolean)))

  // Payments roll up to the invoices that touched this item. We pull
  // their ids in a second hop because the audit table only stores
  // entity_id = payment_id (no direct item link).
  let paymentIds: string[] = []
  if (invoiceIds.length > 0) {
    const { data: payRows } = await supabase
      .from('wholesale_invoice_payments')
      .select('id')
      .in('invoice_id', invoiceIds)
    paymentIds = ((payRows || []) as any[]).map(r => r.id)
  }

  // Build the audit queries — only run a query when we have ids to
  // match against. Each one filters by (entity_type, entity_id) which
  // is the primary access pattern on wholesale_audit_log.
  // Supabase query builders are thenable so Promise.all works, but TS
  // doesn't see them as Promise<T>. Loose typing on this array.
  const queries: any[] = [
    supabase.from('wholesale_audit_log').select('*')
      .eq('entity_type', 'inventory_item').eq('entity_id', itemId),
  ]
  const pushIn = (entity_type: string, ids: string[]) => {
    if (ids.length === 0) return
    queries.push(
      supabase.from('wholesale_audit_log').select('*')
        .eq('entity_type', entity_type)
        .in('entity_id', ids),
    )
  }
  pushIn('inventory_photo',           photoIds)
  pushIn('inventory_document',        docIds)
  pushIn('wholesale_memo_line',       memoLineIds)
  pushIn('wholesale_invoice_line',    invoiceLineIds)
  pushIn('wholesale_memo',            memoIds)
  pushIn('wholesale_invoice',         invoiceIds)
  pushIn('wholesale_invoice_payment', paymentIds)

  const results = await Promise.all(queries)
  const merged: WholesaleAuditLogEntry[] = []
  for (const r of results) {
    for (const row of (r.data || []) as WholesaleAuditLogEntry[]) {
      merged.push(row)
    }
  }
  // Newest first; tie-break on id so the order is stable.
  merged.sort((a, b) => {
    const c = (b.created_at || '').localeCompare(a.created_at || '')
    return c !== 0 ? c : (b.id || '').localeCompare(a.id || '')
  })
  return merged.slice(0, limit)
}

/** Compute a minimal before/after diff over a set of fields. Skips
 *  fields whose value didn't change. Returns null if nothing changed. */
export function diffFields(
  before: Record<string, any>,
  after: Record<string, any>,
  fields: string[],
): { before: Record<string, any>; after: Record<string, any> } | null {
  const b: Record<string, any> = {}
  const a: Record<string, any> = {}
  let changed = 0
  for (const f of fields) {
    if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) {
      b[f] = before[f] ?? null
      a[f] = after[f] ?? null
      changed++
    }
  }
  return changed > 0 ? { before: b, after: a } : null
}
