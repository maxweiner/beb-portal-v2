// Trunk Customer Bookings — appointment slots customers book via
// the trunk show's magic link (or a rep books manually). Differs
// from trade show booth appointments in that we capture the
// store salesperson's name for Phase 13 spiff tracking, plus a
// "purchased" flag that the rep flips after the meeting.

import { supabase } from '@/lib/supabase'

export type TrunkShowAppointmentStatus = 'available' | 'booked' | 'completed' | 'cancelled' | 'no_show'

export interface TrunkShowSlot {
  id: string
  trunk_show_id: string
  slot_start: string
  slot_end: string
  status: TrunkShowAppointmentStatus
  customer_first_name: string | null
  customer_last_name: string | null
  customer_email: string | null
  customer_phone: string | null
  store_salesperson_name: string | null
  purchased: boolean
  purchased_marked_by: string | null
  purchased_marked_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const COLS = `id, trunk_show_id, slot_start, slot_end, status,
  customer_first_name, customer_last_name, customer_email, customer_phone,
  store_salesperson_name, purchased, purchased_marked_by, purchased_marked_at,
  notes, created_at, updated_at`

export async function listSlots(trunkShowId: string): Promise<TrunkShowSlot[]> {
  const { data, error } = await supabase
    .from('trunk_show_appointment_slots').select(COLS)
    .eq('trunk_show_id', trunkShowId)
    .order('slot_start', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as TrunkShowSlot[]
}

export interface SlotDraft {
  slot_start: string
  slot_end: string
}

export async function createSlot(trunkShowId: string, draft: SlotDraft): Promise<TrunkShowSlot> {
  const { data, error } = await supabase
    .from('trunk_show_appointment_slots').insert({
      trunk_show_id: trunkShowId,
      slot_start: draft.slot_start,
      slot_end:   draft.slot_end,
      status: 'available',
    }).select(COLS).single()
  if (error) throw new Error(error.message)
  return data as TrunkShowSlot
}

export async function bulkCreateSlots(trunkShowId: string, slots: SlotDraft[]): Promise<number> {
  if (slots.length === 0) return 0
  const { error, count } = await supabase
    .from('trunk_show_appointment_slots').insert(
      slots.map(s => ({
        trunk_show_id: trunkShowId,
        slot_start: s.slot_start,
        slot_end:   s.slot_end,
        status: 'available',
      })),
      { count: 'exact' },
    )
  if (error) throw new Error(error.message)
  return count || 0
}

export interface SlotBookingDraft {
  customer_first_name: string
  customer_last_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  store_salesperson_name?: string | null
  notes?: string | null
}

export async function bookSlot(slotId: string, b: SlotBookingDraft): Promise<void> {
  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const { error } = await supabase.from('trunk_show_appointment_slots').update({
    status: 'booked',
    customer_first_name:    b.customer_first_name.trim(),
    customer_last_name:     norm(b.customer_last_name),
    customer_email:         norm(b.customer_email),
    customer_phone:         norm(b.customer_phone),
    store_salesperson_name: norm(b.store_salesperson_name),
    notes:                  norm(b.notes),
  }).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function setStatus(slotId: string, status: TrunkShowAppointmentStatus): Promise<void> {
  const { error } = await supabase
    .from('trunk_show_appointment_slots').update({ status }).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function markPurchased(slotId: string, byUserId: string | null, purchased: boolean): Promise<void> {
  const update: any = {
    purchased,
    purchased_marked_by: purchased ? byUserId : null,
    purchased_marked_at: purchased ? new Date().toISOString() : null,
  }
  const { error } = await supabase
    .from('trunk_show_appointment_slots').update(update).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function deleteSlot(slotId: string): Promise<void> {
  const { error } = await supabase
    .from('trunk_show_appointment_slots').delete().eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function generateBookingToken(trunkShowId: string): Promise<{ token: string; url: string }> {
  const token = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  const { error } = await supabase
    .from('trunk_show_booking_tokens').insert({ trunk_show_id: trunkShowId, token })
  if (error) throw new Error(error.message)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return { token, url: `${origin}/trunk-show-book/${token}` }
}
