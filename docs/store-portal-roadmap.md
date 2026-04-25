# Store Portal UX, PWA, Welcome Email & Edit Flow Roadmap

Source: Max's spec dated 2026-04-24. Status of each section as of latest commits.

## Status legend

- ✅ shipped — already in production
- 🟡 partial — some pieces shipped, more open below
- ⬜ not started

## Sections

### 1. iPhone safe-area fix
✅ Shipped (`4356541`). Next 14 viewport export with `viewport-fit=cover` + `padding-top: max(env(safe-area-inset-top), 32px)` on every customer-facing header (Store Portal, /book/[slug], /book/manage/[token], NoEventsPage).

### 2. PWA support
✅ Shipped (`7e2d47d`, `4298f5b`). Multi-size icons under `/public/icons/` (180/192/512 + maskable). `manifest.json` updated with description, scope, orientation, cream background. Liberty-specific manifest + icon still open until Max provides Liberty artwork.

### 3. Add to Home Screen instructions
✅ Shipped (`4356541`). `/install` page with 5 numbered steps, linked from the Store Portal subtitle. Real iPhone screenshots can drop in later under `/public/images/onboarding/`.

### 4. Appointment edit / cancel flow
✅ Shipped (`ced9686`).
- PUT `/api/appointments/[token]` accepts every editable field (customer info / items / how_heard / employee / walk-in / notes), not just date+time.
- Per-row "Cancel" → "Edit" button on the store portal. New `EditAppointmentModal` pre-fills everything, validates the new slot excluding self, surfaces a destructive "Cancel appointment" action at the bottom of the form (releases the slot immediately, sends cancellation notice).
- Upcoming / Cancelled tab toggle. Cancelled rows render dimmed and read-only.
- 30-minute contact-info debounce: on phone/email change without a date/time change, an upsert into `notification_queue` schedules `contact_info_updated` for `now() + 30 min`. Subsequent edits push the timestamp back. Cron at `/api/notification-queue/process` runs every 5 min.

### 5. Welcome / onboarding email
✅ Shipped (`f5c2185`).
- `welcome_email_log` table tracks send + open per recipient.
- POST `/api/welcome-email/send` loads `email_welcome` from `notification_templates`, substitutes `{{employee_name}}` / `{{store_name}}` / `{{portal_link}}` per recipient, sends via Resend, logs the message id.
- GET `/api/welcome-email/status/[store_id]` returns the latest send/open per recipient (powers the badges in the admin UI).
- POST `/api/welcome-email/webhook/open` consumes Resend's `email.opened` webhook and stamps `opened_at`. Configure the webhook in Resend dashboard pointing at `/api/welcome-email/webhook/open`.
- New `WelcomeEmailSender` component sits at the bottom of the Store Employees card with checkboxes per recipient (owner first, then employees with email), Sent / Opened status badges, and a Send button.
- Refuses to send if the store doesn't have an active store-portal token — the link would dead-end otherwise.

### 6. Phone number auto-formatting
✅ Done (`0c8fced`). Shared `<PhoneInput>` + `formatPhoneDisplay`, raw digits in DB, backfill migration applied.

### 7. Notification template editor
✅ Shipped (`25904dc`).
- `notification_templates` table seeded with rows for all 11 system notifications (confirmation/reminder24h/reminder2h/cancellation/contact_info_updated × SMS+email, plus email_welcome).
- `lib/appointments/notifications.ts` loads each template at send time with hardcoded fallbacks. Subjects + bodies use `{{variable}}` placeholders substituted from a per-call vars bag. Email bodies wrapped in the standard shell at send time so admins can edit copy without breaking the layout.
- New superadmin-only **Notification Templates** sidebar tab. Lists templates by channel, click opens an editor with subject + body inputs and a live preview pane (iMessage-style bubble for SMS, sandboxed iframe for email).

### 8. Data model additions
- ✅ `notification_queue` (commit `ced9686`)
- ✅ `notification_templates` (commit `25904dc`)
- ✅ `welcome_email_log` (commit `f5c2185`)
- ⬜ `appointments.how_heard_locked text[]` (deferred — currently any source on the row can be edited; QR-locked-on-edit semantics tracked via the booking page only)

### 9. New API routes
- ✅ POST `/api/welcome-email/send`, GET `/api/welcome-email/status/[store_id]`, POST `/api/welcome-email/webhook/open`
- ✅ POST `/api/notification-queue/process` (Vercel cron `*/5 * * * *`)
- ⬜ Admin REST routes for `notification_templates` (the editor uses Supabase RLS directly — no need for a route layer)

### 10. Implementation notes
- Migrations to run in Supabase SQL Editor (in this order):
  1. `supabase-migration-notification-queue.sql`
  2. `supabase-migration-notification-templates.sql`
  3. `supabase-migration-welcome-email-log.sql`
- Configure Resend webhook (`email.opened` event) → `https://beb-portal-v2.vercel.app/api/welcome-email/webhook/open`
- Liberty-branded PWA manifest + icon: deferred until Max provides artwork.
- Real iPhone screenshots for `/install`: capture on a device, drop into `/public/images/onboarding/`.
