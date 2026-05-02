// Spiffs — payouts to store salespeople for trunk-show
// appointments that resulted in a purchase. Auto-created when an
// appointment slot is flipped to purchased=true (via the
// /api/trunk-show-slots/[slotId]/purchase server route, which
// uses service role since RLS gates spiff writes to admins).

import { supabase } from '@/lib/supabase'

export interface Spiff {
  id: string
  trunk_show_id: string
  appointment_slot_id: string
  store_salesperson_name: string
  amount: number
  paid_at: string | null
  paid_by: string | null
  notes: string | null
  created_at: string
}

export interface SpiffConfig {
  id: string
  default_amount_per_appointment_purchase: number
  is_active: boolean
  updated_at: string
}

const COLS = `id, trunk_show_id, appointment_slot_id, store_salesperson_name,
  amount, paid_at, paid_by, notes, created_at`

export async function listSpiffsForShow(trunkShowId: string): Promise<Spiff[]> {
  const { data, error } = await supabase
    .from('trunk_show_spiffs').select(COLS)
    .eq('trunk_show_id', trunkShowId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({ ...r, amount: Number(r.amount) })) as Spiff[]
}

export async function listAllSpiffs(): Promise<Spiff[]> {
  const { data, error } = await supabase
    .from('trunk_show_spiffs').select(COLS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({ ...r, amount: Number(r.amount) })) as Spiff[]
}

export async function markSpiffPaid(id: string, paidByUserId: string | null, isPaid: boolean): Promise<void> {
  const { error } = await supabase.from('trunk_show_spiffs').update({
    paid_at: isPaid ? new Date().toISOString() : null,
    paid_by: isPaid ? paidByUserId : null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getSpiffConfig(): Promise<SpiffConfig | null> {
  const { data, error } = await supabase
    .from('spiff_config')
    .select('id, default_amount_per_appointment_purchase, is_active, updated_at')
    .limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { ...data, default_amount_per_appointment_purchase: Number(data.default_amount_per_appointment_purchase) } as SpiffConfig : null
}

export async function setSpiffAmount(id: string, amount: number, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('spiff_config').update({
    default_amount_per_appointment_purchase: amount,
    is_active: isActive,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}
