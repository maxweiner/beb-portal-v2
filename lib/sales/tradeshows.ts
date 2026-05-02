// Client-side helpers for the Trade Shows module.
// RLS gates access — see Phase 1 migration. Service-role writes
// aren't needed for v1; the supabase client is used directly.

import { supabase } from '@/lib/supabase'
import type { TradeShow } from '@/types'

const COLS = `id, name, venue_name, venue_city, venue_state, venue_address,
              start_date, end_date, booth_number, show_website_url,
              organizing_body, notes, created_at, updated_at, deleted_at`

export async function listTradeShows(): Promise<TradeShow[]> {
  const { data, error } = await supabase
    .from('trade_shows')
    .select(COLS)
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as TradeShow[]
}

export async function getTradeShow(id: string): Promise<TradeShow | null> {
  const { data, error } = await supabase
    .from('trade_shows')
    .select(COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as TradeShow) || null
}

export interface TradeShowDraft {
  name: string
  venue_name?: string | null
  venue_city?: string | null
  venue_state?: string | null
  venue_address?: string | null
  start_date: string
  end_date: string
  booth_number?: string | null
  show_website_url?: string | null
  organizing_body?: string | null
  notes?: string | null
}

export async function createTradeShow(draft: TradeShowDraft): Promise<TradeShow> {
  const { data, error } = await supabase
    .from('trade_shows')
    .insert(draft)
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return data as TradeShow
}

export async function updateTradeShow(id: string, patch: Partial<TradeShowDraft>): Promise<void> {
  const { error } = await supabase
    .from('trade_shows')
    .update(patch)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function softDeleteTradeShow(id: string): Promise<void> {
  const { error } = await supabase
    .from('trade_shows')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
