// Trunk Customer Bookings — slots are pure time blocks; each
// customer booking is a row in trunk_show_slot_bookings, scoped
// to (slot, booking_token). With N tagged-rep links per show you
// get N effective lanes per slot — each rep can fill their own
// without colliding with the others.
//
// Spiffs reference slot_booking_id, not slot_id.

import { supabase } from '@/lib/supabase'

export type TrunkShowBookingStatus = 'booked' | 'cancelled' | 'completed' | 'no_show'

export interface TrunkShowSlotBooking {
  id: string
  slot_id: string
  booking_token_id: string | null
  customer_first_name: string
  customer_last_name: string | null
  customer_email: string | null
  customer_phone: string | null
  store_salesperson_name: string | null
  notes: string | null
  status: TrunkShowBookingStatus
  purchased: boolean
  purchased_marked_by: string | null
  purchased_marked_at: string | null
  created_at: string
  updated_at: string
}

export interface TrunkShowSlot {
  id: string
  trunk_show_id: string
  slot_start: string
  slot_end: string
  created_at: string
  updated_at: string
  bookings: TrunkShowSlotBooking[]
}

const SLOT_COLS = `id, trunk_show_id, slot_start, slot_end, created_at, updated_at`
const BOOKING_COLS = `id, slot_id, booking_token_id, customer_first_name, customer_last_name,
  customer_email, customer_phone, store_salesperson_name, notes, status,
  purchased, purchased_marked_by, purchased_marked_at, created_at, updated_at`

export async function listSlots(trunkShowId: string): Promise<TrunkShowSlot[]> {
  const { data: slotsData, error: slotsErr } = await supabase
    .from('trunk_show_appointment_slots').select(SLOT_COLS)
    .eq('trunk_show_id', trunkShowId)
    .order('slot_start', { ascending: true })
  if (slotsErr) throw new Error(slotsErr.message)
  const slots = (slotsData || []) as Omit<TrunkShowSlot, 'bookings'>[]
  if (slots.length === 0) return []

  const { data: bookings, error } = await supabase
    .from('trunk_show_slot_bookings').select(BOOKING_COLS)
    .in('slot_id', slots.map(s => s.id))
  if (error) throw new Error(error.message)

  const bookingsBySlot: Record<string, TrunkShowSlotBooking[]> = {}
  for (const b of (bookings || []) as TrunkShowSlotBooking[]) {
    ;(bookingsBySlot[b.slot_id] ||= []).push(b)
  }
  return slots.map(s => ({ ...s, bookings: bookingsBySlot[s.id] || [] }))
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
    }).select(SLOT_COLS).single()
  if (error) throw new Error(error.message)
  return { ...(data as any), bookings: [] }
}

export async function bulkCreateSlots(trunkShowId: string, slots: SlotDraft[]): Promise<number> {
  if (slots.length === 0) return 0
  const { error, count } = await supabase
    .from('trunk_show_appointment_slots').insert(
      slots.map(s => ({
        trunk_show_id: trunkShowId,
        slot_start: s.slot_start,
        slot_end:   s.slot_end,
      })),
      { count: 'exact' },
    )
  if (error) throw new Error(error.message)
  return count || 0
}

export interface SlotBookingDraft {
  slot_id: string
  booking_token_id?: string | null
  customer_first_name: string
  customer_last_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  store_salesperson_name?: string | null
  notes?: string | null
}

/** Insert a customer booking on a slot (one per slot+token). */
export async function bookSlot(b: SlotBookingDraft): Promise<TrunkShowSlotBooking> {
  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const { data, error } = await supabase.from('trunk_show_slot_bookings').insert({
    slot_id:                b.slot_id,
    booking_token_id:       b.booking_token_id || null,
    customer_first_name:    b.customer_first_name.trim(),
    customer_last_name:     norm(b.customer_last_name),
    customer_email:         norm(b.customer_email),
    customer_phone:         norm(b.customer_phone),
    store_salesperson_name: norm(b.store_salesperson_name),
    notes:                  norm(b.notes),
  }).select(BOOKING_COLS).single()
  if (error) throw new Error(error.message)
  return data as TrunkShowSlotBooking
}

export async function setBookingStatus(bookingId: string, status: TrunkShowBookingStatus): Promise<void> {
  const { error } = await supabase
    .from('trunk_show_slot_bookings').update({ status }).eq('id', bookingId)
  if (error) throw new Error(error.message)
}

export async function deleteBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('trunk_show_slot_bookings').delete().eq('id', bookingId)
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
