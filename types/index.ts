export type Role = 'buyer' | 'admin' | 'superadmin' | 'pending' | 'marketing' | 'accounting'

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
  /** Expenses module additions (PR1 schema). */
  home_address?: string | null
  signature_url?: string | null
  magic_inbox_email?: string | null
  /** Partner = approves financials + gets the partner default rate.
   *  Distinct from role=superadmin; only Max/Joe/Rich have this. */
  is_partner?: boolean
  /** Marketing module access. Per-user gate granted independently of role.
   *  External Collected Concepts users get this without other portal access. */
  marketing_access?: boolean
}

// ── Expenses & Invoicing module ──────────────────────────────
export type ExpenseReportStatus = 'active' | 'submitted_pending_review' | 'approved' | 'paid'

export type ExpenseCategory =
  | 'flight'
  | 'rental_car'
  | 'rideshare'
  | 'hotel'
  | 'meals'
  | 'shipping_supplies'
  | 'jewelry_lots_cash'
  | 'mileage'
  | 'custom'

export type ExpenseSource =
  | 'manual'
  | 'travel_module'
  | 'magic_inbox'
  | 'ocr'
  | 'mileage_calc'

export interface ExpenseReport {
  id: string
  event_id: string
  user_id: string
  status: ExpenseReportStatus
  submitted_at: string | null
  approved_at: string | null
  approved_by: string | null
  paid_at: string | null
  paid_by: string | null
  accountant_email_sent_at: string | null
  total_expenses: number
  total_compensation: number
  /** Per-trip compensation rate (Option A). DB trigger sums into
   *  total_compensation + grand_total whenever this changes. */
  comp_rate: number
  /** Partner-granted bonus pay. Adds to grand_total. Buyer cannot edit. */
  bonus_amount: number
  bonus_note: string | null
  grand_total: number
  pdf_url: string | null
  template_id: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseReportTemplate {
  id: string
  name: string
  description: string | null
  estimated_days: number | null
  expected_categories: ExpenseCategory[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  expense_report_id: string
  category: ExpenseCategory
  custom_category_label: string | null
  vendor: string | null
  amount: number
  expense_date: string
  notes: string | null
  receipt_url: string | null
  source: ExpenseSource
  ocr_extracted_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
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
  /** Mobile Enter Day Data: default visibility of the Form # column.
   *  Per-user override persisted in localStorage at
   *  beb-form-no-{user_id}-{store_id}. */
  default_form_number_visible?: boolean
}

export interface EventDay {
  id: string
  event_id: string
  day_number: number
  customers: number
  purchases: number
  dollars10: number
  dollars5: number
  /** Store purchases at 0% commission. Reported separately; NEVER summed into dollars10 + dollars5 or commission % math. */
  dollars0: number
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
  /** Day-3 only. Store commission check the buyer hands the store at end-of-event.
   *  Record-only — never folded into purchases / dollars10 / dollars5 / dollars0
   *  / customers totals. Surfaces on the Event Recap PDF. */
  store_commission_check_number?: string | null
  store_commission_check_amount?: number | null
}

export interface Event {
  id: string
  store_id: string
  store_name: string
  start_date: string
  workers?: { id: string; name: string; deleted?: boolean }[]
  spend_vdp?: number
  spend_newspaper?: number
  spend_postcard?: number
  spend_spiffs?: number
  days: EventDay[]
  calendar_feed_url?: string
  created_by?: string
  /** Required staffing for the event. NULL = not specified (no
   *  hazard). New events enforce non-null at the form layer. */
  buyers_needed?: number | null
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

// ── Marketing module ─────────────────────────────────────────
export type MarketingFlowType = 'vdp' | 'postcard' | 'newspaper'
export type MarketingStatus = 'setup' | 'planning' | 'proofing' | 'payment' | 'done'

export interface MarketingCampaign {
  id: string
  event_id: string
  flow_type: MarketingFlowType
  status: MarketingStatus
  /** Free-text finer-grained state within phase. */
  sub_status: string | null
  marketing_budget: number | null
  budget_set_by: string | null
  budget_set_at: string | null
  team_notified_at: string | null
  mail_by_date: string | null
  payment_method_label: string | null
  payment_method_note: string | null
  payment_authorized_by: string | null
  payment_authorized_at: string | null
  paid_at: string | null
  paid_by: string | null
  accountant_receipt_sent_at: string | null
  created_at: string
  updated_at: string
}

export interface BuyerVacation {
  id: string
  user_id: string
  start_date: string
  end_date: string
  note?: string
  created_at?: string
}
