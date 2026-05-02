// Trunk show CRUD + per-day hours. The trunk_show_hours table
// has one row per show_date; we expose helpers that ensure the
// rows match the show's start/end range when the dates change.

import { supabase } from '@/lib/supabase'
import type { TrunkShow, TrunkShowHours, TrunkShowStatus } from '@/types'

const SHOW_COLS = `id, store_id, start_date, end_date, assigned_rep_id,
  status, notes, created_at, updated_at, deleted_at`

const HOURS_COLS = `id, trunk_show_id, show_date, open_time, close_time, created_at`

const DEFAULT_OPEN  = '10:00'
const DEFAULT_CLOSE = '17:00'

export async function listTrunkShows(): Promise<TrunkShow[]> {
  const { data, error } = await supabase
    .from('trunk_shows').select(SHOW_COLS)
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as TrunkShow[]
}

export async function getTrunkShow(id: string): Promise<TrunkShow | null> {
  const { data, error } = await supabase
    .from('trunk_shows').select(SHOW_COLS).eq('id', id)
    .is('deleted_at', null).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as TrunkShow) || null
}

export interface TrunkShowDraft {
  store_id: string
  start_date: string
  end_date: string
  assigned_rep_id: string
  status?: TrunkShowStatus
  notes?: string | null
}

export async function createTrunkShow(draft: TrunkShowDraft): Promise<TrunkShow> {
  const { data, error } = await supabase.from('trunk_shows').insert({
    store_id: draft.store_id,
    start_date: draft.start_date,
    end_date: draft.end_date,
    assigned_rep_id: draft.assigned_rep_id,
    status: draft.status || 'scheduled',
    notes: draft.notes?.trim() || null,
  }).select(SHOW_COLS).single()
  if (error) throw new Error(error.message)
  // Seed default hours rows for each date in the range.
  const dates = enumerateDates(draft.start_date, draft.end_date)
  if (dates.length > 0) {
    await supabase.from('trunk_show_hours').insert(
      dates.map(d => ({
        trunk_show_id: data.id,
        show_date: d,
        open_time:  DEFAULT_OPEN,
        close_time: DEFAULT_CLOSE,
      })),
    )
  }
  return data as TrunkShow
}

export async function updateTrunkShow(id: string, patch: Partial<TrunkShowDraft>): Promise<void> {
  const update: any = {}
  if (patch.store_id !== undefined) update.store_id = patch.store_id
  if (patch.start_date !== undefined) update.start_date = patch.start_date
  if (patch.end_date !== undefined) update.end_date = patch.end_date
  if (patch.assigned_rep_id !== undefined) update.assigned_rep_id = patch.assigned_rep_id
  if (patch.status !== undefined) update.status = patch.status
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  if (Object.keys(update).length === 0) return
  const { error } = await supabase.from('trunk_shows').update(update).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function softDeleteTrunkShow(id: string): Promise<void> {
  const { error } = await supabase.from('trunk_shows')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ── hours ─────────────────────────────────────────────── */

export async function listHours(trunkShowId: string): Promise<TrunkShowHours[]> {
  const { data, error } = await supabase
    .from('trunk_show_hours').select(HOURS_COLS)
    .eq('trunk_show_id', trunkShowId)
    .order('show_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as TrunkShowHours[]
}

export async function setHoursForDate(trunkShowId: string, showDate: string, openTime: string, closeTime: string): Promise<void> {
  const { error } = await supabase.from('trunk_show_hours').upsert(
    { trunk_show_id: trunkShowId, show_date: showDate, open_time: openTime, close_time: closeTime },
    { onConflict: 'trunk_show_id,show_date' },
  )
  if (error) throw new Error(error.message)
}

/** Reconcile hours rows when the show's date range changes. */
export async function reconcileHours(trunkShowId: string, startDate: string, endDate: string): Promise<void> {
  const wanted = enumerateDates(startDate, endDate)
  const have = await listHours(trunkShowId)
  const wantedSet = new Set(wanted)
  const haveSet = new Set(have.map(h => h.show_date))
  // Add missing days at default hours.
  const toAdd = wanted.filter(d => !haveSet.has(d))
  if (toAdd.length > 0) {
    await supabase.from('trunk_show_hours').insert(
      toAdd.map(d => ({
        trunk_show_id: trunkShowId,
        show_date: d,
        open_time: DEFAULT_OPEN,
        close_time: DEFAULT_CLOSE,
      })),
    )
  }
  // Remove days that fell out of range.
  const toRemove = have.filter(h => !wantedSet.has(h.show_date)).map(h => h.id)
  if (toRemove.length > 0) {
    await supabase.from('trunk_show_hours').delete().in('id', toRemove)
  }
}

/* ── helpers ───────────────────────────────────────────── */

export function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  if (!startIso || !endIso) return out
  const s = new Date(startIso + 'T12:00:00')
  const e = new Date(endIso + 'T12:00:00')
  for (let d = new Date(s); d <= e && out.length < 30; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${dd}`)
  }
  return out
}

/** Effective status: stored value wins for cancelled; otherwise
 *  computed from today vs. start/end dates. Trunk shows transition
 *  scheduled → in_progress → completed automatically as time
 *  passes; a manual cancellation always overrides. */
export function effectiveStatus(s: TrunkShow, todayIso?: string): TrunkShowStatus {
  if (s.status === 'cancelled') return 'cancelled'
  const today = todayIso || (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()
  if (today < s.start_date) return 'scheduled'
  if (today > s.end_date) return 'completed'
  return 'in_progress'
}
