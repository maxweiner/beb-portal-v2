# White Sheet OCR Spec

Status: **design — not yet implemented**
Owner: Max
Last updated: 2026-05-13

## What this is

After every buying event, the buyer comes home with a stack of paper "white sheets" — IRS / state-mandated bill-of-sale invoices, one per customer transaction (~50–100 per show, ~1,000–1,500/month). Today those forms are scanned to PDF and filed; the dealer copies are archived for compliance but never harvested for the customer data they contain.

This spec turns those scans into structured records. The operator uploads one multi-page PDF per event to a new "📄 White Sheet Upload" launcher on the Buying Events Hub; the server splits the PDF into pages, OCRs each page with Claude Sonnet 4.6 vision, and writes the extracted customer to the existing Customers module — auto-linking back to the entered buy row (`buyer_checks`) via the form's pre-printed buy form number. Anything ambiguous lands in a per-event review pile; everything clean commits silently.

## Core architectural decisions

### Closed-set buyer-initials classification, not character OCR

Each event has ~3 assigned buyers, and each buyer has an idiosyncratic-but-consistent scribble in the AUTHORIZED BUYER box at the bottom-left. The system treats this as a constrained **visual classification** problem (`{ matched_user_id, confidence }` over the assigned-workers set), not free-form OCR of two letters. Claude vision gets the new page's crop alongside reference samples for each candidate buyer; the closed-set framing eliminates the "single-letter ambiguity" and "off-roster initials" failure modes that bedevil string-match approaches.

The reference library bootstraps from operator-confirmed pages — no Settings training step. First PDF after launch sends every page through the review pile; after ~5 confirmed samples per buyer the auto-classifier kicks in.

### Day Entry is the source of truth; OCR verifies, doesn't overwrite

Operators already type `buy_form_number`, `check_number`, and `amount` into Day Entry's buyer rows (`buyer_checks`). The white sheet flow never overwrites those three. Instead the OCR reads them and **verifies** — a mismatch raises a review flag on the page. The form's purpose for this feature is to enrich each entered buy with the customer fields you don't currently type by hand: name, email, address, phone, DOB, lead source, ID number.

### One-shot upload, async background processing

A 100-page PDF takes 60–90 seconds of wall-clock processing time even with parallel Claude calls. The operator never waits — upload is fire-and-forget; live progress shows on the Hub launcher card while they're still on the page, and an in-app notification + email summary lands when processing finishes regardless of where they've navigated to.

### Per-store customer DB, phone-first dedup

The customers module is already per-store (Phase 1 schema). White sheet customer records land in the store associated with the event being uploaded. Dedup priority is **phone → email → create** (mirrors the appointments→customer logic from Phase 12, but flipped order because handwritten emails are far less OCR-reliable than handwritten digit strings).

### Auto-commit clean pages, review pile for everything else

A page is "obviously clean" when **all five** of these pass:
1. OCR'd buy form # matches an entered `buyer_checks` row for this event
2. OCR'd $ total agrees with the entered `amount` (within $0.01)
3. OCR'd check # agrees with the entered `check_number`
4. OCR'd phone parses to a clean 10-digit number
5. Buyer-initial classifier matches one assigned worker with high confidence

When all five pass, the system creates / merges the customer and marks the page processed — the operator never sees it. Any failure routes the page into the per-event review pile with a `review_reasons` flag list explaining which check tripped. Operator can override per page or bulk-approve. An admin-only Settings toggle "Review every page" forces every page into the review pile regardless — useful for stress-testing a new model version.

## Process today (paper-based, what we're modeling)

1. Buyer fills out a pre-printed paper buy form during the transaction (one per customer). Buy form # is pre-printed in red at the top-right of each sheet (sequential within a pad).
2. Buyer hand-writes: customer name / email / address / city / state / zip / DL # / DOB / phone, plus the items description, total $, check #, date. Initials the AUTHORIZED BUYER box at the bottom-left. Customer signs the SELLER'S SIGNATURE line at the bottom-right.
3. Each form has a Customer Copy and a Dealer Copy. The dealer copies come back with the buyer.
4. After the show, the buyer scans the entire dealer-copy stack to a single multi-page PDF (~100 pages typical).
5. PDF is filed for compliance / audit. Customer data is never digitized for marketing use.

## Process in the app (what we're building)

### Upload flow

1. Buyer opens the event's Hub view → clicks the **📄 White Sheet Upload** launcher card.
2. Drag-drop or file-picker for one PDF. Server accepts, stores the raw PDF in `white-sheets/{brand}/{event_id}/{upload_id}/source.pdf`, creates a `white_sheet_uploads` row with `status='splitting'`.
3. Server splits the PDF into per-page PNGs at ~200 DPI (handwriting-readable, not crushing storage). Each page becomes a `white_sheet_pages` row with `status='pending'`.
4. Buyer sees a toast "Processing 100 pages — we'll let you know when it's done." Launcher card flips to a live counter ("Processing 47 / 100…") if they stay on the page.
5. Background worker drains `white_sheet_pages` rows with `status='pending'` — 8 in parallel against the Anthropic Vision API. For each page:
   - Single Claude Sonnet 4.6 vision call with a structured-output prompt → JSON with all extracted fields + per-field confidence + a crop of the buyer-initials box.
   - Closed-set buyer-initials classifier call (separate vision call with the assigned-workers' reference samples).
   - Match attempt: look up `buyer_checks` row for this `event_id` where `buy_form_number = ocr.buy_form_number`.
   - Customer dedup: phone-first → email → create against `customers` scoped to event's `store_id`.
   - Apply the five auto-commit checks. Set `status` to `auto_committed` or `needs_review` with `review_reasons`.
6. As pages complete, the upload's running counts update (`pages_total`, `pages_auto_committed`, `pages_in_review`, `pages_errored`).
7. When the last page settles, set `white_sheet_uploads.status='complete'`. Fire notification + email to the uploader. Notification body:
   > **Croft & Stern Jewelry Designs · 100 pages processed**
   > ✅ 92 auto-committed · ⚠️ 7 need review · ❌ 1 errored
   > [Open review pile →]

### Review pile

Per-event screen. Lists every page with `status='needs_review'` or `'errored'`. Side-by-side layout:

- **Left:** the page PNG, clickable to enlarge full-screen.
- **Right:** every extracted field as an editable row, each with the OCR's per-field confidence as a small pill. Reason badges at the top of the right pane explain why the page landed here (`unmatched_form`, `amount_mismatch`, `check_mismatch`, `low_confidence_phone`, `initials_ambiguous`, `errored`).
- **Bottom of right pane:** primary action buttons that change by reason. For `unmatched_form`: "Promote to new buy row" (creates a `buyer_checks` row from the OCR values; opens a confirm modal with the values pre-filled and editable). For `amount_mismatch` / `check_mismatch`: "Trust entered value" / "Trust OCR" / "Edit". For all reasons: a "Confirm & save" button that commits the customer + links the white sheet to whatever buy row is selected.
- **Top of screen:** "Bulk approve all clean" button that confirms any pages whose only flag is a low-confidence-non-critical field (operator-skim convenience).

For buyer-initials ambiguity specifically, the right pane shows a 3-button row with the assigned buyers' avatars; one click classifies. The confirmed crop is added to that buyer's `user_signature_samples` so the classifier improves automatically.

### Customer record write

A confirmed page writes / merges into `customers`:

- **Match:** scoped to `store_id` of the event. `phone_normalized` first (10-digit OCR'd phone), then `email_normalized` (lowercased trimmed OCR'd email).
- **Create:** when neither matches. Sets `first_name`, `last_name` (split on first space; "(unknown)" for missing half), `phone`, `email`, `address`, `city`, `state`, `zip`, `date_of_birth`, `how_did_you_hear` (mapped from the form's checkbox), `last_contact_date` = event start. Source enum gets a new value `white_sheet_upload`.
- **Update on existing match:** fill in any null columns from the OCR (non-destructive — never overwrites a value already there). Always pushes `last_contact_date`.

The `white_sheets` row separately stores `id_number` (DL #) — never copied to the `customers` table — and the `items_raw` free-text items description.

### Auto-relink trigger (safety net)

An AFTER INSERT trigger on `buyer_checks` checks for orphan `white_sheet_pages` rows in `status='needs_review'` with reason `unmatched_form` and a matching `(event_id, buy_form_number)`. If found, automatically sets their `buyer_check_id` to `NEW.id`, removes `unmatched_form` from `review_reasons`, and (if that was the only flag) flips the page back to `status='pending'` so the worker re-runs the auto-commit checks. Handles the "I forgot to enter Smith's buy, let me add it now" case without operator action. (AFTER INSERT, not BEFORE INSERT — the orphan pages need `NEW.id` available to set their FK.)

## Background processing architecture

```
[client uploads PDF]  →  POST /api/white-sheets/upload
                          │
                          ├── store source.pdf in supabase storage
                          ├── insert white_sheet_uploads row (status='splitting')
                          └── enqueue split job
                                │
                          [pdf-lib server-side split + pdfjs-dist render]
                                │
                          per page:
                            insert white_sheet_pages row (status='pending')
                            store page-{n}.png in supabase storage
                                │
                          set white_sheet_uploads.status='processing'

[every-60s cron]      →  /api/cron/process-white-sheets
                          │
                          claim N pending pages (status → 'processing')
                          parallelism = 8 within a single cron run
                          │
                          per page:
                            ├── Claude Sonnet 4.6 vision call (structured output)
                            │     → fields + per-field confidence + initials_crop_b64
                            │
                            ├── Claude vision call: 3-way buyer-initials classify
                            │     → { user_id, confidence } over assigned workers
                            │
                            ├── apply 5 auto-commit checks
                            │
                            ├── customer dedup + write
                            │     (phone-first → email → create)
                            │
                            └── PATCH white_sheet_pages row
                                  status = 'auto_committed' | 'needs_review' | 'errored'
                                  review_reasons[] populated on needs_review

[when last page settles]
                          set white_sheet_uploads.status='complete'
                          enqueue notification + email summary

[buyer_checks INSERT]  →  trigger: relink orphan white_sheet_pages
                           by (event_id, buy_form_number)
                           re-run auto-commit checks on relinked rows
```

- **Idempotency:** every step is idempotent. Page processing reads the row's current state before claiming; the dedup write uses `(store_id, phone_normalized)` lookup + insert-or-update; the relink trigger no-ops if the page is already linked.
- **Failure handling:** Claude API errors increment `attempts`, push the page back to `pending` with exponential backoff (1m / 5m / 15m, mirroring `gcal_sync_queue`). After 3 attempts, set `errored` with `last_error` populated; the page surfaces in the review pile with a "Retry" button.
- **Concurrency cap:** 8 pages in parallel per cron tick balances Anthropic rate limits against drain speed. A 100-page upload finishes in ~8 cron ticks (~8 minutes).
- **Cost budget:** ~$0.005–$0.01 per page × 1,500/month ≈ $10–15/month. Logged per-upload in `white_sheet_uploads.estimated_cost_cents` for monitoring.

## Decisions captured (Q&A summary)

| # | Topic | Decision |
|---|---|---|
| 1 | UI placement | New launcher on the Buying Events Hub: "📄 White Sheet Upload". Visible by default on events with at least one entered buy; toggleable via existing Customize Buttons modal. |
| 2 | Upload shape | One multi-page PDF per event, one buy per page, ~100 pages typical. Volume 1,000–1,500/month. |
| 3 | Match key | Pre-printed red buy form # at top-right of the form. Joins to `buyer_checks.buy_form_number` scoped to `event_id`. |
| 4 | Unmatched buy form # behavior | Hybrid (C): the page lands in the per-event review pile with `unmatched_form` flag; one-click "Promote to new buy row" creates the `buyer_checks` row from the OCR'd values (operator confirms in a pre-filled modal). |
| 5 | Customer dedup | Phone-first → email → create. Per-store scope. Mirrors the appointments→customer auto-link logic (Phase 12) but flips email/phone order because handwritten emails are OCR-unreliable. |
| 6 | Auto-commit policy | Option A — auto-commit "obviously clean" pages (5-check criteria); flag everything else into the review pile. Per-brand Settings toggle "Review every page" defaults off; admin/superadmin only. |
| 7 | Workflow timing | Expected always-after Day Entry. Safety-net trigger on `buyer_checks` INSERT auto-relinks orphan white sheets so forgotten-then-added Day Entry rows pull their sheets out of the review pile. |
| 8 | Field extraction map | Locked — see Schema additions. Customer-facing fields land on `customers`; DL # stays only on `white_sheets`. Race / Eye / Sex / Hair / Height / Weight are skipped (usually blank, model would hallucinate). |
| 9 | Buyer initials | Closed-set visual classification over the event's assigned workers (not character OCR). Reference library bootstraps from operator-confirmed pages — no Settings training step. Threshold for auto-link: model confidence ≥ 0.75 AND second-best ≤ 0.5. |
| 10 | Processing UX | Background job. Live counter on Hub launcher + in-app notification + email summary to uploader on completion. |
| 11 | Email recipient | Uploader only. Future flag for distribution-list broadcast. |
| 12 | Role gating | All hands — any active user (not pending, not marketing_partner) can upload + see + resolve review pile for any event. Admin/superadmin manage the brand-level Settings toggle. |
| 13 | Vision model | Claude Sonnet 4.6 vision for both the field-extraction call and the buyer-initials classifier call. Reconsider Haiku 4.5 after 30 days of production data if accuracy is robust. |

## Schema additions

### New table: `white_sheet_uploads` (one row per uploaded PDF)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → events |
| `brand` | text | Denormalized for partition queries |
| `uploaded_by_user_id` | uuid | FK → users |
| `source_pdf_path` | text | `white-sheets/{brand}/{event_id}/{upload_id}/source.pdf` |
| `original_filename` | text | What the operator's file was called |
| `pages_total` | int | Count after split |
| `pages_auto_committed` | int | Running count, updated as pages settle |
| `pages_in_review` | int | Running count |
| `pages_errored` | int | Running count |
| `status` | text | 'splitting' / 'processing' / 'complete' |
| `estimated_cost_cents` | int | Anthropic API spend, summed from page rows |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz | Set when status flips to 'complete' |

### New table: `white_sheet_pages` (one row per page)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `upload_id` | uuid | FK → white_sheet_uploads (cascade delete) |
| `event_id` | uuid | Denormalized for indexing |
| `page_number` | int | 1-indexed within the upload |
| `image_path` | text | Per-page PNG in storage |
| `status` | text | 'pending' / 'processing' / 'auto_committed' / 'needs_review' / 'errored' |
| `review_reasons` | text[] | `unmatched_form`, `amount_mismatch`, `check_mismatch`, `low_confidence_phone`, `initials_ambiguous`, etc. |
| `ocr_raw` | jsonb | Full Claude response, including per-field confidences |
| `buy_form_number_ocr` | text | Extracted from the red top-right |
| `check_number_ocr` | text | Extracted from the bottom-left |
| `amount_ocr` | numeric(12, 2) | Extracted from the TOTAL line |
| `buyer_check_id` | uuid | FK → buyer_checks. Set on auto-commit or operator confirmation. |
| `customer_id` | uuid | FK → customers. Set on auto-commit or operator confirmation. |
| `buyer_user_id` | uuid | FK → users. Set when initials classifier matches with confidence. |
| `initials_classifier_confidence` | numeric(4, 3) | 0.000–1.000 |
| `initials_crop_path` | text | The cropped initials box image — feeds the reference library on confirmation |
| `id_number_raw` | text | DL # — stays on this row, never copied to customers |
| `items_raw` | text | Free-text items description |
| `attempts` | int | For retry backoff |
| `last_error` | text | Populated on `errored` |
| `processed_at` | timestamptz | When the worker finished it |
| `reviewed_by_user_id` | uuid | FK → users. Who resolved this in the review pile. |
| `reviewed_at` | timestamptz | |
| `created_at` | timestamptz | |

### New table: `user_signature_samples` (buyer scribble reference library)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `image_path` | text | Cropped initials-box PNG in storage |
| `source_page_id` | uuid | FK → white_sheet_pages. The page this sample came from. |
| `is_active` | bool | Flag for retiring bad samples (e.g., an operator-misclassified one). Soft-delete. |
| `created_at` | timestamptz | |

Index: `(user_id, is_active)` so the classifier can pull a user's active samples cheaply.

### `customers` (existing — extend enum)

`customer_dedup_source` enum gains a new value: `white_sheet_upload`.

### `gcal_integration_settings` / new brand-level setting

Add a brand-scoped setting `white_sheets.review_every_page` (boolean, default false). Lives on the existing `settings` table (jsonb config blob) — admin/superadmin toggle in Settings → "White Sheet Upload".

## UI surfaces

1. **Hub launcher** — new "📄 White Sheet Upload" card on the Buying Events Hub. Three states:
   - *Idle:* "Upload white sheets for this event" + drag-drop hint.
   - *Processing:* live counter "47 / 100 pages processed" + small spinner.
   - *Complete-with-review-pile:* "8 pages need review →" with badge count.
2. **Upload modal** — opens from launcher click. Single drop-zone, accepts `.pdf` only, max file size cap (~100 MB). Shows the active upload's status if one is in progress.
3. **Review pile screen** — per-event, full-screen workspace (reuses `FullscreenWorkspace`). Page-by-page side-by-side viewer described above.
4. **Promote-to-buy modal** — opens from a `unmatched_form` page. Pre-fills `buyer_checks` create form with OCR values; operator confirms or edits before commit.
5. **Settings → White Sheet Upload** — admin/superadmin only. Toggle for "Review every page" + one-line per-brand stats (last 30 days: pages processed, auto-commit rate, average cost / upload).
6. **In-app notification** — drops into the existing notification queue when an upload finishes. Body: "Croft & Stern · 92 auto-committed · 7 need review · 1 errored. [Open review pile →]"
7. **Email summary** — sent to uploader only via Resend. Same body as the in-app notification, with the review-pile deep link in HTML.

## Roll-up logic — no Day Entry impact

This flow **does not change Day Entry totals**. The buy rows already exist (`buyer_checks`) and operators continue to enter them by hand; the OCR is verification-only on the three Day-Entry fields (amount, check #, form #). Every other extracted field lands on the `customers` table — orthogonal to Day Entry's roll-up math. Existing dashboards / reports / leaderboards are untouched.

## Open risks / things to revisit

- **PDF size cap.** A 100-page color PDF at the operator's scanner default DPI can land at 30–80 MB. Vercel's body size limit on regular function routes is small (~4.5 MB). Need a direct-to-storage upload pattern (signed-URL POST to Supabase Storage) so the route only ever sees the metadata, not the bytes.
- **Per-page render DPI.** 200 DPI is the proposal; might need to go to 250–300 for poor-quality scans where the buy form # bleeds into the background. Burn-in test on the first real upload.
- **Anthropic rate limits.** 8 pages in parallel × Sonnet 4.6 vision = real input-token volume. The Tier-2 Anthropic key should handle it; revisit if we see 429s.
- **Buyer-initials cold start.** Until ~5 confirmed samples accumulate per buyer, every page lands in the review pile for buyer classification. Need to set expectations: first PDF after launch = ~100 manual buyer-clicks. Subsequent PDFs should be mostly auto.
- **OCR'd duplicate customers.** If the OCR misreads the same customer's phone digits two events in a row, they'll exist as two distinct `customers` rows. Need a periodic dedup-review queue (similar to the import-side `dedup_review_queue` that already exists per Phase 1 schema) to surface near-misses.
- **Lead source mapping.** The form's printed checkboxes (Newspaper / Postcard / Direct Mailer / Social Media / Other) don't map 1-to-1 to the existing `customer_how_did_you_hear` enum (`large_postcard`, `small_postcard`, `newspaper`, `email`, `text`, `the_store_told_me`). Need an explicit translation table and decisions for "Direct Mailer" / "Social Media" / "Other" (likely add enum values). "Other ___" handwritten fill-in goes to `how_did_you_hear_legacy` free-text column.
- **Compliance retention.** DL # and DOB on customers are PII. Coordinate with the existing `compliance_actions` audit log so right-to-be-forgotten requests purge them cleanly.
- **Operator who scans ≠ operator who reviews.** "All hands" review gating means a non-assigned-to-event user might classify a buyer's scribble. They might not recognize it. Mitigation: the review pile presents reference samples for each candidate buyer, so the reviewer is matching shapes, not memory.
- **Multi-event in one PDF.** Spec assumes one event per PDF (matched user-confirmed during Q&A). If someone uploads a multi-event stack, the unmatched-form review pile will absorb half the pages. Add a defensive check: if >50% of OCR'd buy form #s in an upload don't match the event's `buyer_checks`, surface a banner "This PDF doesn't look like it's for this event — wrong event selected?"
- **Old uploads in storage.** Source PDFs retained indefinitely (compliance). Per-page PNGs retained 90 days then purged via a daily cleanup cron — the DB row keeps the OCR result and review flags, and on the rare review-pile-reopen-after-90-days case the page is re-rendered from the source PDF.

## Phasing (proposed build order)

1. **Phase 1 — schema + storage bucket + RLS.** Migration creates `white_sheet_uploads`, `white_sheet_pages`, `user_signature_samples`, the new `customer_dedup_source` enum value, the Settings toggle, the auto-relink trigger on `buyer_checks`. Adds the private `white-sheets/` storage bucket with all-hands RLS. No UI yet — purely plumbing.
2. **Phase 2 — upload + PDF splitter + page-render pipeline.** New API route accepts a signed-URL'd PDF, splits with `pdf-lib`, renders pages to PNG via `pdfjs-dist`, writes `white_sheet_pages` rows in `status='pending'`. New "📄 White Sheet Upload" launcher on the Hub with a basic drop-zone (no live counter yet). Operator can upload, see "100 pages pending" — but no OCR runs.
3. **Phase 3 — OCR worker + cron + auto-commit logic.** `/api/cron/process-white-sheets` drains pending pages 8-in-parallel against Claude Sonnet 4.6. Customer dedup + field extraction + the 5-check auto-commit logic. No buyer-initials classifier yet — every page lands in the review pile with `initials_pending` until Phase 5. Auto-relink trigger goes live.
4. **Phase 4 — review pile UI.** Per-event full-screen workspace. Side-by-side page + extracted fields + reason badges. Promote-to-buy modal. Confirm / edit / save flow. Bulk-approve-clean.
5. **Phase 5 — buyer-initials classifier + signature_samples bootstrap.** Second Claude vision call per page over the assigned workers' reference samples. Review pile gains the 3-button buyer-classify UX; confirmed crops auto-add to `user_signature_samples`. After cold start, auto-classified pages skip the review pile.
6. **Phase 6 — Hub launcher live counter + notifications + email summary.** Realtime subscription on `white_sheet_uploads` drives the launcher card state. Notification queue write + Resend email on completion.
7. **Phase 7 — Settings → "Review every page" toggle + stats.** Admin/superadmin escape hatch.
8. **Phase 8 — periodic dedup-review sweep.** Cron that surfaces near-miss customer duplicates created by OCR drift. Reuses the existing `dedup_review_queue` table from the customers Phase 1 schema.
9. **Phase 9 — 90-day page-image cleanup cron.** Purges per-page PNGs older than 90 days; DB rows retained.

Each phase is its own PR. Phase 1–3 ship the end-to-end pipeline with a (rudimentary) review pile UI; Phase 4 makes that pile usable; Phase 5 cuts review-pile volume by ~80% once the library warms up.

## Not in scope (explicit)

- **Customer-facing receipts.** Customers leave with the paper bottom-half of the form; that's unchanged.
- **Inventory / lot-level extraction.** The free-text items description goes to `items_raw` as-is. We're not parsing "14kt yellow gold ring 4.2g" into structured weights or item rows.
- **Real-time OCR during the event.** The intake → purchase initiative covers in-event capture. White Sheet OCR is the after-the-fact batch path.
- **Signature verification on customers' signatures.** We only classify the AUTHORIZED BUYER box. The customer's seller's-signature line is preserved on the scanned page but not OCR'd.
- **Multi-PDF uploads per event in a single action.** One PDF per upload click. Operator can do multiple uploads per event back-to-back if they ran multiple scanner sessions.
- **Customer-merge UX in the review pile.** If the OCR'd customer near-matches an existing row, dedup-review goes through the existing customers-module mechanism — not a new merge UI here.
- **Mobile upload.** The launcher accepts PDFs from desktop only at v1. Mobile scans-to-PDF can be uploaded via the web app's drop-zone but the launcher card isn't surfaced on mobile.
