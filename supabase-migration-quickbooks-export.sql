-- ============================================================
-- QuickBooks export — schema + default account mapping seed
--
-- Lets Diane download an approved expense report as either:
--   - IIF  (QuickBooks Desktop, native import)
--   - CSV  (QuickBooks Online via SaasAnt / Transaction Pro /
--           Intuit Spreadsheet Sync — QBO doesn't natively import
--           bill-with-splits)
--
-- Booking model: one expense report → one QB Bill. The buyer is
-- the Vendor (auto-created in QBD via the IIF's !VEND record on
-- first export), the AP account is the Bill's credit side, and
-- each expense category is a line-split debited to its mapped
-- expense account. Pay-Bills happens in QB later when the
-- reimbursement check / ACH is cut.
--
-- What this migration adds:
--   1. expense_reports.exported_to_qb_at + exported_to_qb_format
--      (audit trail + re-export warning)
--   2. settings row `quickbooks.account_mapping` — JSON map from
--      portal category → QB account name. Seeded with sensible
--      defaults; Diane edits via Settings → 💼 QuickBooks
--      Account Mapping panel.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Tracking columns on expense_reports
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS exported_to_qb_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_to_qb_format TEXT;

COMMENT ON COLUMN public.expense_reports.exported_to_qb_at IS
  'Set when this report was last exported to QuickBooks. Drives the re-export warning + "Exported ✓" pill in the Accounting Queue. Null = never exported.';
COMMENT ON COLUMN public.expense_reports.exported_to_qb_format IS
  'Most recent export format: ''iif'' (QBD) or ''csv'' (QBO). Null = never exported.';

-- Re-export lookup ("show me reports I''ve already booked into QB").
CREATE INDEX IF NOT EXISTS idx_expense_reports_exported_to_qb
  ON public.expense_reports (exported_to_qb_at)
  WHERE exported_to_qb_at IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- 2. Account-mapping seed
-- ─────────────────────────────────────────────────────────────
-- Mapping from portal expense_category → QB account name. The
-- export reads this row, falls back to a hardcoded default on
-- any missing key so a future new category doesn't crash the
-- export. AP account ('ap_account') is the credit side of the
-- Bill — usually "Accounts Payable" but customizable for
-- multi-currency / multi-entity setups.
--
-- Account-name syntax matches QB's hierarchy: "Parent:Child"
-- creates / references a sub-account. IIF + CSV both accept
-- this shape; QB matches existing accounts by full path.
INSERT INTO public.settings (key, value)
SELECT 'quickbooks.account_mapping', jsonb_build_object(
  'flight',             'Travel:Flight',
  'rental_car',         'Travel:Rental Car',
  'rideshare',          'Travel:Ground Transportation',
  'hotel',              'Travel:Hotel',
  'meals',              'Travel:Meals',
  'shipping_supplies',  'Supplies:Shipping',
  'jewelry_lots_cash',  'Cost of Goods Sold:Jewelry Purchases',
  'mileage',            'Travel:Mileage',
  'custom',             'Travel:Other',
  'compensation',       'Buyer Compensation',
  'bonus',              'Buyer Bonus',
  'ap_account',         'Accounts Payable'
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'quickbooks.account_mapping'
);


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'QuickBooks export schema ready. Edit account mapping via Settings → 💼 QuickBooks Account Mapping. Export from Accounting Queue → ⬇ Export to QB.';
END $$;
