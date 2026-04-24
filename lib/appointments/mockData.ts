// Demo data for the public booking page until we wire it to Supabase.
// Keyed by store slug. The /book/[slug] route reads from here today and will
// switch to real DB queries in a follow-up.

import type {
  BookingConfig,
  BookingEvent,
  BookingStore,
  AppointmentLite,
  SlotBlockLite,
  EventBookingOverride,
} from './types'

export interface MockBookingPayload {
  store: BookingStore
  config: BookingConfig
  events: BookingEvent[]
  override?: EventBookingOverride | null
  bookings: AppointmentLite[]
  blocks: SlotBlockLite[]
}

function isoDateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DEMO_SLUG = 'demo-jewelers'

const demoPayload: MockBookingPayload = {
  store: {
    id: 'demo-store-id',
    name: 'Demo Jewelers',
    slug: DEMO_SLUG,
    store_image_url: '/beb-logo.png',
    color_primary: '#1D6B44',
    color_secondary: '#F5F0E8',
    owner_phone: '(555) 123-4567',
    owner_email: 'hello@demojewelers.example',
  },
  config: {
    store_id: 'demo-store-id',
    slot_interval_minutes: 20,
    max_concurrent_slots: 3,
    day1_start: '10:00',
    day1_end: '17:00',
    day2_start: '10:00',
    day2_end: '17:00',
    day3_start: '10:00',
    day3_end: '16:00',
    items_options: ['Gold', 'Diamonds', 'Watches', 'Coins', 'Jewelry', "I'm Not Sure"],
    hear_about_options: [
      'Large Postcard',
      'Small Postcard',
      'Newspaper',
      'Email',
      'Text',
      'The Store Told Me',
    ],
  },
  events: [
    {
      id: 'demo-event-id',
      store_id: 'demo-store-id',
      start_date: isoDateOffset(2),
      brand: 'beb',
      days: [
        { id: 'demo-day-1', day_number: 1 },
        { id: 'demo-day-2', day_number: 2 },
        { id: 'demo-day-3', day_number: 3 },
      ],
    },
  ],
  override: null,
  // A few pre-existing bookings on day 2 to show partially-full slots
  bookings: [
    { appointment_date: isoDateOffset(3), appointment_time: '10:20', status: 'confirmed' },
    { appointment_date: isoDateOffset(3), appointment_time: '10:20', status: 'confirmed' },
    { appointment_date: isoDateOffset(3), appointment_time: '11:00', status: 'confirmed' },
    { appointment_date: isoDateOffset(3), appointment_time: '14:40', status: 'confirmed' },
    { appointment_date: isoDateOffset(3), appointment_time: '14:40', status: 'confirmed' },
    { appointment_date: isoDateOffset(3), appointment_time: '14:40', status: 'confirmed' },
  ],
  // One blocked slot on day 1 for demo
  blocks: [
    { block_date: isoDateOffset(2), block_time: '12:00' },
  ],
}

export function getMockBookingPayload(slug: string): MockBookingPayload | null {
  if (slug === DEMO_SLUG) return demoPayload
  return null
}
