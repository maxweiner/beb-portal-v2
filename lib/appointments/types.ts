// Types for the appointment booking system. Mirrors the Supabase schema in
// supabase-migration-store-booking-config.sql + supabase-migration-appointments.sql.

export type AppointmentStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show'

export interface BookingConfig {
  store_id: string
  slot_interval_minutes: number
  max_concurrent_slots: number
  day1_start: string | null  // 'HH:MM' or 'HH:MM:SS'
  day1_end: string | null
  day2_start: string | null
  day2_end: string | null
  day3_start: string | null
  day3_end: string | null
  items_options: string[]
  hear_about_options: string[]
}

export interface EventBookingOverride {
  event_id: string
  max_concurrent_slots: number | null
  day1_start: string | null
  day1_end: string | null
  day2_start: string | null
  day2_end: string | null
  day3_start: string | null
  day3_end: string | null
}

export interface BookingStore {
  id: string
  name: string
  slug: string
  store_image_url: string | null
  color_primary: string | null
  color_secondary: string | null
  owner_phone: string | null
  owner_email: string | null
}

export interface BookingEvent {
  id: string
  store_id: string
  start_date: string  // 'YYYY-MM-DD'
  brand: 'beb' | 'liberty'
  days: { id: string; day_number: number }[]
}

export interface AppointmentLite {
  appointment_date: string  // 'YYYY-MM-DD'
  appointment_time: string  // 'HH:MM' or 'HH:MM:SS'
  status: AppointmentStatus
}

export interface SlotBlockLite {
  block_date: string  // 'YYYY-MM-DD'
  block_time: string  // 'HH:MM' or 'HH:MM:SS'
}

export interface Slot {
  time: string       // 'HH:MM' (always 5-char form)
  capacity: number
  booked: number
  blocked: boolean
  available: number
  isPast: boolean
}

// Aggregated server-side payload consumed by the public /book/[slug] page.
export interface BookingPayload {
  store: BookingStore
  config: BookingConfig
  events: BookingEvent[]
  override?: EventBookingOverride | null
  bookings: AppointmentLite[]
  blocks: SlotBlockLite[]
}
