# Intake → Purchase Flow Spec

Status: **design — not yet implemented**
Owner: Max
Last updated: 2026-05-09

## What this is

The license scanner today saves a `customer_intakes` row and stops. This spec wires the scanner into the actual buying-event workflow: scan + capture purchase data + photos + customer info, all tied to the active event, with a per-day worksheet that pre-fills Day Entry.

## Process today (paper-based, what we're modeling)

1. Customer walks in (with or without an appointment).
2. Greeter checks them in (separate person from the buyer).
3. Buyer writes a paper buy form. Each form has a pre-printed **5-digit number** at the top.
4. Buyer pays the customer; check is written from the register.
5. License is scanned for compliance + future marketing.
6. Customer leaves.

## Process in the app (what we're building)

### Two trigger points

- **Check-in** (greeter): customer arrives → mark appointment as arrived → optional license scan + email capture.
- **Purchase intake** (buyer): customer is selling → scan license + invoice + jewelry → log $ + check #.

The two flows write to the same `customer_intakes` row when they relate to the same person; we dedup at lookup time.

### Buyer's purchase intake flow

1. Buyer taps the scan button. Active event is already known from the buyer's session.
2. **Prompt: "Buy form #"** — buyer types the 5-digit number from the paper form. Submit.
3. **Camera opens** — scan back of license (PDF417). Existing scanner, dual-engine (zxing + zbar).
4. **Front photo** — same as today.
5. **Invoice scan** — photo of the paper buy form. OCR best-effort attempt: form #, check #, amount.
6. **Jewelry photos** — buyer takes 1–5 photos of the items.
7. **Quick fields** — email + phone (both optional). $ amount and check # (pre-filled if OCR succeeded; editable). Commission % (defaults to 10%; override to 5% / 0% / store-purchase).
8. Save → row drops onto the buyer's **per-day worksheet**.

### Greeter's check-in flow

1. Greeter taps "📋 Check in" button.
2. Pulls up today's appointments for this event. Greeter taps the matching one (we already have name + phone from the booking).
3. Optional: scan license + add email.
4. Mark appointment as arrived → row dropped on the same worksheet, marked as "browse-only" (no form #, no $).

If the customer later sells, the buyer either picks them from "today's check-ins" list or searches by phone — the existing browse-only intake gets upgraded to a purchase intake (form #, $, etc filled in). Same row, no duplicate customer.

### End-of-day worksheet

1. Buyer opens "Today's intakes" worksheet at end of day.
2. Lists every intake (purchase + check-in-no-purchase) for this buyer / event / day.
3. Buyer reviews: corrects OCR mistakes, fixes commission %, fills missing fields.
4. Click **Submit Day Entry** → totals auto-roll to the existing Day Entry tab:
   - **Customer count** = unique persons (check-in + same-person purchase counts as 1)
   - **dollars10 / dollars5 / dollars0 / store-purchases** = sum of submitted intakes by commission bucket
5. Day Entry remains hand-editable — submitting the worksheet PRE-FILLS, doesn't lock.

## Decisions captured (Q&A summary)

| # | Topic | Decision |
|---|---|---|
| 1 | Buy form # uniqueness | 5-digit, **globally unique forever**. Pre-printed on books of 25/50. Voided = burned forever. Books can issue out of sequence. |
| 2 | Money entry | **Typed in app** (source of truth). OCR best-effort pre-fill on form #, check #, amount. Default commission **10%**, override to 5% / 0% / store. |
| 3 | Check-in trigger | **Separate** flow (greeter, not buyer). Tied to **appointments**. License + email optional. Lookup at checkout: phone search OR pick from today's list. |
| 4 | Marketing capture | **Implicit consent** when selling. Auto-upsert into the existing `customers` table. Dedup priority: name → phone → email → license #. ⚠ See "Open risks" below. |
| 5 | Day Entry roll-up | Worksheet model. End-of-day review → submit pre-fills Day Entry. Same person checked-in + later purchased = **1 customer**. |
| 6 | Jewelry photos | Max 5 per intake. Stored as separate `intake_photos` rows (easier reorder/delete + powers buy-form lookup tool). All optional in v1. |
| 7 | Edits after save | All roles can edit. **Log every edit** (audit trail). After 3 days, locked except superadmins. Every field is editable, including form #. |

## Schema additions

### `customer_intakes` (existing table — adds these columns)

| Column | Type | Notes |
|---|---|---|
| `buy_form_number` | text | 5-digit, globally unique. `UNIQUE` constraint, partial index where not null (browse-only intakes may not have one). |
| `check_number` | text | Optional. Free-form. |
| `purchase_amount` | numeric(12, 2) | $ paid for items. Null on browse-only. |
| `commission_pct` | numeric(4, 2) | 10.00 / 5.00 / 0.00. Default 10. Stored explicitly so reports don't have to infer. |
| `commission_bucket` | text | Enum-ish: 'rate_10' / 'rate_5' / 'rate_0' / 'store'. Pre-computed from commission_pct so Day Entry roll-up is a simple GROUP BY. |
| `customer_id` | uuid | FK → `customers`. Nullable until dedup runs. |
| `appointment_id` | uuid | FK → `appointments`. Nullable. Set when intake originates from a check-in. |
| `intake_kind` | text | 'check_in' / 'purchase' / 'check_in_then_purchase'. State machine. |
| `phone` | text | Optional. |
| `email` | text | Optional. |
| `invoice_photo_url` | text | The buy form scan. Single photo. |
| `submitted_to_day_entry_at` | timestamptz | Set when the worksheet is submitted. Audit trail. |

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
| `action` | text | 'create' / 'update' / 'submit_day_entry' / 'soft_delete' |
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

1. **Mobile scan flow** — modify the existing `LicenseScanner` to add the buy form # prompt at start, invoice scan step, jewelry photos step, quick fields step.
2. **Greeter check-in screen** — new route. Lists today's appointments for the active event. Tap a row → optional license scan / email entry → mark arrived.
3. **End-of-day worksheet** — new route, scoped to today + buyer + event. Editable list. "Submit to Day Entry" button.
4. **Buy-form lookup** — new route under Admin Panel.
5. **Hub view launcher** — add 🪪 **Intake** button → opens the intake flow.

## Day Entry roll-up logic

When `Submit to Day Entry` is clicked on the worksheet:

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

- **Dedup risk: name-first ordering.** Two different "John Smith"s at the same event would merge into one customer. Mitigation: even when name matches, require phone OR license # to also match before merging. Surface a "this might be a duplicate — confirm or split" prompt.
- **Globally-unique form # across years** — if a buyer types a number that was used at an old event, we reject. Need a clear error message ("this number has been used before") + override flow for genuine reissues.
- **Mass roll-up race:** two buyers at the same event submit worksheets simultaneously — the second submit needs to add to (not replace) the first's totals. We'll do an upsert + sum on `(event_id, day_number)`.
- **Photo storage cost** — up to 5 photos × hundreds of intakes per event × dozens of events = lots of S3 / Supabase storage. Consider thumbnail + original split, or a lifecycle rule that compresses originals after 90 days.

## Phasing (proposed build order)

1. **Phase 1 — schema + buy form #.** Migration adds the new columns + `intake_photos` + `intake_audit_log`. Update existing scanner to ask for buy form # first.
2. **Phase 2 — invoice scan + quick fields.** Add the post-license steps (invoice photo, jewelry photos, $ + check # + commission entry).
3. **Phase 3 — OCR.** Best-effort OCR on the invoice scan to pre-fill form #, check #, amount.
4. **Phase 4 — worksheet.** Per-day list + edit + submit-to-Day-Entry.
5. **Phase 5 — greeter check-in.** Tied to appointments, with optional license capture.
6. **Phase 6 — buy-form lookup tool.** Search page.
7. **Phase 7 — customer dedup.** Auto-upsert into `customers` + dedup-confirm prompt.
8. **Phase 8 — audit log + 3-day edit lock.**

Each phase is its own PR. Phases 1–4 cover the core day-of workflow.

## Not in scope (explicit)

- Receipts to the customer (digital or printed).
- Payment processing (we still write paper checks).
- Item-level breakdown — one $ amount per intake, no line items.
- Connection to inventory / lots / scrap-out.
- Multi-currency.
