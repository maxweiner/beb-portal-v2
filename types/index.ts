export type Role = 'buyer' | 'admin' | 'superadmin' | 'pending' | 'non_buyer_admin'

export interface User {
  id: string
  auth_id: string
  name: string
  email: string
  role: Role
  active: boolean
  notify: boolean
  phone: string
  photo_url?: string
  alternate_emails?: string[]
  created_at: string
  updated_at: string
}

export interface Store {
  id: string
  name: string
  city: string
  state: string
  address?: string
  zip?: string
  website?: string
  notes?: string
  owner_name?: string
  owner_phone?: string
  owner_email?: string
  qr_code_url?: string
  calendar_feed_url?: string
  store_image_url?: string
  active?: boolean
}

export interface EventDay {
  id: string
  event_id: string
  day_number: number
  customers: number
  purchases: number
  dollars10: number
  dollars5: number
  src_vdp: number
  src_postcard: number
  src_social: number
  src_wordofmouth: number
  src_other: number
  src_repeat: number
  entered_by?: string
  entered_by_name?: string
  entered_at?: string
}

export interface Event {
  id: string
  store_id: string
  store_name: string
  start_date: string
  workers?: { id: string; name: string }[]
  days: EventDay[]
  calendar_feed_url?: string
  created_by?: string
}

export interface Shipment {
  id: string
  ship_date: string
  carrier: string
  tracking: string
  description?: string
  from_store?: string
  created_by?: string
}

export type Theme = 'original' | 'salesforce' | 'apple'

export interface AppState {
  user: User | null
  users: User[]
  stores: Store[]
  events: Event[]
  shipments: Shipment[]
  permissions: Record<string, Record<string, boolean>> | null
  theme: Theme
  year: string
  loading: boolean
}

export interface Appointment {
  start: Date
  end: Date
  title: string
  description: string
  location: string
}

export type LeadSource = 'vdp' | 'small' | 'wom' | 'repeat' | 'social' | 'unknown'
