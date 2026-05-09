# Intake → Purchase Flow Spec

Status: **design — not yet implemented**
Owner: Max
Last updated: 2026-05-09 (v2 — switched to photo-first architecture)

## What this is

The license scanner today saves a `customer_intakes` row and stops. This spec wires the scanner into the actual buying-event workflow: capture license + invoice + jewelry photos at the counter, run barcode decode + OCR in the **background** server-side, and feed parsed data into a per-day worksheet that pre-fills Day Entry.

## Core architectural decision: photo-first

The buyer at the counter takes **photos**, not live-scans. Heavy processing (PDF417 decode, OCR for form #/check #/amount) runs **asynchronously on the server** while the buyer moves to the next customer.

Why:
- **Counter speed.** ~5 photos in 30 seconds, hit done, move on. No staring at a viewfinder waiting for a barcode to lock.
- **Better source images.** Native camera takes focused, well-exposed stills. Live scanning samples low-res video frames where focus drifts.
- **Better decoders available server-side.** Full zxing-cpp build + Anthropic Vision API are dramatically more accurate than anything that runs in a browser.
- **Resilient.** A failed decode is recoverable — the photo is still there. Today a failed live scan means re-scanning the customer.
- **Cheap.** ~$0.005/image × ~5 photos × ~50 customers/event = ~$1.25/event in vision-API cost.

The existing live PDF417 scanner stays as a **fallback** for users who want instant verification at the counter (e.g., compliance check on DOB before paying out). Photo-first is the default.

## Process today (paper-based, what we're modeling)

1. Customer walks in (with or without an appointment).
2. Greeter checks them in (separate person from the buyer).
3. Buyer writes a paper buy form. Each form has a pre-printed **5-digit number** at the top.
4. Buyer pays the customer; check is written from the register.
5. License is scanned for compliance + future marketing.
6. Customer leaves.

## Process in the app (what we're building)

### Two trigger points

- **Check-in** (greeter): customer arrives → mark appointment as arrived → optional license photos + email capture.
- **Purchase intake** (buyer): customer is selling → photos of license + invoice + jewelry → log $ + check #.

The two flows write to the same `customer_intakes` row when they relate to the same person; we dedup at lookup time.

### Buyer's purchase intake flow (photo-first)

1. Buyer taps the scan button. Active event is already known from the buyer's session.
2. **Prompt: "Buy form #"** — buyer types the 5-digit number from the paper form. Submit.
3. **Capture sequence** (each step uses the native camera, no live scanning):
   - Front of license (1 photo)
   - Back of license (1 photo — the side with the PDF417)
   - Invoice (1 photo)
   - Jewelry (1–5 photos)
4. **Quick fields screen** — email, phone, $ amount, check #, commission % (default 10%, override to 5% / 0% / store).
5. **Save** → row drops onto the buyer's worksheet with status `processing`. Photos upload to storage.
6. **Background worker** decodes the PDF417 from the back-of-license photo, runs OCR on the invoice photo for form # / check # / amount, and writes parsed fields back to the row. Status flips to `parsed` (or `parse_failed` if it couldn't read something).
7. Buyer is on the next customer by the time the worker finishes.

### Greeter's check-in flow

1. Greeter taps "📋 Check in" button.
2. Pulls up today's appointments for this event. Greeter taps the matching one (we already have name + phone from the booking).
3. Optional: take license photos + add email.
4. Mark appointment as arrived → row dropped on the same worksheet, marked as `check_in` (no form #, no $).

If the customer later sells, the buyer either picks them from "today's check-ins" or searches by phone — the existing browse-only intake gets upgraded to a purchase intake. Same row, no duplicate customer.

### End-of-day worksheet

1. Buyer opens "Today's intakes" worksheet at end of day.
2. Lists every intake (purchase + check-in-no-purchase) for this buyer / event / day.
3. Per-row status: `processing` ⏳ / `parsed` ✅ / `parse_failed` ⚠.
4. Buyer reviews: corrects OCR mistakes, fixes commission %, fills missing fields. Failed parses get manual entry.
5. Worksheet **blocks submission** until all rows are out of `processing` state (so we don't double-roll-up later).
6. Click **Submit Day Entry** → totals auto-roll to the existing Day Entry tab:
   - **Customer count** = unique persons (check-in + same-person purchase counts as 1)
   - **dollars10 / dollars5 / dollars0 / store-purchases** = sum of submitted intakes by commission bucket
7. Day Entry remains hand-editable — submitting the worksheet PRE-FILLS, doesn't lock.

## Background processing architecture

```
[mobile capture]  →  Supabase Storage upload  →  POST /api/intake/[id]/process
                                                   │
                                                   ├── decode PDF417 from back photo
                                                   │     (zxing-wasm server-side, or hosted)
                                                   │
                                                   ├── OCR invoice photo via Anthropic Vision
                                                   │     prompt asks for { form_number, check_number, amount }
                                                   │
                                                   └── PATCH customer_intakes
                                                         set parsed fields + processing_state='parsed'

[worksheet]       ←  Supabase Realtime subscription on customer_intakes row
                     auto-refreshes status badge as parses complete
```

- Endpoint: `POST /api/intake/[id]/process` — fire-and-forget from the client; client doesn't wait
- Idempotent — safe to call twice if the worker crashes mid-parse
- Failure handling: on error, write `processing_state='parse_failed'` + `parse_error_message`, don't retry automatically (buyer reviews on the worksheet)
- Manual reprocess button on the worksheet for `parse_failed` rows
- Processing budget per intake: ~5 seconds typical, ~30 seconds hard cap

## Decisions captured (Q&A summary)

| # | Topic | Decision |
|---|---|---|
| 1 | Buy form # uniqueness | 5-digit, **globally unique forever**. Pre-printed on books of 25/50. Voided = burned forever. Books can issue out of sequence. |
| 2 | Money entry | **Typed in app** (source of truth). OCR best-effort pre-fill on form #, check #, amount via background server-side processing. Default commission **10%**, override to 5% / 0% / store. |
| 3 | Check-in trigger | **Separate** flow (greeter, not buyer). Tied to **appointments**. License + email optional. Lookup at checkout: phone search OR pick from today's list. |
| 4 | Marketing capture | **Implicit consent** when selling. Auto-upsert into the existing `customers` table. Dedup priority: name → phone → email → license #. ⚠ See "Open risks" below. |
| 5 | Day Entry roll-up | Worksheet model. End-of-day review → submit pre-fills Day Entry. Same person checked-in + later purchased = **1 customer**. |
| 6 | Jewelry photos | Max 5 per intake. Stored as separate `intake_photos` rows (easier reorder/delete + powers buy-form lookup tool). All optional in v1. |
| 7 | Edits after save | All roles can edit. **Log every edit** (audit trail). After 3 days, locked except superadmins. Every field is editable, including form #. |
| 8 | Capture model | **Photo-first.** Counter takes static photos, server processes async. Live scanner becomes optional fallback for instant verification. |

## Schema additions

### `customer_intakes` (existing table — adds these columns)

| Column | Type | Notes |
|---|---|---|
| `buy_form_number` | text | 5-digit, globally unique. `UNIQUE` constraint, partial index where not null. |
| `check_number` | text | Optional. Free-form. |
| `purchase_amount` | numeric(12, 2) | $ paid for items. Null on browse-only. |
| `commission_pct` | numeric(4, 2) | 10.00 / 5.00 / 0.00. Default 10. |
| `commission_bucket` | text | 'rate_10' / 'rate_5' / 'rate_0' / 'store'. Pre-computed for fast roll-up. |
| `customer_id` | uuid | FK → `customers`. Nullable until dedup runs. |
| `appointment_id` | uuid | FK → `appointments`. Nullable. Set when intake originates from check-in. |
| `intake_kind` | text | 'check_in' / 'purchase' / 'check_in_then_purchase'. |
| `phone` | text | Optional. |
| `email` | text | Optional. |
| `front_photo_url` | text | Front-of-license. Existing column may already cover this. |
| `back_photo_url` | text | Back-of-license. Source for PDF417 background decode. |
| `invoice_photo_url` | text | The buy form scan. OCR target. |
| `processing_state` | text | 'processing' / 'parsed' / 'parse_failed'. Default 'processing'. |
| `processing_started_at` | timestamptz | When the background worker picked it up. |
| `processed_at` | timestamptz | When the background worker finished. |
| `parse_error_message` | text | Populated on `parse_failed`. |
| `submitted_to_day_entry_at` | timestamptz | Set when the worksheet is submitted. |

### New table: `intake_photos`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `intake_id` | uuid | FK → customer_intakes (cascade delete) |
| `photo_url` | text | Required |
| `sort_order` | int | 0–4 |
| `created_at` | timestamptz | |

### New table: `intake_audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `intake_id` | uuid | FK |
| `actor_user_id` | uuid | FK → users |
| `action` | text | 'create' / 'update' / 'submit_day_entry' / 'soft_delete' / 'reprocess' |
| `changed_fields` | jsonb | `{ field: [old, new] }` for updates |
| `created_at` | timestamptz | |

## Buy-form lookup tool

Standalone search page (admin + buyers). Filter by any of:
- Buy form # (exact)
- Customer name (fuzzy, ILIKE)
- Phone (digits only)
- Email (exact)
- Check # (exact)
- Amount range (e.g., $500–$2,000)
- Date range
- Event

Results show: customer, form #, check #, amount, photos (gallery), edit button (gated by role + 3-day lock).

## UI surfaces

1. **Mobile photo-capture flow** — replaces / supplements the existing live `LicenseScanner`. New step sequence: form # → front photo → back photo → invoice photo → jewelry photos → quick fields → save.
2. **Greeter check-in screen** — new route. Lists today's appointments for the active event. Tap a row → optional photos / email entry → mark arrived.
3. **End-of-day worksheet** — new route, scoped to today + buyer + event. Shows processing status per row. Edit + Submit-to-Day-Entry button.
4. **Buy-form lookup** — new route under Admin Panel.
5. **Hub view launcher** — add 🪪 **Intake** button → opens the photo-capture flow.

## Day Entry roll-up logic

When `Submit to Day Entry` is clicked on the worksheet (only enabled when all rows have a terminal processing state):

```
day_entry.customers       = COUNT(DISTINCT customer_id)  -- dedup check-in+purchase
day_entry.purchases       = COUNT(intakes WHERE intake_kind LIKE '%purchase%')
day_entry.dollars10       = SUM(purchase_amount) WHERE commission_bucket = 'rate_10'
day_entry.dollars5        = SUM(purchase_amount) WHERE commission_bucket = 'rate_5'
day_entry.dollars0        = SUM(purchase_amount) WHERE commission_bucket = 'rate_0'
day_entry.store_purchases = SUM(purchase_amount) WHERE commission_bucket = 'store'
```

These pre-fill — buyer can still edit the Day Entry screen manually after.

## Open risks / things to revisit

- **Verify-at-counter latency.** The buyer no longer sees parsed name/DOB during capture (it appears later when the worker finishes). Mitigations: buyer can spot-check the front-of-license photo themselves; for users who need instant verification, the live scanner stays available as a fallback.
- **Dedup risk: name-first ordering.** Two different "John Smith"s at the same event would merge into one customer. Mitigation: even when name matches, require phone OR license # to also match before merging. Surface a "this might be a duplicate — confirm or split" prompt.
- **Globally-unique form #.** If a buyer types a number used at an old event, we reject. Need a clear error message + override flow for genuine reissues.
- **Mass roll-up race.** Two buyers at the same event submit worksheets simultaneously — the second submit needs to add to (not replace) the first's totals. Upsert + sum on `(event_id, day_number)`.
- **Photo storage cost.** Up to 5 photos × hundreds of intakes per event × dozens of events = lots of Supabase Storage. Consider thumbnail + original split, or a lifecycle rule that compresses originals after 90 days.
- **Worker reliability.** If the background processor is slow or dies, intakes pile up in `processing` and the worksheet can't be submitted. Need a manual "force submit anyway" admin escape hatch + Slack alert when the queue depth exceeds a threshold.
- **Vision API cost growth.** $0.005/image is fine today. If volume scales 10×, revisit — may want batched OCR or self-hosted Tesseract for the simpler invoice parse.

## Phasing (proposed build order — v2 photo-first)

1. **Phase 1 — schema + photo-capture flow.** Migration adds the new columns + `intake_photos` + `intake_audit_log`. New mobile capture component (form # → 4 photos → quick fields). Saves to `customer_intakes` with `processing_state='processing'`. Photos to Supabase Storage. **No background worker yet** — buyer fills in form #, check #, amount manually.
2. **Phase 2 — background processor.** API route + queue. Decodes PDF417 from back-of-license photo. Updates row to `parsed`/`parse_failed`. Worksheet shows live status via Realtime.
3. **Phase 3 — invoice OCR.** Add OCR pass via Anthropic Vision in the same background route. Pre-fills form #, check #, amount when confident.
4. **Phase 4 — worksheet.** Per-day list + edit + submit-to-Day-Entry. Blocks submit while any row is `processing`.
5. **Phase 5 — greeter check-in.** **DEFERRED — build later.** Tied to appointments, with optional license capture. Build order skips this and goes 4 → 6.
6. **Phase 6 — buy-form lookup tool.** Search page.
7. **Phase 7 — customer dedup.** Auto-upsert into `customers` + dedup-confirm prompt.
8. **Phase 8 — audit log + 3-day edit lock.**
9. **Phase 9 — live-scanner fallback toggle.** "Verify license live (slower)" option in capture flow for buyers who want instant DOB check.

Each phase is its own PR. Phase 1 ships a usable but fully-manual flow; Phase 2/3 add the speed-up that justifies the architecture.

## Not in scope (explicit)

- Receipts to the customer (digital or printed).
- Payment processing (we still write paper checks).
- Item-level breakdown — one $ amount per intake, no line items.
- Connection to inventory / lots / scrap-out.
- Multi-currency.
