# BEB Portal v2 — Appointment Booking System Feature Spec

## Overview

Build an appointment booking system into the existing BEB Portal v2 (Next.js 14 / TypeScript / Supabase / Tailwind). This replaces SimplyBook.me and integrates natively with existing events, stores, and brand data. The system has three user-facing surfaces: a **customer booking page**, a **store employee portal**, and **admin management** within the existing BEB Portal.

---

## 1. Customer Booking Flow

### Entry Point
- Customer scans a QR code which encodes a permanent short URL (e.g., `{BOOKING_DOMAIN}/q/{code}`)
- The `/q/{code}` route looks up the QR record, logs the scan, and redirects to the store's booking page with source attribution
- QR codes are permanent and immutable once created — decoupled from store slugs (see Section 5 for full QR system)
- For multi-store QR codes (e.g., newspaper ads covering multiple locations), the redirect goes to a landing page where the customer picks their nearest store before entering the booking flow

### Booking Page (Responsive — Mobile & Desktop)
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
- **How did you hear about us?** (multi-select checkboxes, required)
  - Default options: Large Postcard, Small Postcard, Newspaper, Email, Text, The Store Told Me
  - Options are editable by admin in settings
  - **QR auto-fill behavior**: when arriving from a channel-specific QR, the mapped source is pre-checked and locked (greyed out, cannot uncheck). Customer can check additional sources if applicable (e.g., "Large Postcard" locked + "The Store Told Me" added)
  - When arriving from an employee QR, source is recorded as "Employee Referral" with employee attribution

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

## 5. QR Code System — Attribution & Tracking

### Architecture
- Every QR code encodes a permanent short URL: `{BOOKING_DOMAIN}/q/{code}` where `{code}` is a random 8-character alphanumeric string
- The code never changes — it is fully decoupled from store slugs, store names, or any mutable data
- The `/q/{code}` route looks up the QR record in the `qr_codes` table, logs the scan in `qr_scans`, and redirects to the appropriate booking page with `?src={code}` in the URL
- The booking page reads the `src` param to auto-fill lead source attribution
- **Custom domain recommended**: use a clean domain like `bebbuyers.com` instead of the Vercel URL. Domain is configured via `NEXT_PUBLIC_BOOKING_BASE_URL` env var and can be changed at any time — QR codes encode the path, domain is resolved at redirect time

### QR Code Types

**1. Channel QR Codes** (per store, per lead source)
- One QR per advertising channel per store (e.g., "Smith Jewelers — Large Postcard")
- Maps directly to a "how did you hear" option
- Admin selects which lead source the QR maps to via a checkbox when creating
- Reused across all events at that store — not event-specific
- When scanned: redirects to store booking page, auto-fills and locks the lead source checkbox

**2. Custom-Label QR Codes**
- Same as channel QR but with a custom label instead of mapping to a standard lead source
- Used for specific publications or campaigns (e.g., "Philadelphia Inquirer", "Spring Mailer 2026")
- Label is stored on the QR record and appears in reporting

**3. Store Group QR Codes** (multi-store, for newspaper/regional ads)
- Links to a store group — a named collection of 2+ stores
- When scanned: redirects to a landing page showing a simple list of store names/cities in the group
- Customer picks their preferred location → redirected into that store's normal booking flow
- Lead source attribution carries through from the QR to the selected store's booking
- Example: "Goodman's & Sons" group with 2 store locations, one QR in a regional newspaper ad
- A store can belong to multiple groups (e.g., different newspaper regions)

**4. Employee QR Codes**
- One QR per store employee, created by admin (not self-generated by employees)
- When scanned: redirects to store booking page, records employee attribution for spiff credit
- Lead source is recorded as "Employee Referral" with the employee's identity tracked
- Captures full scan data (device, geo, timestamp) for the employee's personal analytics
- Feeds into the employee leaderboard and spiff reporting
- If employee is deactivated: QR redirects to the store's general booking page (no attribution)

### QR Code Lifecycle

**Creation**
- Admin creates QR codes from a dedicated QR Management page (also accessible from the store detail page)
- When creating for a store, admin can select which channel QRs to generate (checkboxes for each lead source) and add more later
- Each QR is assigned a permanent `{code}`, a human-readable label/name, and linked to its store (or store group)
- Once created, the QR code and its URL are immutable — the code string cannot be changed

**Locking & Deletion Protection**
- QR codes cannot be edited after creation (only the label/name can be updated)
- Deletion requires: superadmin role + typed confirmation (e.g., type "DELETE SMITH JEWELERS LARGE POSTCARD" to confirm)
- Deleted QR codes go to a **60-day trash bin** (soft delete)
- During the 60-day trash period:
  - The QR still works — redirects to booking as normal
  - A daily digest notification is sent to superadmins if any trashed QR was scanned that day, including scan count
- After 60 days: QR is permanently purged, scanning redirects to the store's general booking page (graceful fallback, not a dead link)

### QR Code Generation & Download

**Visual Format**
- Black-and-white QR code with the store's logo embedded in the center
- Standard error correction level high enough to support the logo overlay

**Download Options**
- Formats: PNG, SVG, PDF (with print bleed marks)
- Individual download: download a single QR code
- Batch download: download all QR codes for a store as a ZIP
- All downloaded files are named based on their label: e.g., `smith-jewelers-large-postcard.png`, `smith-jewelers-philadelphia-inquirer.svg`
- PDF includes bleed marks for print-ready output

### Scan Tracking & Analytics

**Every Scan is Logged**
- Logged regardless of whether the customer completes a booking
- Data captured per scan:
  - Timestamp
  - QR code ID
  - Device type (mobile/desktop/tablet)
  - Browser / user agent
  - Rough geolocation (from browser, with permission — city/region level)
  - Referrer (if available)
  - IP hash (for deduplication tracking, not stored raw)
- Repeat scans from the same device are logged separately with individual timestamps (not deduplicated), but flagged as repeat visits for reporting

**Conversion Tracking**
- When a scan leads to a completed booking, the `qr_code_id` on the appointment links the scan to the conversion
- Same device/geo/browser data captured on the booking record for converted scans

**Analytics & Reporting** (dedicated section nested inside Reports)
- Scan volume: total scans per QR code, per store, per channel, per time period
- Conversion funnel: scans → bookings (conversion rate per QR / channel / store)
- Channel comparison: which advertising channels drive the most scans and bookings per store
- Store comparison: which stores get the most engagement from which channels
- Employee performance: scans and conversions per employee QR, feeding into the leaderboard
- Repeat scan analysis: how many people scan multiple times before booking
- Geographic distribution: where scans are coming from (city/region level)
- Device breakdown: mobile vs. desktop vs. tablet scan distribution
- Cost-per-appointment: if ad spend is tracked per channel (future enhancement), calculate ROI per channel
- Trashed QR activity: scans on deleted QR codes (included in daily superadmin digest)

### Store Groups

**Purpose**
- Allow multiple stores to share a single QR code for regional advertising (newspapers, billboards, etc.)
- Each group gets its own QR codes with their own attribution tracking

**Configuration**
- Superadmin-only creation and management
- Each group has a name (e.g., "Goodman's & Sons Network", "Denver Post Region")
- A group contains 2+ stores
- A store can belong to multiple groups (e.g., in both a "Denver Post" group and a "Colorado Springs Gazette" group)
- Each group can have multiple QR codes (one per newspaper/publication/channel)

**Customer Experience**
- Scanning a group QR → simple, fast landing page with the group name and a list of store names + cities
- Customer taps their preferred store → redirected to that store's booking page with source attribution preserved
- The landing page is responsive, minimal, fast-loading

---

## 6. Hot Show Alert

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

## 7. Phone/IVR System

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

## 8. Notifications

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

## 9. Data Model (Supabase)

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
  how_heard text[],         -- array: e.g., ['Large Postcard', 'The Store Told Me']
  qr_code_id uuid FK -> qr_codes,  -- which QR code led to this appointment (null if direct)
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

-- QR codes (permanent, immutable redirect codes)
qr_codes (
  id uuid PK,
  code text UNIQUE NOT NULL,          -- 8-char alphanumeric, immutable after creation
  store_id uuid FK -> stores,         -- null for store group QRs
  store_group_id uuid FK -> store_groups,  -- null for single-store QRs
  type text NOT NULL,                 -- 'channel' | 'custom' | 'employee' | 'group'
  lead_source text,                   -- maps to a how_heard option (e.g., 'Large Postcard')
  custom_label text,                  -- for custom-label QRs (e.g., 'Philadelphia Inquirer')
  store_employee_id uuid FK -> store_employees,  -- for employee QRs
  label text NOT NULL,                -- human-readable display name (e.g., 'Smith Jewelers — Large Postcard')
  active boolean DEFAULT true,
  deleted_at timestamptz,             -- soft delete timestamp (60-day trash bin)
  created_by uuid FK -> users,
  created_at timestamptz
)

-- QR scan log (every scan, including non-conversions)
qr_scans (
  id uuid PK,
  qr_code_id uuid FK -> qr_codes,
  scanned_at timestamptz,
  device_type text,                   -- 'mobile' | 'desktop' | 'tablet'
  user_agent text,
  geo_city text,
  geo_region text,
  geo_country text,
  geo_lat numeric,
  geo_lng numeric,
  referrer text,
  ip_hash text,                       -- hashed IP for repeat detection, not raw
  converted boolean DEFAULT false,    -- true if scan led to a completed booking
  appointment_id uuid FK -> appointments,  -- set on conversion
  is_repeat boolean DEFAULT false     -- flagged if same ip_hash scanned this QR before
)

-- Store groups (for multi-store QR codes)
store_groups (
  id uuid PK,
  name text NOT NULL,                 -- e.g., "Goodman's & Sons Network"
  created_by uuid FK -> users,
  created_at timestamptz
)

-- Store group memberships (many-to-many)
store_group_members (
  id uuid PK,
  store_group_id uuid FK -> store_groups,
  store_id uuid FK -> stores,
  UNIQUE(store_group_id, store_id)
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

## 10. API Routes (Next.js)

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

GET    /api/qr/{code}                  -- redirect: look up QR, log scan, redirect to booking
POST   /api/qr/generate                -- admin: create new QR code(s)
DELETE /api/qr/{id}                    -- admin: soft-delete QR (trash bin)
POST   /api/qr/{id}/restore            -- admin: restore from trash
GET    /api/qr/store/{store_id}        -- admin: list all QR codes for a store
GET    /api/qr/download/{id}           -- download QR image (png/svg/pdf with format param)
GET    /api/qr/download-batch/{store_id} -- download all QRs for a store as ZIP
GET    /api/qr/analytics               -- QR scan & conversion analytics (filterable)

POST   /api/store-groups               -- admin: create store group
PUT    /api/store-groups/{id}          -- admin: update group (add/remove stores)
DELETE /api/store-groups/{id}          -- admin: delete group
```

---

## 11. Pages / Routes

```
/book/{store_slug}                  -- customer booking page (public, responsive)
/book/{store_slug}/confirm/{token}  -- confirmation page after booking
/book/manage/{cancel_token}         -- cancel/reschedule page (public)
/book/group/{group_slug}            -- store group landing page (pick a location)

/q/{code}                           -- QR redirect handler (logs scan, redirects)

/store-portal/{token}               -- store employee portal (authenticated via token)

/admin/appointments                 -- admin appointment management (existing auth)
/admin/stores/{id}/booking-config   -- store booking configuration (existing auth)
/admin/stores/{id}/qr-codes         -- QR code management for a store (existing auth)
/admin/qr-codes                     -- global QR management page (existing auth)
/admin/store-groups                 -- store group management (superadmin)
/admin/reports/qr-analytics         -- QR scan & conversion analytics (nested in reports)
```

---

## 12. External Services

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

## 13. Implementation Phases (Suggested)

### Phase 1 — Core Booking + QR Foundation
- Supabase tables + RLS policies (including qr_codes, qr_scans, store_groups)
- Store booking config UI in admin
- QR code generation (channel + custom label types)
- QR redirect handler (`/q/{code}`) with scan logging
- Customer booking page (public, responsive) with QR source auto-fill
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

### Phase 3 — Store Portal + QR Expansion
- Store portal token generation
- Store employee management
- Store portal webapp (view/add/modify/delete appointments)
- Walk-in tracking
- Employee spiff dropdown
- Spiff reporting + leaderboard
- Employee QR code generation
- Store group creation + multi-store landing page
- Store group QR codes
- QR download (PNG, SVG, PDF with bleed) — individual + batch ZIP
- Logo-embedded QR code rendering
- QR trash bin UI + soft delete + 60-day purge
- Deleted QR daily scan digest notification to superadmins

### Phase 4 — Phone/IVR
- Twilio phone number provisioning
- IVR flow (TwiML / Twilio Studio)
- Dynamic store name injection in recording
- Hangup -> SMS booking link trigger
- Port existing Quo numbers or provision new ones

### Phase 5 — QR Analytics & Reporting
- QR analytics dashboard (nested inside Reports)
- Scan volume reporting (per QR, per store, per channel, per time period)
- Conversion funnel (scans → bookings, conversion rate)
- Channel comparison charts (which ad channels perform best per store)
- Store comparison (engagement across stores by channel)
- Employee QR performance (feeds into leaderboard)
- Repeat scan analysis
- Geographic distribution of scans
- Device breakdown (mobile/desktop/tablet)
- Trashed QR activity reporting
- Cost-per-appointment tracking (future: if ad spend is entered per channel)

---

## 14. Key Design Decisions

- **No individual store employee auth** — shared link per store with employee dropdown for simplicity
- **Cancel tokens** instead of auth for customer self-service — each appointment gets a unique UUID that gates access to cancel/reschedule
- **Store-level hours, event-level overrides** — minimize config while allowing flexibility
- **Brand column on appointments** — consistent with existing data isolation pattern
- **Dropdown options stored in booking_config** — editable per-store but with sensible defaults, could be made global if preferred
- **Slot blocking is per-slot, per-day** — granular control without complexity
- **Hot Show Alert fires once per event** — no repeated notifications; threshold and notification method configurable per store
- **QR codes are permanent and immutable** — decoupled from slugs via `/q/{code}` redirect pattern; domain is configurable via env var and can be changed without breaking printed codes
- **QR soft delete with 60-day trash bin** — protects against breaking printed media; QR still works during trash period; daily digest alerts superadmins to trashed QR scans
- **QR attribution auto-fills and locks lead source** — prevents customer from unchecking the known source while allowing additional sources to be checked
- **Store groups are a first-class concept** — supports multi-store newspaper ads now and scales to future regional groupings
- **Every QR scan is logged individually** — repeat scans tracked separately with timestamps, not deduplicated, enabling full funnel analysis
- **Employee QR codes are admin-created only** — prevents store employees from generating unmanaged codes

---

## 15. Technical Constraints & Conventions

- Follow existing BEB Portal patterns (see system prompt for full stack details)
- All Supabase writes go through the global session refresh in `lib/supabase.ts`
- Public pages (booking, cancel/reschedule) don't use Supabase auth — they use direct API calls or anonymous access
- Store portal uses token-based auth, not Supabase auth
- Brand column on all new tables for multi-brand filtering
- All pages are **responsive** — single build that works on mobile, tablet, and desktop. No separate mobile/desktop versions. Use Tailwind responsive breakpoints for layout adaptation.
- **DO NOT** duplicate content in MobileLayout.tsx

---

## 16. Implementation Status (as of 2026-04-24)

This section is a living rolling status. Update as work lands.

### ✅ Built and live in production

**Core booking (Phase 1)**
- Supabase migrations applied: `booking_config`, `event_booking_overrides`, `slot_blocks`, `appointments`, `appointment_employees` (renamed from `store_employees` — see deviations), `store_portal_tokens`, `notification_log`, `hot_show_alerts`. Plus column adds: `stores.slug`, `stores.color_primary`, `stores.color_secondary`, `stores.timezone`, `stores.store_image_url`, `users.notify_beb`, `users.notify_liberty`.
- `/book/[slug]` customer booking page with accordion day picker, slot grid with availability tinting + count badge, branded header (logo or diamond fallback), branded confirmation screen with 12s auto-redirect.
- `POST /api/appointments` validates slot availability, inserts row, fires confirmation.
- `getBookingPayload` server data fetch (real Supabase, with mock fallback for `demo-jewelers` slug).
- BookingConfigCard inside Stores admin: slug, brand colors, timezone, hours per day, slot interval, max-concurrent, dropdown options (items / how-heard), hot-show threshold + channels, spiff employee CRUD, store portal token generation with QR.

**Notifications + self-service (Phase 2)**
- Resend email confirmation via `lib/email.ts` (key in `settings.value` `'resend_api_key'`).
- Twilio SMS confirmation reusing existing `lib/sms.ts` (config in `settings.value` `'sms'`).
- `notification_log` writes for every send (success or failure).
- `/book/manage/[token]` cancel/reschedule page (branded, public).
- `PUT /api/appointments/[token]` for reschedule (re-validates slot excluding self, sends new confirmation).
- `DELETE /api/appointments/[token]` for cancel (sends cancellation notice).
- `POST /api/appointments/webhook/sms` Twilio inbound CANCEL handler with X-Twilio-Signature HMAC verification (skippable in dev via `SKIP_TWILIO_SIG_CHECK=true`).
- `/api/appointments/reminders` cron (every 15 min via `vercel.json`, secret-gated). Uses `date-fns-tz` `fromZonedTime` and per-store `timezone` to fire 24h and 2h reminders at correct wall-clock time.

**Store portal (Phase 3 — partial)**
- `/store-portal/[token]` token-authed page lists upcoming non-cancelled appointments grouped by day. Per-row Cancel.
- Floating + button opens an Add Appointment modal with day/slot picker, customer info, items + how-heard, spiff dropdown, walk-in checkbox.

**Calendar integration**
- New `/api/appointments/by-store/[id]` endpoint returns BEB Portal appointments in the same `Appointment` shape the existing `Calendar.tsx` consumes from Google iCal.
- `Calendar.tsx` `fetchForStore` now fetches both sources in parallel and merges, so portal bookings render alongside Google Calendar entries with no renderer changes.

**Brand-split morning report**
- `users.notify_beb` / `users.notify_liberty` flags, backfilled from `notify=true → notify_beb=true`.
- `daily-report` cron loops over both brands; each sends from its own from-address (`noreply@bebllp.com` / `noreply@libertyestatebuyers.com`) to its own opted-in recipient list.
- `morning-briefing` POST takes a `brand` body field.
- New superadmin-only **Report Recipients** admin tab with per-brand checkbox grid.

### ⚠️ Implemented with deviations from this spec

- `store_employees` table per spec was renamed in code to **`appointment_employees`** because a pre-existing `store_employees` table held different data (Beneficial buyer-to-store assignments, not store staff). The spec's wording around "store_employees" should be read as `appointment_employees` everywhere.
- **Secrets convention**: Twilio + Resend keys live in the `public.settings` table (key `'sms'` and `'resend_api_key'`), not env vars. The spec's `TWILIO_ACCOUNT_SID` etc. env block does not apply. Only `NEXT_PUBLIC_BOOKING_BASE_URL` and `CRON_SECRET` are env vars.
- **Admin UI is component-tab based** in `app/page.tsx` (nav switches between `<AdminPanel>`, `<Stores>`, `<Settings>`, etc.), not the `/admin/*` route paths in §11. New admin surfaces should be added as nav tabs, not as routes.
- **`appointments.how_heard` is currently `text` (single value)**. The new spec calls for `text[]` (multi-select with QR auto-fill / lock). Migration + UI change required when the multi-select rework lands.
- **No `appointments.qr_code_id` column yet** — depends on the QR system landing.
- **Booking page is mobile-first**, not dual-pane responsive. The new spec's §15 calls for one responsive build. Desktop layout work is open.
- **Slot grid + day picker** are the customer-facing flow only — admin-side visual slot grid for blocking (§4) is not built.
- **Reschedule UX** uses `/book/[slug]?reschedule=<token>` to reuse the booking page in a banner-led "pick a new time" mode. Spec just says "reschedule", this is the implementation.

### ❌ Not yet built (gap from this spec)

**§5 QR Code System — entirely**
- `qr_codes`, `qr_scans`, `store_groups`, `store_group_members` tables
- `/q/[code]` redirect + scan-logging route
- QR generation API (channel / custom / employee / group types)
- 60-day soft-delete trash bin with daily digest
- QR download (PNG/SVG/PDF + batch ZIP)
- Logo-embedded rendering with high error correction
- Source auto-fill / lock on the booking page
- Store group landing page at `/book/group/[group_slug]`
- Store group admin UI

**§4 Admin pages**
- Visual slot-blocking grid (per-event, blocks individual slots)
- Dedicated admin appointment management page (currently only the store portal or direct DB)
- Global "Settings" for items + how-heard options (currently per-store only)

**§3 Reporting & Gamification**
- Spiff leaderboard (counts/rankings per employee)
- Per-event / date-range filters

**§7 IVR (Phase 4)** — entirely
- Twilio phone-number provisioning per store (account work on user side first)
- TwiML route + IVR menu
- Hangup → SMS booking-link trigger
- Quo number port

**§5/Phase 5 Analytics** — entirely
- Scan volume, conversion funnel, channel comparison, employee performance, repeat-scan analysis, geo/device breakdowns, trashed-QR digest, cost-per-appointment
