// Liberty / wholesale module types. Mirrors the schema in
// supabase-migration-wholesale-schema.sql. Money fields are integers
// of cents. Brand is enforced at the app layer per existing pattern.

export type InventoryCategory = 'jewelry' | 'watch' | 'diamond'
// Note: inventory_items.category is nullable per migration
// supabase-migration-wholesale-import-prep.sql so freshly-imported
// rows can sit uncategorized until triaged in the sheet view.
export type InventoryStatus =
  | 'in_stock' | 'on_memo' | 'on_hold' | 'sold' | 'returned' | 'in_repair' | 'consigned_out'

export type MemoStatus = 'open' | 'closed_sold' | 'closed_returned' | 'closed_partial' | 'overdue'
export type MemoLineStatus = 'out' | 'returned' | 'sold'
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid'
export type DiamondLabType = 'GIA' | 'AGS' | 'IGI' | 'GCAL' | 'EGL' | 'None'
export type DiamondDataSource = 'rapnet' | 'gia_scrape' | 'manual'

export interface InventoryLocation {
  id: string
  brand: string
  name: string
  notes: string | null
  active: boolean
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface WholesaleVendor {
  id: string
  brand: string
  company_name: string
  contact_name: string | null
  phone: string | null
  mobile_phone: string | null
  email: string | null
  /** @deprecated legacy single-field address. New code writes both
   *  billing_address and shipping_address and keeps this synced to
   *  billing_address for backward compat with older readers. */
  address: string | null
  billing_address: string | null
  shipping_address: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface WholesaleCustomer {
  id: string
  brand: string
  company_name: string
  contact_name: string | null
  phone: string | null
  mobile_phone: string | null
  email: string | null
  /** @deprecated legacy single-field address. New code writes both
   *  billing_address and shipping_address and keeps this synced to
   *  billing_address for backward compat with older readers. */
  address: string | null
  billing_address: string | null
  shipping_address: string | null
  resale_certificate_number: string | null
  default_payment_terms: string | null
  notes: string | null
  credit_balance_cents: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface InventoryItem {
  id: string
  brand: string
  category: InventoryCategory | null
  item_number: string
  status: InventoryStatus
  cost_cents: number | null
  wholesale_price_cents: number | null
  retail_price_cents: number | null
  insurance_value_cents: number | null
  /** The Edge ask price (Liberty's wholesale send to The Edge POS).
   *  NULL = "not ready to send to Edge" — the send view filters on
   *  this column for the readiness gate. See `supabase-migration-edge-export.sql`. */
  edge_price_cents: number | null
  gender: 'Female' | 'Male' | 'Unisex' | null
  internal_notes: string | null
  public_notes: string | null
  vendor_id: string | null
  vendor_stock_number: string | null
  vendor_invoice_number: string | null
  /** True when this item is on memo *into* the company (loaned to us
   *  by a vendor) — distinct from status='on_memo' which means it's
   *  out on memo to a customer. */
  memo_in: boolean
  alternate_item_number: string | null
  location_id: string | null
  date_acquired: string | null
  hold_for_customer_id: string | null
  hold_expires_at: string | null
  current_memo_id: string | null
  sold_invoice_id: string | null

  // Jewelry-specific
  jewelry_type: string | null
  jewelry_metal_type: string | null
  jewelry_metal_color: string | null
  jewelry_metal_karat: string | null
  jewelry_metal_dwt: number | null
  // Stones for a jewelry item live in the separate
  // inventory_item_stones table (see InventoryItemStone below) —
  // a piece can have any number of stone entries of any type.
  // This array is populated only by detail-fetch paths that
  // explicitly join the child table; list queries leave it
  // undefined to stay cheap.
  stones?: InventoryItemStone[]
  jewelry_size: string | null
  jewelry_length: string | null
  jewelry_hallmarks: string | null
  jewelry_designer: string | null
  jewelry_period: string | null

  // Watch-specific
  watch_brand: string | null
  watch_model: string | null
  watch_serial_number: string | null
  watch_band_style: string | null
  watch_movement_type: string | null
  watch_year: number | null
  watch_condition: string | null
  watch_box_papers: 'yes' | 'no' | 'partial' | null
  watch_complications: string[] | null
  watch_case_material: string | null
  watch_case_size_mm: number | null
  watch_dial_color: string | null

  // Diamond-specific
  diamond_lab_type: DiamondLabType | null
  diamond_report_number: string | null
  diamond_shape: string | null
  diamond_carat: number | null
  diamond_color: string | null
  diamond_clarity: string | null
  diamond_cut: string | null
  diamond_polish: string | null
  diamond_symmetry: string | null
  diamond_fluorescence: string | null
  diamond_measurements: string | null
  diamond_depth_pct: number | null
  diamond_table_pct: number | null
  diamond_data_source: DiamondDataSource | null

  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface InventoryPhoto {
  id: string
  brand: string
  item_id: string
  storage_path: string
  is_primary: boolean
  caption: string | null
  sort_order: number
  uploaded_by: string | null
  created_at: string
}

// One row per stone entry on a jewelry item. A piece can have any
// number of these — e.g., a ring with 5 accent Diamonds + 1 center
// Ruby is two rows. The renderer puts Diamond entries first in the
// auto-description regardless of sort_order; sort_order controls
// ordering only within the same stone-type group.
export interface InventoryItemStone {
  id: string
  item_id: string
  stone_type: string        // 'Diamond' | 'Ruby' | … or custom from the managed stone_type list
  shape: string | null      // from the shared diamond_shape list
  count: number | null
  total_ct: number | null
  sort_order: number
  created_at: string
}

export interface InventoryDocument {
  id: string
  brand: string
  item_id: string
  storage_path: string
  filename: string | null
  doc_type: string | null
  uploaded_by: string | null
  created_at: string
}

export interface WholesaleMemo {
  id: string
  brand: string
  memo_number: string
  customer_id: string
  date_created: string
  due_date: string
  status: MemoStatus
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface WholesaleMemoLine {
  id: string
  memo_id: string
  item_id: string
  memo_price_cents: number
  line_status: MemoLineStatus
  resolved_at: string | null
  invoice_line_id: string | null
  created_at: string
}

export interface WholesaleInvoice {
  id: string
  brand: string
  invoice_number: string
  customer_id: string
  invoice_date: string
  payment_terms: string | null
  payment_status: InvoicePaymentStatus
  notes: string | null
  subtotal_cents: number
  tradein_credit_cents: number
  total_due_cents: number
  paid_cents: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface WholesaleInvoiceLine {
  id: string
  invoice_id: string
  item_id: string
  description: string | null
  sale_price_cents: number
  cost_cents_at_sale: number | null
  created_at: string
}

export interface WholesaleInvoiceTradeinLine {
  id: string
  invoice_id: string
  description: string
  agreed_price_cents: number
  category: InventoryCategory
  spawned_item_id: string | null
  created_at: string
}

export interface WholesaleInvoicePayment {
  id: string
  invoice_id: string
  brand: string
  paid_on: string
  amount_cents: number
  method: string | null
  reference: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface WholesaleAdminListEntry {
  id: string
  brand: string
  list_key: string
  value: string
  active: boolean
  sort_order: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WholesaleAuditLogEntry {
  id: string
  brand: string
  entity_type: string
  entity_id: string | null
  action: string
  before: any
  after: any
  actor_id: string | null
  actor_email: string | null
  created_at: string
}

// ───────────────────────────────────────────────────────────────
// Edge wholesale-export (Send to The Edge POS / Mary Moses)
// ───────────────────────────────────────────────────────────────
// Schema lives in supabase-migration-edge-export.sql. Liberty-only
// feature at the UI layer (brand-gated tab); brand column on these
// tables is kept generic so BEB use is a one-line change later.

export type EdgeBatchStatus = 'draft' | 'sent' | 'viewed' | 'revoked' | 'failed'
export type EdgeRecipientRole = 'to' | 'cc' | 'bcc'

/** One outbound send to The Edge. Past batches are immutable — the
 *  "resend" action creates a fresh batch with a new code. */
export interface EdgeBatch {
  id: string
  brand: string
  /** Human-readable code in the form `EDGE-YYYYMMDD-XXXX`. Used in
   *  the email subject, the public URL slug, and on the batch page. */
  batch_code: string
  /** URL-safe random token Mary uses to load the public batch page
   *  without authenticating. Minted at the app layer (crypto.randomBytes). */
  public_token: string
  created_by: string | null
  created_by_email: string | null
  recipient_email: string
  recipient_name: string | null
  cc_emails: string[]
  bcc_emails: string[]
  notes: string | null
  item_count: number
  photo_count: number
  csv_path: string | null
  media_folder: string | null
  media_zip_path: string | null
  status: EdgeBatchStatus
  email_provider_id: string | null
  email_error: string | null
  sent_at: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  view_count: number
  revoked_at: string | null
  revoked_reason: string | null
  created_at: string
  updated_at: string
}

/** Frozen per-item record inside a batch. The `snapshot` field is the
 *  source of truth for the CSV — it's a copy of every column we ship,
 *  so regenerating the CSV stays deterministic even if the inventory
 *  item is later edited/sold/deleted. */
export interface EdgeBatchItem {
  id: string
  batch_id: string
  /** May be NULL if the underlying item was later deleted. */
  inventory_item_id: string | null
  position: number
  item_number_frozen: string
  snapshot: EdgeBatchItemSnapshot
  photo_paths: string[]
  photo_count: number
  created_at: string
}

/** JSONB shape stored in edge_batch_items.snapshot. Keep this in sync
 *  with the CSV column writer in `lib/wholesale/edgeCsv.ts` (PR 3). */
export interface EdgeBatchItemSnapshot {
  item_number: string
  category: InventoryCategory | null
  description: string | null
  vendor_name: string | null
  vendor_stock_number: string | null
  cost_cents: number | null
  edge_price_cents: number | null
  retail_price_cents: number | null
  metal_type: string | null
  metal_color: string | null
  metal_karat: string | null
  metal_dwt: number | null
  stones_summary: string | null
  primary_stone: string | null
  primary_stone_ct: number | null
  gender: 'Female' | 'Male' | 'Unisex' | null
  size: string | null
  length: string | null
  designer: string | null
  period: string | null
  hallmarks: string | null
  date_acquired: string | null
  public_notes: string | null
}

/** Recipient settings row. role='to' rows show as primary-recipient
 *  options (one is_default per brand); role='cc'/'bcc' are added to
 *  every outbound send unless explicitly removed in the composer. */
export interface EdgeRecipient {
  id: string
  brand: string
  email: string
  name: string | null
  role: EdgeRecipientRole
  is_default: boolean
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}
