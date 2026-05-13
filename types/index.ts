export type Role = 'buyer' | 'admin' | 'superadmin' | 'pending' | 'marketing' | 'accounting' | 'sales_rep' | 'trunk_admin'

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
  /** Inventory (wholesale) module access. Same per-user gate pattern as
   *  marketing_access — superadmin toggles it in Admin Panel → Inventory
   *  Access regardless of the user's role. */
  inventory_access?: boolean
  /** NavPage IDs the user has pinned to the top of their sidebar. Order
   *  is preserved (display order in the ★ Pinned section). Empty = no pins. */
  pinned_pages?: string[]
  /** Multi-role: every role assigned to this user via the user_roles
   *  join table. Always includes the primary `role` field. Used by
   *  useRoleModules() to UNION module access across roles. */
  roles?: string[]
  /** Per-rep trunk-show Google calendar (PR A schema; PR B populates).
   *  We own the calendar; rep subscribes via the public URL. */
  trunk_show_calendar_id?: string | null
  trunk_show_calendar_subscribe_url?: string | null
  /** Cross-device JSONB blob for misc UI prefs that don't deserve their own
   *  column. First consumer: Buying Events Hub view (which launchers are
   *  hidden + which view tab the user last picked). DB default '{}'. */
  preferences?: Record<string, any>
}

// ── Expenses & Invoicing module ──────────────────────────────
export type ExpenseReportStatus =
  | 'active'
  | 'submitted_pending_review'
  | 'approved'
  | 'paid'
  | 'no_expenses'

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
  /** True when the accountant paid this on the company credit card.
   *  Stays visible on the report (so event-cost reporting includes
   *  it) but is excluded from total_expenses (reimbursable). */
  paid_by_credit_card: boolean
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
  /** Owner's personal mobile phone — manually entered, distinct from
   *  `store_phone` (the business's public-facing line auto-filled
   *  from Google Places). Was named `owner_mobile_phone` historically;
   *  renamed via supabase-migration-rename-owner-phone.sql. */
  owner_mobile_phone?: string
  owner_email?: string
  /** Store's main public-facing phone line, auto-filled from Google
   *  Places on store creation + address update. Used on marketing
   *  materials. Stored raw 10-digit; UI formats with dashes. */
  store_phone?: string
  /** BEB scheduling phone — the number printed on this store's
   *  marketing materials (postcards, ads) that routes calls to the
   *  BEB scheduling line. Surfaces under the store name on the
   *  marketing campaign detail page so the marketer can read it off
   *  without context-switching. Stored raw 10-digit; UI formats with
   *  dashes. (Previously named `quo_phone_number` — renamed via
   *  supabase-migration-rename-quo-to-beb-scheduling.sql.) */
  beb_scheduling_phone?: string
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
  /** Save-the-Date / lifecycle status. Defaults to 'scheduled' for
   *  every event before this column existed. */
  status?: EventStatus
  /** Per-event spiff rate (PR 4 schema). NULL falls back to $10. */
  spiff_amount_per_show?: number | null
  /** Set when ops marks the buyers + stakeholders as briefed for
   *  this event. NULL = not yet briefed. */
  staff_briefed_at?: string | null
  staff_briefed_by_user_id?: string | null
  /** Manual "force green" overrides for the Pre-Event readiness
   *  chips that don't have a hard data prerequisite. Buyers +
   *  Booking System are intentionally not overrideable. */
  travel_override_at?: string | null
  travel_override_by_user_id?: string | null
  marketing_override_at?: string | null
  marketing_override_by_user_id?: string | null
  assets_override_at?: string | null
  assets_override_by_user_id?: string | null
  /** Set when an admin/partner marks the event as not getting a
   *  marketing campaign. Affects only the marketing module
   *  (New Campaign modal hides ignored events by default).
   *  See supabase-migration-events-marketing-ignored.sql. */
  marketing_ignored_at?: string | null
}

// ── Trunk Communications + Pre-Event Checklist ───────────────
export type CommunicationAssignedRole = 'admin' | 'rep' | 'both'
export type CommunicationLinkedAction =
  | 'send_communication'
  | 'marketing_postcard'
  | 'marketing_proof'
  | 'none'
export type CommunicationDeliveryStatus = 'sent' | 'delivered' | 'bounced' | 'failed'

export interface CommunicationTemplate {
  id: string
  name: string
  subject_line: string
  body: string
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface CommunicationSendSchedule {
  id: string
  template_id: string
  days_before_event_start: number
  send_window_days: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CommunicationSend {
  id: string
  trunk_show_id: string
  template_id: string | null
  schedule_id: string | null
  sent_by_user_id: string | null
  sent_at: string
  from_email: string
  from_name: string
  to_email: string
  to_name: string | null
  subject_line_rendered: string
  body_rendered: string
  pdf_url: string | null
  resend_message_id: string | null
  delivery_status: CommunicationDeliveryStatus
  delivery_status_updated_at: string | null
  created_at: string
}

export interface TrunkShowChecklistMasterItem {
  id: string
  title: string
  description: string | null
  days_before_event_start: number
  assigned_to_role: CommunicationAssignedRole
  linked_action_type: CommunicationLinkedAction
  linked_template_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TrunkShowChecklistItem {
  id: string
  trunk_show_id: string
  master_item_id: string | null
  title: string
  description: string | null
  due_date: string  // YYYY-MM-DD
  assigned_to_role: CommunicationAssignedRole
  linked_action_type: CommunicationLinkedAction
  linked_template_id: string | null
  linked_send_id: string | null
  is_completed: boolean
  completed_at: string | null
  completed_by_user_id: string | null
  previous_completion_log: { action: 'check' | 'uncheck'; user_id: string | null; timestamp: string }[]
  created_at: string
  updated_at: string
}

// ── Event waitlist ───────────────────────────────────────────
export type EventWaitlistStatus = 'waiting' | 'called' | 'served' | 'no_show'
export type EventWaitlistNotifyPref = 'sms' | 'wait'

/** Per-event walk-in waitlist entry. Self-added via public
 *  signup link or staff-added via internal UI. Auto-clears at
 *  expires_at (today's 7pm in the store's local timezone). */
export interface EventWaitlistEntry {
  id: string
  event_id: string
  name: string
  phone: string
  item_count: number
  how_heard: string | null
  added_by_user_id: string | null
  notify_pref: EventWaitlistNotifyPref
  notified_at: string | null
  status: EventWaitlistStatus
  called_at: string | null
  called_by_user_id: string | null
  served_at: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

/** Per-event physical asset order (counter card / countertop
 *  display / in-store postcard / etc.). One row per discrete
 *  order; lifecycle timestamps (ordered → shipped → delivered)
 *  drive the Pre-Event readiness chip. */
export interface EventPromotionalAssetOrder {
  id: string
  event_id: string
  asset_type: string
  description: string | null
  quantity: number | null
  vendor: string | null
  ordered_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  tracking_number: string | null
  notes: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
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
  /** Partner jewelry stores we run trunk shows at. Loaded
   *  alongside `stores` so trunk-show flows can resolve names
   *  + assigned reps from one place. */
  trunkShowStores: TrunkShowStore[]
  /** Active events only — `status !== 'cancelled' AND cancelled_at IS NULL`.
   *  This is the safe default for "what's happening now" lists (day entry,
   *  dashboards, marketing planning, etc). Most consumers want this. */
  events: Event[]
  /** Every event for the current brand, INCLUDING cancelled ones. Reach for
   *  this in admin / reports / financials / event-detail views where you
   *  need to surface or audit cancelled events. Both arrays are derived
   *  from the same underlying state — `setEvents` updates both. */
  allEvents: Event[]
  shipments: Shipment[]
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
  /** Optional campaign-wide note from the marketing team. Surfaces
   *  on the Proofing section; broader than per-version upload notes. */
  marketing_team_notes: string | null
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

/* ── Sales-side types ──────────────────────────────────────── */

export interface TradeShow {
  id: string
  name: string
  venue_name: string | null
  venue_city: string | null
  venue_state: string | null
  venue_address: string | null
  start_date: string
  end_date: string
  booth_number: string | null
  show_website_url: string | null
  organizing_body: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type TrunkShowStatus = 'reserved' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

/** Buying-event lifecycle. 'scheduled' is the default and is what
 *  every existing event was implicitly. 'reserved' = Save the Date
 *  (planning stage, not yet confirmed). 'cancelled' = decided not to
 *  run, kept visible with strikethrough. Hard-deletion is also
 *  available via the Delete action. */
export type EventStatus = 'reserved' | 'scheduled' | 'completed' | 'cancelled'

export interface TrunkShow {
  id: string
  /** FK to trunk_show_stores. Each trunk show happens at one of
   *  our partner jewelers tracked in that table. */
  store_id: string
  start_date: string
  end_date: string
  /** Nullable since import-only rows arrive without a known rep. */
  assigned_rep_id: string | null
  status: TrunkShowStatus
  notes: string | null
  /** VIP Showing flag from the marketing tracker. */
  vip_showing: boolean
  /** Marketing milestone dates — NULL = not done. */
  confirmation_letter_sent_at: string | null
  postcards_email_sent_at: string | null
  postcards_ordered_at: string | null
  proofed_at: string | null
  final_files_sent_at: string | null
  post_event_questionnaire_sent_at: string | null
  /** Per-milestone "who marked it done" — NULL for legacy rows. */
  confirmation_letter_sent_by: string | null
  postcards_email_sent_by: string | null
  postcards_ordered_by: string | null
  proofed_by: string | null
  final_files_sent_by: string | null
  post_event_questionnaire_sent_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Partner jewelry stores we run trunk shows at. Imported from
 *  the legacy spreadsheet; each row is the canonical client. */
export interface TrunkShowStore {
  id: string
  name: string
  trunk_rep_user_id: string | null
  ts_reps: string | null
  comments: string | null
  address_1: string | null
  address_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  store_phone: string | null
  contact_1: string | null
  contact_2: string | null
  contact_3: string | null
  email_1: string | null
  email_2: string | null
  url: string | null
  trunk_shows: boolean | null
  /** Dormant flag. When false the store is hidden from default
   *  list views; toggle "Show inactive" to manage it. */
  active: boolean
  /** Single canonical recipient for trunk-show communications.
   *  Backfilled from email_1 + contact_1; admin can override
   *  without touching the legacy email_N + contact_N columns. */
  primary_contact_email: string | null
  primary_contact_name: string | null
  /** Ordered list of contacts. Replaces legacy contact_1..3 +
   *  email_1..2 columns; the old columns stay in the schema for
   *  backwards compatibility but the UI reads/writes this array. */
  contacts: TrunkShowStoreContact[]
}

export interface TrunkShowStoreContact {
  name: string
  email: string | null
  send_documents: boolean
}

export interface TrunkShowHours {
  id: string
  trunk_show_id: string
  show_date: string
  open_time: string
  close_time: string
  created_at: string
}

export type LeadInterestLevel = 'hot' | 'warm' | 'cold'
export type LeadStatus = 'new' | 'contacted' | 'converted' | 'dead'
export type LeadKind = 'trade_show' | 'buying_event' | 'trunk_show'
export type LeadParking = 'own_lot' | 'shared_lot' | 'street' | 'none'
export type LeadSqFootage = 'small' | 'medium' | 'large'

export interface Lead {
  id: string
  lead_kind: LeadKind
  first_name: string
  last_name: string
  company_name: string | null
  title: string | null
  email: string | null
  phone: string | null
  store_phone: string | null
  cell_phone: string | null
  referral_source: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  website: string | null
  assigned_rep_id: string | null
  captured_at_trade_show_id: string | null
  captured_by_user_id: string | null
  interest_level: LeadInterestLevel | null
  interest_description: string | null
  follow_up_date: string | null
  status: LeadStatus
  // Buying-event captured profile
  best_time_of_year: string | null
  freestanding: boolean | null
  parking: LeadParking | null
  year_established: number | null
  sq_footage: LeadSqFootage | null
  currently_buys: boolean | null
  // Trunk-show captured profile
  locking_cases: boolean | null
  rated_safe: boolean | null
  sales_staff_count: number | null
  years_in_business: number | null
  sells_estate_jewelry: boolean | null
  distance_to_airport_miles: number | null
  // Conversion targets
  converted_to_store_id: string | null  // legacy column kept for back-compat
  converted_store_id: string | null
  converted_trunk_show_store_id: string | null
  converted_event_id: string | null
  converted_trunk_show_id: string | null
  converted_at: string | null
  notes: string | null
  business_card_image_url: string | null
  ocr_extracted_data: any
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ───────────────────────────────────────────────────────────────
// Event share tokens — public per-event store-owner dashboard at
// /e/[token]. Schema in supabase-migration-event-share-tokens.sql.
// ───────────────────────────────────────────────────────────────

/** One row per share-URL minted for an event. Rotation creates a new
 *  row and revokes the previous one (revoked_at IS NOT NULL). The
 *  partial unique index in the migration enforces "one active token
 *  per event." */

/** Per-store public-dashboard share token. Replaces per-event tokens
 *  — store owners get one durable URL per store. Schema in
 *  supabase-migration-store-share-tokens.sql. */
export interface StoreShareToken {
  id: string
  store_id: string
  token: string
  created_by: string | null
  created_by_email: string | null
  revoked_at: string | null
  revoked_reason: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  view_count: number
  last_sent_at: string | null
  last_sent_to: string | null
  created_at: string
  updated_at: string
}

/** @deprecated Per-event share tokens are replaced by StoreShareToken
 *  as of 2026-05-12. Existing rows kept for audit but the migration
 *  marks them revoked. */
export interface EventShareToken {
  id: string
  event_id: string
  token: string
  created_by: string | null
  created_by_email: string | null
  revoked_at: string | null
  revoked_reason: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  view_count: number
  last_sent_at: string | null
  last_sent_to: string | null
  created_at: string
  updated_at: string
}

// ───────────────────────────────────────────────────────────────
// W-9 Requests — Diane's "Send W-9" flow. Schema at
// supabase-migration-w9-requests.sql.
// ───────────────────────────────────────────────────────────────

export type W9RequestStatus =
  | 'pending'   // sent but not yet opened by recipient
  | 'opened'    // recipient loaded the form at least once
  | 'completed' // signed + PDF generated + emailed to accountant
  | 'expired'   // 30-day window lapsed without completion
  | 'revoked'   // accountant killed it before completion

/** One row per W-9 request, internal or external. Internal recipients
 *  link to an existing `users` row via `recipient_user_id`; external
 *  ones leave it NULL and rely on the typed-in name + email. */
export interface W9Request {
  id: string
  brand: string
  recipient_user_id: string | null
  recipient_name: string
  recipient_email: string
  token: string
  requested_by: string | null
  requested_by_email: string | null
  requested_by_name: string | null
  status: W9RequestStatus
  expires_at: string
  revoked_at: string | null
  revoked_reason: string | null
  first_opened_at: string | null
  last_opened_at: string | null
  open_count: number
  last_sent_at: string | null
  last_sent_to: string | null
  send_count: number
  /** JSONB snapshot of submitted form fields. Excludes TIN/SSN — those
   *  live only inside the signed PDF for audit-surface minimization. */
  form_data: W9FormData | null
  signed_pdf_path: string | null
  signed_at: string | null
  delivered_pdf_to: string | null
  delivered_at: string | null
  created_at: string
  updated_at: string
}

/** Shape of `w9_requests.form_data` JSONB. Mirrors the IRS W-9 form
 *  layout. TIN is NOT stored here — only inside the signed PDF. */
export interface W9FormData {
  // Line 1 — name (as shown on tax return)
  name: string
  // Line 2 — business / disregarded entity name (if different)
  business_name: string | null
  // Line 3 — tax classification
  tax_classification:
    | 'individual'
    | 'c_corp'
    | 's_corp'
    | 'partnership'
    | 'trust_estate'
    | 'llc'
    | 'other'
  // Line 3 sub-options when tax_classification === 'llc'
  llc_classification: 'C' | 'S' | 'P' | null
  // Line 3 free text when tax_classification === 'other'
  other_classification: string | null
  // Line 4 — exemptions (rarely set — kept as free text)
  exempt_payee_code: string | null
  exempt_fatca_code: string | null
  // Lines 5-6 — address
  address: string
  city: string
  state: string
  zip: string
  // Part I — TIN type (which kind they filled in; actual digits in PDF only)
  tin_type: 'ssn' | 'ein'
  // Part II certification
  signed_name: string  // typed name alongside the drawn signature
  signed_at: string    // ISO timestamp captured at submit
}

/** BEB's requester info — populates the "person requesting information"
 *  box at top right of the W-9 form. Stored in `settings` under key
 *  'w9.requester_info'. */
export interface W9RequesterInfo {
  name: string
  address: string
  city: string
  state: string
  zip: string
  phone: string | null
  tin: string | null  // BEB's EIN — optional; some accountants want it visible
  contact_name: string | null
  contact_email: string | null
}

// ───────────────────────────────────────────────────────────────
// Expense Delegates — Ryan submits expense reports on Alan's
// behalf inside the Expenses module only. Schema at
// supabase-migration-expense-delegates.sql.
// ───────────────────────────────────────────────────────────────

/** One row per delegation pairing. Soft-deleted via revoked_at;
 *  active rows are those where revoked_at IS NULL. A given
 *  (delegate_user_id, principal_user_id) pair can have at most
 *  one active row at a time (partial unique index), but multiple
 *  historical revoked rows for audit.
 *
 *  Scope is Expenses-module only — outside the Expenses page the
 *  delegate stays themselves. Writes are Max-only, enforced at
 *  the API layer in Phase 2 (no write-RLS policies; service-role
 *  bypass only). */
export interface ExpenseDelegate {
  id: string
  /** The user who can file expense reports on behalf of someone else. */
  delegate_user_id: string
  /** The user being filed for — the owner of the resulting report. */
  principal_user_id: string
  created_at: string
  /** Who configured this row (Max). Nullable so deleting Max's
   *  user row doesn't FK-break the history. */
  created_by: string | null
  /** ISO timestamp when revoked; null while active. */
  revoked_at: string | null
}
