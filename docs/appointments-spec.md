# BEB Portal v2 — Appointment Booking System Feature Spec

## Overview

Build an appointment booking system into the existing BEB Portal v2 (Next.js 14 / TypeScript / Supabase / Tailwind). This replaces SimplyBook.me and integrates natively with existing events, stores, and brand data. The system has three user-facing surfaces: a **customer booking page**, a **store employee portal**, and **admin management** within the existing BEB Portal.

---

## 1. Customer Booking Flow

### Entry Point
- Customer scans a **store-specific QR code** (unique URL per store, e.g., `beb-portal-v2.vercel.app/book/{store_slug}`)
- QR code is generated and attached to each store record

### Booking Page (Mobile-First, Public — No Auth)
- **Branded per store**: displays store name, logo, phone, email, and store color scheme
- No BEB/Liberty brand differentiation on booking page — it's all about the store
- Shows the **soonest upcoming event** at that store by default
- If multiple future events exist, customer can select a different one
- For multi-day events, customer picks a **day first**, then a **time slot**
- Past days within an active event are automatically hidden/disabled
- Slots are displayed in 20-minute intervals based on that store's configured hours for each day

### Booking Form Fields
- **Name** (text input, required)
- **Phone** (text input, required — used for SMS)
- **Email** (text input, required — used for email confirmation)
- **What items are you bringing?** (dropdown/multi-select, required)
  - Default options: Gold, Diamonds, Watches, Coins, Jewelry, I'm Not Sure
  - Options are editable by admin in settings
- **How did you hear about us?** (dropdown, required)
  - Default options: Large Postcard, Small Postcard, Newspaper, Email, Text, The Store Told Me
  - Options are editable by admin in settings

### Post-Booking
- Customer receives **SMS confirmation** (Twilio) and **email confirmation** (Resend)
- Confirmations include appointment details + links to reschedule/cancel
- **Reminders** sent at **24 hours** and **2 hours** before appointment
- Customer can **cancel** by:
  - Replying "CANCEL" to SMS
  - Clicking a link in SMS → cancel/reschedule page
  - Clicking a link in email → cancel/reschedule page
- Customer can **reschedule** via the link (pick new day/time within same event or future event)
- **No cancellation cutoff** — customer can cancel anytime

---

## 2. Slot Configuration

### Store-Level Defaults (set once, reused per event)
- **Hours per day**: configurable per day of a multi-day event (e.g., Day 1: 10am-5pm, Day 2: 1pm-5pm, Day 3: 10am-4pm)
- **Slot interval**: 20 minutes (default, stored as config in case it changes)
- **Max concurrent appointments per slot**: e.g., 2 or 3 (independent of number of buyers)
- These defaults apply to all events at that store unless overridden

### Event-Level Overrides
- When an event is created, it inherits the store's slot config
- Admin can override max concurrent slots per event
- Admin can override hours per day per event (rare but possible)

### Slot Blocking
- Admins and store portal users can **block individual time slots** on specific days
- Blocked slots do not appear as available on the customer booking page
- UI: **visual grid/calendar of the day's slots** with a simple click to toggle block on/off
- Visual indicator: red X, strikethrough, or similar clear "blocked" state
- No reason/note required — just unavailable
- Blocks are easily added and removed (single click)

### Availability Calculation
- Available slots = (total concurrent slots) - (booked appointments) - (blocked slots)
- If available = 0, slot shows as full/unavailable to customer

---

## 3. Store Employee Portal

### Access
- **One shared authenticated link per store** (e.g., `beb-portal-v2.vercel.app/store-portal/{store_token}`)
- No individual employee logins — shared access per store
- Authenticated via a unique token/link (not Supabase auth — simpler)

### Capabilities
- **View** all appointments for their store's upcoming/current events
- **Add** new appointments (for phone-in or walk-in customers)
- **Modify** existing appointments (change time/day)
- **Delete/Cancel** appointments
- **Add walk-ins** to the system for tracking and future marketing

### Employee Spiff Tracking
- When adding an appointment, a **dropdown selects the store employee** who gets credit
- Store employees are maintained as a list per store (admin-managed)
- Each appointment records which employee created it / gets spiff credit
- **QR code for on-the-fly booking**: employees can scan a QR on their phone to quickly add appointments with the employee dropdown

### Reporting & Gamification
- Simple **report** showing appointments created per employee
- **Leaderboard** for friendly competition — ranked by number of appointments booked
- Filterable by event / date range
- Could include bonus prize thresholds (future enhancement)

---

## 4. Admin Management (Inside BEB Portal)

### Store Booking Config (new section on store management page)
- Set default hours per event day (Day 1, Day 2, Day 3 schedules)
- Set max concurrent appointments per slot
- Set slot interval (default 20 min)
- Manage store employee list (add/remove/edit names)
- Upload/manage store logo
- Set store color scheme for booking page
- Set store phone and email for booking page display
- Generate/view QR code for customer booking link
- Generate/view QR code for store employee portal link

### Event Booking Config (on event detail/edit page)
- Inherits store defaults, shows overridable fields
- Override max concurrent slots
- Override hours per day
- Visual slot grid showing booked / available / blocked slots per day
- Block/unblock individual slots

### Appointment Management
- View all appointments per event/store
- Filter by day, status (confirmed, cancelled, completed)
- Search by customer name/phone
- Add/edit/cancel appointments
- View customer details and source tracking (how-heard, items)

### Settings (global)
- Edit "What items are you bringing?" dropdown options
- Edit "How did you hear about us?" dropdown options

---

## 5. Hot Show Alert

### Overview
Monitors total appointment bookings for a store's event. When the percentage of booked slots across the entire event crosses a configurable threshold, superadmins receive a one-time notification. This signals high-demand events so the team can react (add buyers, extend hours, etc.).

### Configuration (per store, on the Appointment Settings page)
- **Threshold percentage**: configurable per store (e.g., 75%, 80%, 90%)
- **Notification method**: SMS, email, or both — configurable in settings
- **Recipients**: all users with `role = 'superadmin'`

### Trigger Logic
- After every new appointment is created (via customer booking, store portal, or admin), recalculate:
  - `total_slots` = sum of all available slot capacity across all days of the event (accounting for hours, interval, and max concurrent — minus blocked slots)
  - `booked_slots` = count of confirmed appointments for that event
  - `booked_percentage` = booked_slots / total_slots * 100
- If `booked_percentage >= threshold` **and** the alert has not already fired for this event → send notification and mark as fired
- **One-time only**: once the threshold is crossed for an event, no further alerts are sent for that event (even if appointments are cancelled and it dips below, then crosses again)

### Notification Content
- Channel: SMS and/or email per store config
- Message: "Hot Show Alert: {store_name} event ({event_dates}) is {X}% booked ({booked}/{total} slots). Consider adding capacity."
- Sent to all superadmins

---

## 6. Phone/IVR System

### Overview
- Each store has a **dedicated phone number**
- When a customer calls, they hear an **automated recording**
- Recording says the store name (dynamically injected) and offers options:
  - Press [X] for [action TBD]
  - Or hang up and receive an SMS with the booking link
- If customer hangs up, system **sends SMS** with store-specific booking URL

### Implementation
- **Twilio** (replacing Quo) for phone numbers + programmable voice + SMS
- TwiML or Twilio Studio for IVR flow
- Text-to-speech or pre-recorded audio with store name injection
- Webhook to trigger SMS send with booking link on hangup
- Each store's Twilio number is stored in the stores table

### Provider Migration
- Current: Quo (expensive, not integrated)
- Target: Twilio (or potentially SIP trunks to 3CX — decision pending)
- Need to port existing phone numbers or get new ones

---

## 7. Notifications

### SMS (Twilio)
- **Confirmation** on booking (includes appointment details + cancel/reschedule link)
- **Reminder** at 24 hours before
- **Reminder** at 2 hours before
- **Two-way SMS**: customer can reply CANCEL to cancel
- Inbound SMS webhook processes replies and updates appointment status

### Email (Resend — already set up)
- **Confirmation** on booking (includes appointment details + cancel/reschedule link)
- **Reminder** at 24 hours before
- **Reminder** at 2 hours before
- Sent from existing Resend setup (bebllp.com domain)

### Notification Log
- All sent notifications logged in Supabase for debugging/audit
- Status tracking (sent, delivered, failed)

---

## 8. Data Model (Supabase)

### New Tables

```sql
-- Store booking configuration (one per store)
booking_config (
  id uuid PK,
  store_id uuid FK -> stores,
  slot_interval_minutes int DEFAULT 20,
  max_concurrent_slots int DEFAULT 3,
  day1_start time,        -- e.g., '10:00'
  day1_end time,          -- e.g., '17:00'
  day2_start time,
  day2_end time,
  day3_start time,
  day3_end time,
  store_logo_url text,
  store_color_primary text,
  store_color_secondary text,
  store_booking_phone text,
  store_booking_email text,
  items_options jsonb DEFAULT '["Gold","Diamonds","Watches","Coins","Jewelry","I''m Not Sure"]',
  hear_about_options jsonb DEFAULT '["Large Postcard","Small Postcard","Newspaper","Email","Text","The Store Told Me"]',
  hot_show_threshold int DEFAULT 80,            -- percentage (e.g., 80 = 80%)
  hot_show_notify_sms boolean DEFAULT true,
  hot_show_notify_email boolean DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
)

-- Event-level booking overrides (one per event, optional)
event_booking_overrides (
  id uuid PK,
  event_id uuid FK -> events,
  max_concurrent_slots int,          -- null = use store default
  day1_start time,                   -- null = use store default
  day1_end time,
  day2_start time,
  day2_end time,
  day3_start time,
  day3_end time,
  created_at timestamptz,
  updated_at timestamptz
)

-- Individual slot blocks
slot_blocks (
  id uuid PK,
  event_id uuid FK -> events,
  block_date date,
  block_time time,          -- the start time of the blocked slot
  created_by uuid FK -> users,
  created_at timestamptz
)

-- Appointments
appointments (
  id uuid PK,
  event_id uuid FK -> events,
  store_id uuid FK -> stores,
  brand text,               -- 'beb' | 'liberty'
  appointment_date date,
  appointment_time time,
  customer_name text,
  customer_phone text,
  customer_email text,
  items_bringing text[],    -- array of selected items
  how_heard text,
  status text DEFAULT 'confirmed',  -- confirmed | cancelled | completed | no_show
  cancel_token uuid,        -- unique token for cancel/reschedule links
  booked_by text DEFAULT 'customer',  -- 'customer' | 'store' | 'admin'
  store_employee_id uuid FK -> store_employees,  -- who gets spiff credit
  is_walkin boolean DEFAULT false,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)

-- Store employees (for spiff tracking)
store_employees (
  id uuid PK,
  store_id uuid FK -> stores,
  name text,
  active boolean DEFAULT true,
  created_at timestamptz
)

-- Store portal access tokens
store_portal_tokens (
  id uuid PK,
  store_id uuid FK -> stores,
  token text UNIQUE,        -- random token for URL
  active boolean DEFAULT true,
  created_at timestamptz
)

-- Notification log
notification_log (
  id uuid PK,
  appointment_id uuid FK -> appointments,
  type text,                -- 'sms_confirmation' | 'email_confirmation' | 'sms_reminder_24h' | 'sms_reminder_2h' | 'email_reminder_24h' | 'email_reminder_2h'
  channel text,             -- 'sms' | 'email'
  recipient text,           -- phone or email
  status text,              -- 'sent' | 'delivered' | 'failed'
  provider_id text,         -- Twilio SID or Resend ID
  sent_at timestamptz,
  error_message text
)

-- Hot Show Alert tracking (one per event, fires once)
hot_show_alerts (
  id uuid PK,
  event_id uuid FK -> events UNIQUE,  -- one alert record per event
  store_id uuid FK -> stores,
  threshold_pct int,                  -- the threshold that was crossed
  booked_pct int,                     -- actual percentage when triggered
  booked_count int,
  total_slots int,
  notified_via text[],                -- ['sms', 'email']
  fired_at timestamptz
)
```

### Modifications to Existing Tables

```sql
-- stores table: add slug for booking URL
ALTER TABLE stores ADD COLUMN slug text UNIQUE;
-- slug is used in booking URL: /book/{slug}

-- events table: no changes needed
-- Events already have start_date, store_id, brand
-- Day-specific data comes from event_days table
-- Hours come from booking_config (store level) or event_booking_overrides
```

---

## 9. API Routes (Next.js)

```
POST   /api/appointments              -- create appointment (public)
GET    /api/appointments/{cancel_token} -- get appointment for cancel/reschedule page
PUT    /api/appointments/{cancel_token} -- reschedule appointment
DELETE /api/appointments/{cancel_token} -- cancel appointment
GET    /api/appointments/slots         -- get available slots for event+date (public)
POST   /api/appointments/webhook/sms   -- Twilio inbound SMS webhook
POST   /api/appointments/reminders     -- cron job to send reminders (Vercel cron)

GET    /api/store-portal/{token}/appointments  -- store portal: list appointments
POST   /api/store-portal/{token}/appointments  -- store portal: add appointment
PUT    /api/store-portal/{token}/appointments/{id} -- store portal: modify
DELETE /api/store-portal/{token}/appointments/{id} -- store portal: cancel

POST   /api/twilio/voice               -- TwiML for IVR
POST   /api/twilio/hangup-sms          -- send booking link on hangup
```

---

## 10. Pages / Routes

```
/book/{store_slug}                  -- customer booking page (public, mobile-first)
/book/{store_slug}/confirm/{token}  -- confirmation page after booking
/book/manage/{cancel_token}         -- cancel/reschedule page (public)

/store-portal/{token}               -- store employee portal (authenticated via token)

/admin/appointments                 -- admin appointment management (existing auth)
/admin/stores/{id}/booking-config   -- store booking configuration (existing auth)
```

---

## 11. External Services

| Service | Purpose | Status |
|---------|---------|--------|
| **Twilio** | SMS (2-way), phone numbers, IVR | New — needs setup |
| **Resend** | Email confirmations & reminders | Existing — already configured |
| **Vercel Cron** | Trigger reminder sends | Existing infra |
| **Supabase** | All data storage | Existing |

### Environment Variables Needed
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=   # or individual numbers per store
NEXT_PUBLIC_BOOKING_BASE_URL=   # base URL for booking links in SMS/email
```

---

## 12. Implementation Phases (Suggested)

### Phase 1 — Core Booking
- Supabase tables + RLS policies
- Store booking config UI in admin
- Customer booking page (public, mobile-first)
- Available slot calculation logic
- Appointment creation API
- Basic email confirmation via Resend

### Phase 2 — Notifications & Self-Service
- Twilio SMS integration (confirmation + reminders)
- Vercel cron for reminder scheduling
- Cancel/reschedule page + API
- Two-way SMS (CANCEL reply handling)
- Slot blocking UI
- Hot Show Alert logic + notification to superadmins

### Phase 3 — Store Portal
- Store portal token generation
- Store employee management
- Store portal webapp (view/add/modify/delete appointments)
- Walk-in tracking
- Employee spiff dropdown
- Spiff reporting + leaderboard

### Phase 4 — Phone/IVR
- Twilio phone number provisioning
- IVR flow (TwiML / Twilio Studio)
- Dynamic store name injection in recording
- Hangup -> SMS booking link trigger
- Port existing Quo numbers or provision new ones

---

## 13. Key Design Decisions

- **No individual store employee auth** — shared link per store with employee dropdown for simplicity
- **Cancel tokens** instead of auth for customer self-service — each appointment gets a unique UUID that gates access to cancel/reschedule
- **Store-level hours, event-level overrides** — minimize config while allowing flexibility
- **Brand column on appointments** — consistent with existing data isolation pattern
- **Dropdown options stored in booking_config** — editable per-store but with sensible defaults, could be made global if preferred
- **Slot blocking is per-slot, per-day** — granular control without complexity
- **Hot Show Alert fires once per event** — no repeated notifications; threshold and notification method configurable per store

---

## 14. Technical Constraints & Conventions

- Follow existing BEB Portal patterns (see system prompt for full stack details)
- All Supabase writes go through the global session refresh in `lib/supabase.ts`
- Public pages (booking, cancel/reschedule) don't use Supabase auth — they use direct API calls or anonymous access
- Store portal uses token-based auth, not Supabase auth
- Brand column on all new tables for multi-brand filtering
- Mobile-first for customer booking page
- Desktop-optimized for admin and store portal (but responsive)
- **DO NOT** duplicate content in MobileLayout.tsx

---

## 15. Reality Check — Deltas From Existing Codebase

This section captures gaps between the spec above and the actual state of `beb-portal-v2` as of 2026-04-23. Treat the items below as overrides to anything earlier in this document that conflicts.

### 15.1 Twilio is already partially integrated — reuse, don't reinvent
- `lib/sms.ts` already implements `sendSMS(to, body)` and `formatPhone(phone)` against Twilio's REST API.
- It is consumed today by `app/api/day-entry/route.ts` (daily briefing SMS) and `app/api/test-sms/route.ts`.
- All appointment SMS (confirmation, 24h/2h reminders, hot-show alerts) MUST call `sendSMS` from `lib/sms.ts` rather than introducing a second Twilio client.
- The two-way SMS inbound webhook (CANCEL handling) and TwiML/IVR routes are still net-new.

### 15.2 Secrets live in the `settings` Supabase table — not `.env`
- Twilio config: row in `settings` with key `'sms'`, JSON value `{ accountSid, authToken, fromNumber }`.
- Resend API key: row in `settings` with key `'resend_api_key'`.
- This **supersedes** the `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_MESSAGING_SERVICE_SID` block in §11. Do not introduce those env vars; read from `settings`.
- The only new env var actually needed is `NEXT_PUBLIC_BOOKING_BASE_URL` (used to build cancel/reschedule links).
- If per-store Twilio numbers are introduced for IVR (Phase 4), store them on the `stores` row (e.g. `twilio_number`) rather than `settings`.

### 15.3 Admin UI is component-tab based, not route-based
- There is no `app/admin/*` directory. `app/page.tsx` renders different components based on a nav tab (`AdminPanel`, `Stores`, `Settings`, etc.), each guarded by `RoleGuard`.
- §10 routes `/admin/appointments` and `/admin/stores/{id}/booking-config` should instead become:
  - A new **`Appointments`** nav tab (component) for global appointment management.
  - A new **booking-config section/modal inside `components/stores/Stores.tsx`** for per-store config.
- All other public/store-portal routes in §10 (`/book/*`, `/store-portal/[token]`) remain as actual file-system routes under `app/`.

### 15.4 Stores fields already exist — reuse before duplicating
- `stores` already has: `qr_code_url`, `owner_phone`, `owner_email`, `store_image_url`, plus address/lat/lng.
- Decision: reuse `owner_phone` / `owner_email` as the booking-page contact info by default; only add a separate booking_phone/booking_email override if a store explicitly needs different numbers. Drop `store_booking_phone` and `store_booking_email` from `booking_config` for now.
- For branding visuals, `store_image_url` covers logo. Add `color_primary` / `color_secondary` columns directly on `stores` (not on `booking_config`) since they are intrinsic store identity, not booking-only.
- `stores.slug` is still net-new and must be added.

### 15.5 Cron auth pattern
- Existing convention (see `vercel.json`): cron URLs include `?secret=<value>` and the handler validates against `CRON_SECRET` env var.
- The reminder cron (`/api/appointments/reminders`) MUST follow this pattern — not a header-based check.

### 15.6 Migrations
- Migrations are flat `supabase-migration-*.sql` files at the repo root with no numeric prefix — they are not auto-applied. The user runs them manually in the Supabase SQL editor.
- Create one new file per logical change, e.g. `supabase-migration-appointments.sql`, `supabase-migration-store-booking-config.sql`. Keep each runnable independently.

### 15.7 Missing dependency: QR-code generation
- No QR library is currently in `package.json`. Add `qrcode` (server-side) and/or `qrcode.react` (client-side) when implementing the QR generation in §4.

### 15.8 Note on the existing `notify_sms` flag
- `users.notify_sms` already exists (added by `supabase-migration-sms-notifications.sql`) and is used to opt admins into briefing SMS. The hot-show-alert recipient logic (§5) should respect this flag for SMS delivery to superadmins, in addition to the per-store `hot_show_notify_sms` toggle.
