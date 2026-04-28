export type Role = 'buyer' | 'admin' | 'superadmin' | 'pending'

export interface User {
  id: string
  auth_id: string
  name: string
  email: string
  role: Role
  active: boolean
  notify: boolean
  notify_sms?: boolean
  notify_beb?: boolean
  notify_liberty?: boolean
  phone: string
  is_buyer: boolean
  photo_url?: string
  alternate_emails?: string[]
  created_at: string
  updated_at: string
  liberty_access?: boolean
  sort_order?: number
  /** Last brand the user actively selected — synced across devices.
   *  Null = never set; fall back to localStorage / 'beb'. */
  last_active_brand?: 'beb' | 'liberty' | null
}

export type EventNoteCategory = 'worked' | 'didnt_work' | 'do_differently'

export interface EventNote {
  id: string
  event_id: string
  store_id: string
  user_id: string
  user_name: string
  category: EventNoteCategory
  content: string
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
  calendar_feed_url?: string
  calendar_offset_hours?: number
  store_image_url?: string
  active?: boolean
  lat?: number
  lng?: number
  slug?: string | null
  color_primary?: string | null
  color_secondary?: string | null
  timezone?: string | null
  /** Shipping hold-time in days. NULL = no shipping flow at all (either "No Hold" or "Hold at Home Office"). */
  hold_time_days?: number | null
  /** When true with hold_time_days NULL, label is "Hold at Home Office" (still no flow). */
  hold_at_home_office?: boolean
  default_jewelry_box_count?: number
  default_silver_box_count?: number
  shipping_recipients?: string[]
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
  src_store: number
  src_text: number
  src_newspaper: number
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
  spend_vdp?: number
  spend_newspaper?: number
  spend_postcard?: number
  spend_spiffs?: number
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

export type Theme = 'original' | 'salesforce' | 'apple' | 'liberty' | 'liberty-gold' | 'liberty-slate' | 'liberty-patriot'
export type Brand = 'beb' | 'liberty'

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
  connectionError?: boolean
  brand: Brand
  /** True while a brand switch is in flight (data refetch + min spinner duration). */
  isSwitching: boolean
  /** The brand we're switching TO during a switch — for the overlay label. */
  pendingBrand: Brand | null
}

export interface Appointment {
  start: Date
  end: Date
  title: string
  description: string
  location: string
}

export type LeadSource = 'vdp' | 'small' | 'wom' | 'repeat' | 'social' | 'unknown'

export interface BuyerVacation {
  id: string
  user_id: string
  start_date: string
  end_date: string
  note?: string
  created_at?: string
}
