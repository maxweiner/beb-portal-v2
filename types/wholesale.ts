// Liberty / wholesale module types. Mirrors the schema in
// supabase-migration-wholesale-schema.sql. Money fields are integers
// of cents. Brand is enforced at the app layer per existing pattern.

export type InventoryCategory = 'jewelry' | 'watch' | 'diamond'
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
  email: string | null
  address: string | null
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
  email: string | null
  address: string | null
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
  category: InventoryCategory
  item_number: string
  status: InventoryStatus
  cost_cents: number | null
  wholesale_price_cents: number | null
  retail_price_cents: number | null
  insurance_value_cents: number | null
  internal_notes: string | null
  public_notes: string | null
  vendor_id: string | null
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
  jewelry_metal_grams: number | null
  jewelry_diamond_count: number | null
  jewelry_diamond_total_ct: number | null
  jewelry_diamond_shape: string | null
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
