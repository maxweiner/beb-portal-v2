# Liberty Wholesale Inventory + Sales

Brand-scoped inventory, memos, and invoicing module. Lives at sidebar → Liberty Admin → 🛒 Wholesale (and parallel slot in BEB nav). Built for Liberty Estate Buyers' wholesale-only flow; the schema also supports BEB.

## Who can use it

- Module visibility: `admin` + `superadmin` (granted via `role_modules`).
- Inside the page: `superadmin` / `admin` / `users.is_partner = true` get full access.
- RLS on every wholesale table enforces the same gate via `wholesale_caller_allowed()`.

## Bootstrapping (one-time)

1. Run the schema migration: `supabase-migration-wholesale-schema.sql`
2. Run the module-registration migration: `supabase-migration-wholesale-module.sql`
3. Create two Supabase Storage buckets (Dashboard → Storage → New bucket):
   - `wholesale-photos` — PNG/JPG/WEBP item photos. Suggested: private, signed URLs only.
   - `wholesale-documents` — PDF/PNG/JPG lab reports, receipts, provenance.
4. Set the per-brand display details in the `settings` table (used by the PDFs):
   ```sql
   INSERT INTO settings (key, value, updated_at) VALUES
     ('wholesale.liberty.address',        '"123 Main St\nSuite 200\nAnytown, ST 12345"'::jsonb, now()),
     ('wholesale.liberty.phone',          '"(555) 555-5555"'::jsonb, now()),
     ('wholesale.liberty.email',          '"info@libertyestate.com"'::jsonb, now()),
     ('wholesale.liberty.appraiser_name', '"Owner Name"'::jsonb, now())
   ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
   ```
5. (Optional) Set `RAPNET_API_KEY` env var on Vercel to enable Tier-1 diamond lookups. Without it, the lookup falls through to manual entry; the page surfaces a clear "manual" notice.

## Tabs

| Tab | What it does |
| --- | --- |
| Inventory | Wide list with category + status filters; new-item flow picks category first; per-item modal handles edit, photos, docs, audit timeline. |
| Memos | Memo list with status filter. Detail modal shows lines + bulk-select → create invoice / mark returned. Memo PDF download. |
| Invoices | Invoice list with AR aging. Detail modal handles lines, trade-ins (auto-spawns inventory), payments. Invoice PDF download. |
| Customers | Wholesale (dealer) customers with credit balance + recent memos / invoices. |
| Vendors | Where stones / pieces came from; auto purchase history per vendor. |
| Reports | 9 reports, all CSV-exportable (inventory on hand, aging, open memos, sales by period, profit margin, customer / vendor activity, AR aging, sold items log). |
| Lists | Admin-editable dropdowns + locations. Deactivate (no delete) preserves historical records. |

## Item numbering

`J-1001`, `W-1001`, `D-1001`, `M-1001`, `INV-1001` — sequence per (brand, prefix). Atomic via `next_wholesale_number(brand, prefix)` SQL function. Liberty's `J-1001` and BEB's `J-1001` are independent.

## Inventory shape — single wide table

`inventory_items` has shared columns + every category-specific column nullable on the row. CHECK constraints enforce the right shape for each category. One table → simpler queries, no JOINs, type-safe everywhere. See `supabase-migration-wholesale-schema.sql` for the full column list.

## Memo workflow

- New memo → pick customer → memo created (status `open`).
- Add inventory item to memo → line created with `line_status = 'out'`; inventory item flips to `on_memo` and stores the memo id on `inventory_items.current_memo_id`.
- Memo prices default to the item's wholesale price; editable on the line at any time.
- Lines transition to `returned` (item flips back to `in_stock`) or `sold` (via invoice conversion). Memo status auto-recomputes after each line transition.
- Bulk-select lines + click **Convert to invoice** → spawns a new invoice with those lines, flips item statuses to `sold` and stamps `inventory_items.sold_invoice_id`. Remaining lines stay on the memo (eligible for return later).

## Invoice workflow

- New invoice → pick customer (terms default from the customer record).
- Add line: pick an in-stock / on-memo / on-hold item → flips item to `sold`. Sale price defaults to wholesale.
- Trade-in line: description + agreed price + category → spawns a new `inventory_items` row owned by an auto-created vendor (the buying customer). Cost = agreed price. Trade-in credit subtracts from invoice total.
- Payments: multiple per invoice; running balance + payment status (`unpaid` / `partial` / `paid`) auto-update.

## Diamond lookup

Three tiers attempted in order:
1. **RapNet API** — only fires if `RAPNET_API_KEY` is set; the placeholder request shape needs to be replaced with the real RapNet endpoint when access is provisioned.
2. **GIA Report Check scrape** — currently a stub that returns `null`. Implementing this requires a headless browser + legal review of GIA terms; falls through to manual today.
3. **Manual** — always available. Source recorded on `inventory_items.diamond_data_source` for audit.

The "Lookup" button lives on the diamond form next to the report-number field.

## PDFs

| Document | Route | Notes |
| --- | --- | --- |
| Memo | `/api/wholesale/memo/[id]/pdf` | Diagonal "MEMO — NOT A SALE" watermark. Photos + items + memo prices + signature lines. T&C from `wholesale.<brand>.memo_terms` setting (or the default in `lib/wholesale/memoPdf.tsx`). |
| Invoice | `/api/wholesale/invoice/[id]/pdf` | Trade-in credit + payments + balance. No sales tax. |
| Appraisal | `/api/wholesale/item/[id]/appraisal-pdf` | Single item, full specs, photos, replacement value as headline. Appraiser from `wholesale.<brand>.appraiser_name` (or the user generating). |
| Item tag | `/api/wholesale/item/[id]/tag-pdf` | Small label, item number in monospace. **Real barcode + QR pending**: install `bwip-js` + `qrcode` and embed PNG buffers; the doc has a placeholder line indicating where to slot them. |

## Audit log

`wholesale_audit_log` captures meaningful actions. Per-record timeline lives on the inventory detail modal's "History" tab. Cost edits flagged separately (`action = 'cost_edited'`). Status changes carry `before` / `after` JSONB diffs.

## Brand-scoping

Every table includes a `brand` column with a CHECK constraint. App-layer filters by `useApp().brand`. Switching brands in the app reloads everything. RLS gates on role + partner; brand boundary is enforced in the query path.

## Files

| Path | Role |
| --- | --- |
| `supabase-migration-wholesale-schema.sql` | Tables + enums + RLS + sequence helper + dropdown seeds |
| `supabase-migration-wholesale-module.sql`  | role_modules registration |
| `types/wholesale.ts`                       | TypeScript schema mirror |
| `lib/wholesale/numbers.ts`                 | `nextWholesaleNumber()` RPC wrapper |
| `lib/wholesale/audit.ts`                   | Audit-log helper |
| `lib/wholesale/format.ts`                  | Money / date / margin helpers |
| `lib/wholesale/lists.ts`                   | Admin-list loader |
| `lib/wholesale/pdfHelpers.ts`              | Brand-display loader, photo data-URL converter |
| `lib/wholesale/memoPdf.tsx` etc.           | React-PDF documents |
| `app/api/wholesale/*`                      | API routes (PDFs, diamond lookup) |
| `components/wholesale/WholesalePage.tsx`   | Shell + tabs |
| `components/wholesale/InventoryView.tsx`   | Inventory CRUD + photos + docs + audit |
| `components/wholesale/{Memos,Invoices,Customers,Vendors,Reports,AdminLists}View.tsx` | Per-tab UIs |
| `components/wholesale/GlobalSearch.tsx`    | Type-ahead search |

## Future work (deliberately deferred for v1)

- Real CODE128 barcode + QR on item tags (`bwip-js` / `qrcode`).
- RapNet endpoint hookup (needs real API docs + key).
- GIA Report Check scrape (legal review needed).
- Email memo / invoice / appraisal via the existing Resend integration (one-click "Email PDF" from the modals).
- Drag-to-reorder admin lists (currently up/down arrows).
- Photo auto-resize + EXIF strip on upload.
- "On hold" expiration cron — auto-flip back to In Stock at `hold_expires_at`.
