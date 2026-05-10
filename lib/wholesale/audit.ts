// Insert-once audit log helper. Every meaningful mutation in the
// wholesale module passes through here so the per-record timeline
// (Item / Memo / Invoice detail pages) and the global audit feed
// stay consistent. before/after diffs are stored as JSONB; pass
// only the fields that changed for tighter rows.

import { supabase } from '@/lib/supabase'

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
