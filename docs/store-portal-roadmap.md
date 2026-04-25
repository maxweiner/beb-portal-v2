# Store Portal UX, PWA, Welcome Email & Edit Flow Roadmap

Source: Max's spec dated 2026-04-24. This is the canonical roadmap for the
next batch of work on the store-portal experience and the notification
infrastructure. Sections are sized to be commits.

## Status legend

- ✅ shipped — already in production
- 🟡 partial — some pieces shipped, more open below
- ⬜ not started

## Sections

### 1. iPhone safe-area fix
🟡 In progress this commit. Adds `viewport-fit=cover` + `env(safe-area-inset-*)` padding to header so the notch / Dynamic Island stops clipping content.

### 2. PWA support
🟡 The root layout already exports `appleWebApp` metadata + a `manifest.json` ("BEB Buyer Portal"). Open work: separate Liberty manifest + icon, multi-size (192, 512) PNGs.

### 3. Add to Home Screen instructions
⬜ Dedicated `/install` page with screenshot-style text instructions. Linked from welcome email + portal header.

### 4. Appointment edit / cancel flow
🟡 Cancel + reschedule already work via `/api/appointments/[token]`. Open: rename row "Delete" → "Edit" everywhere, full edit page with slot revalidation, the 30-min contact-info change debounce queue, separate Cancelled tab, immediate slot release.

### 5. Welcome / onboarding email
⬜ Manual-send button on the Store Employee Management section. Recipient picker (employees + owner). Editable template via §7. Resend open tracking webhook → `welcome_email_log`.

### 6. Phone number auto-formatting
✅ Done (commit `0c8fced`). Shared `<PhoneInput>` + `formatPhoneDisplay`, raw digits in DB, backfill migration applied.

### 7. Notification template editor
🟡 The reports editor (`report_templates`) ships a similar pattern for report copy. Notification templates are a separate table with the channel/dynamic-field model below — needs its own admin page.

### 8. Data model additions
- `notification_templates` (template_key, channel, subject, body, …)
- `welcome_email_log` (per-recipient send + open timestamps + Resend message id)
- `notification_queue` (delayed sends — 30-min contact-change debounce)
- `appointments.how_heard_locked text[]` (which sources came from a QR and stay locked on edit)

### 9. New API routes
- `POST /api/welcome-email/send` + `GET /api/welcome-email/status/{store_id}` + `POST /api/welcome-email/webhook/open`
- `GET / PUT / POST` on `/api/notification-templates/*`
- `POST /api/notification-queue/process` (Vercel cron, every ~5 min)

### 10. Implementation notes
- Resend open tracking via webhook → updates `welcome_email_log.opened_at`.
- Delayed queue: cron checks `scheduled_for <= now() AND status='pending'`. On contact change, upsert by `(appointment_id, template_key)` — reset `scheduled_for` to `now() + 30 min` rather than create a new row.
- PWA manifest: dynamic per brand (BEB vs Liberty) so the home-screen icon matches the brand. Or two static manifests linked conditionally.
- Add-to-home screenshots: capture on real iPhone, store under `/public/images/onboarding/`.
