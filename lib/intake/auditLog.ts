/**
 * Audit log + 3-day edit lock for intakes (Phase 8).
 *
 * Every edit / soft-delete / reprocess writes to intake_audit_log with the
 * actor + the diff of what changed. After 3 days, edits are locked except
 * for superadmins (who can still adjust historical records when needed).
 */

import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

const EDIT_LOCK_DAYS = 3

export type IntakeAuditAction =
  | 'create'
  | 'update'
  | 'submit_day_entry'
  | 'soft_delete'
  | 'reprocess'

export interface IntakeAuditEntry {
  intakeId: string
  actorUserId: string | null
  action: IntakeAuditAction
  /** `{ field: [oldValue, newValue], ... }`. Optional. */
  changedFields?: Record<string, [unknown, unknown]>
}

/** Best-effort write — never throws so it can't break the parent op. */
export async function writeIntakeAudit(entry: IntakeAuditEntry): Promise<void> {
  try {
    await supabase.from('intake_audit_log').insert({
      intake_id: entry.intakeId,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      changed_fields: entry.changedFields ?? null,
    })
  } catch (e) {
    console.warn('[intake audit] write failed', e)
  }
}

export interface EditPermissionCheck {
  canEdit: boolean
  reason: string | null
}

/**
 * Returns whether `user` is allowed to edit the intake right now.
 * Locked after 3 days from `created_at` unless the user is a superadmin.
 * (Other roles — admin, partner, the original buyer — are also blocked
 * past the lock to preserve historical records.)
 */
export function canEditIntake(
  user: User | null | undefined,
  intakeCreatedAt: string,
): EditPermissionCheck {
  if (!user) return { canEdit: false, reason: 'Not signed in.' }

  const isSuperadmin = user.role === 'superadmin'
  if (isSuperadmin) return { canEdit: true, reason: null }

  const createdMs = new Date(intakeCreatedAt).getTime()
  const ageDays = (Date.now() - createdMs) / 86_400_000
  if (ageDays >= EDIT_LOCK_DAYS) {
    return {
      canEdit: false,
      reason: `Locked after ${EDIT_LOCK_DAYS} days. Ask a superadmin to make changes.`,
    }
  }
  return { canEdit: true, reason: null }
}

/** Helper for callers to compute the diff before writing the audit row. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    if (before[k] !== after[k]) out[k] = [before[k] ?? null, after[k] ?? null]
  }
  return out
}
