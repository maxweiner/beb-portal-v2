// Trade show staff assignments. Each (trade_show_id, user_id)
// pair has an assigned_dates date[] — the specific dates within
// the show that user is staffing. The unique constraint enforces
// one row per (show, user); to add or remove dates we update the
// existing row rather than insert a duplicate.

import { supabase } from '@/lib/supabase'

export interface TradeShowStaffer {
  id: string
  trade_show_id: string
  user_id: string
  assigned_dates: string[]
  created_at: string
}

export async function listStaff(tradeShowId: string): Promise<TradeShowStaffer[]> {
  const { data, error } = await supabase
    .from('trade_show_staff')
    .select('id, trade_show_id, user_id, assigned_dates, created_at')
    .eq('trade_show_id', tradeShowId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({
    ...r,
    assigned_dates: (r.assigned_dates as string[] | null) || [],
  })) as TradeShowStaffer[]
}

export async function addStaff(tradeShowId: string, userId: string, dates: string[]): Promise<TradeShowStaffer> {
  const { data, error } = await supabase
    .from('trade_show_staff')
    .insert({
      trade_show_id: tradeShowId,
      user_id: userId,
      assigned_dates: dates,
    })
    .select('id, trade_show_id, user_id, assigned_dates, created_at')
    .single()
  if (error) throw new Error(error.message)
  return { ...data, assigned_dates: (data.assigned_dates as string[]) || [] } as TradeShowStaffer
}

export async function setAssignedDates(rowId: string, dates: string[]): Promise<void> {
  const { error } = await supabase
    .from('trade_show_staff')
    .update({ assigned_dates: dates })
    .eq('id', rowId)
  if (error) throw new Error(error.message)
}

export async function removeStaff(rowId: string): Promise<void> {
  const { error } = await supabase
    .from('trade_show_staff').delete().eq('id', rowId)
  if (error) throw new Error(error.message)
}

/** Inclusive list of YYYY-MM-DD strings between start and end. */
export function enumerateShowDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  if (!startIso || !endIso) return out
  const s = new Date(startIso + 'T12:00:00')
  const e = new Date(endIso + 'T12:00:00')
  // Cap at 30 days defensively in case of bad input — trade shows
  // are typically 1–5 days. Prevents runaway loops.
  for (let d = new Date(s); d <= e && out.length < 30; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    out.push(`${yyyy}-${mm}-${dd}`)
  }
  return out
}

export function fmtDayHeader(iso: string): { weekday: string; day: number; month: string } {
  const d = new Date(iso + 'T12:00:00')
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day:     d.getDate(),
    month:   d.toLocaleDateString('en-US', { month: 'short' }),
  }
}
