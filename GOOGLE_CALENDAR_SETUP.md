# Google Calendar Sync — Setup Guide

One-way sync from BEB Portal events → two Google Calendars (one per brand).
After this is wired up, every event you create in the portal automatically
appears in the right Google Calendar within ~1 minute. Edits and deletes
follow the same path.

> **One-way only.** Editing the event directly in Google Calendar will be
> overwritten the next time the portal touches it. Treat the calendars as
> read-only mirrors.

---

## One-time Google Workspace setup (superadmin)

### 1. Create a Google Cloud project + service account

1. Go to https://console.cloud.google.com → create or pick a project (e.g. `beb-portal`).
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **IAM & Admin → Service accounts → Create service account**.
   - Name: `beb-portal-calendar-sync`.
   - No roles needed (Calendar permissions come from sharing the calendar with this account).
4. On the new service account → **Keys → Add key → JSON**. Download the file.
5. Open the JSON. The whole thing is your secret — copy the entire contents.
6. Add a Vercel env var named **`GOOGLE_SERVICE_ACCOUNT_JSON`** with the JSON as the value (paste the whole `{ ... }` blob). Set it for Production + Preview + Development.
7. The service account's `client_email` looks like `beb-portal-calendar-sync@your-project.iam.gserviceaccount.com`. **Copy this address — you need it in step 3.**

### 2. Create the two calendars

In Google Calendar (signed in as a `bebllp.com` Workspace user that owns your shared calendars):

1. Sidebar → **Other calendars → + → Create new calendar**.
2. Create **Beneficial Events**. Set timezone to America/New_York (or whichever fits your team).
3. Create **Liberty Events** the same way.

### 3. Share each calendar with the service account

1. Open **Beneficial Events** → **Settings and sharing** → **Share with specific people or groups → Add people**.
2. Paste the service account `client_email` from step 1.7.
3. Set permission to **Make changes to events**. Save.
4. Repeat for **Liberty Events**.

### 4. Find each Calendar ID

1. Same settings page → **Integrate calendar** section → copy the **Calendar ID**. It looks like `c_abcd1234efgh5678@group.calendar.google.com`.
2. You'll paste these into the portal's Settings → Google Calendar Sync page (per brand).

### 5. Configure in the portal (superadmin)

1. Sign into BEB Portal as a superadmin.
2. **Admin → Settings → Google Calendar Sync** (added in PR 2).
3. For each brand:
   - Paste the Calendar ID from step 4.
   - Click **Test connection** — creates and immediately deletes a tiny dummy event to confirm the service account has write access.
   - If green ✓ Connected, flip the **Enabled** toggle on.
4. Click **Sync all events now** to push the existing event history (past + future) into the calendar. The status panel shows progress.

After the first sync, every create / update / delete on an event automatically syncs within ~1 minute via the every-minute Vercel cron.

---

## End-user setup (anyone who wants to view the calendar)

Each user subscribes to the calendar in their personal Google Calendar:

1. https://calendar.google.com → sidebar → **Other calendars → + → Subscribe to calendar**.
2. Paste the Calendar ID for the brand they want to follow (Beneficial or Liberty).
3. Done. The events show up in their calendar, color-coded by brand.

For email staff who don't use Google Calendar, the same Calendar ID works as an iCal URL via the "Public address in iCal format" link in the calendar's settings → that URL can be subscribed to from Apple Calendar, Outlook, etc.

---

## Maintenance

### Rotating the service account key

1. Generate a new JSON key on the service account in Google Cloud.
2. Update the `GOOGLE_SERVICE_ACCOUNT_JSON` env var in Vercel.
3. Redeploy (or trigger a re-deploy by pushing). No code changes.
4. Delete the old key in Google Cloud once the new one is verified working (run **Test connection** in Settings).

### Recovering after a calendar gets out of sync

If anyone manually edited the Google Calendar and you want to restore it to match the portal:
1. **Settings → Google Calendar Sync → [brand] → Sync all events now**. This re-pushes every portal event over whatever's in the calendar.

### Cron / queue health

The processor lives at `/api/cron/process-gcal-sync` and runs every minute via Vercel cron (registered in `vercel.json`). The queue table is `gcal_sync_queue`. Failed rows (after 3 retries) sit with `status='failed'` and surface in the Settings activity panel for manual retry.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Test connection" → `403 Forbidden` | Calendar isn't shared with the service account, OR the wrong Calendar ID was pasted |
| "Test connection" → `404 Not Found` | Wrong Calendar ID |
| Events not appearing | Toggle off, OR queue is failing — check **Recent activity** in Settings |
| Repeated failures | Service account JSON env var malformed, or Google API quotas exceeded |
| Old events also appeared | Initial backfill includes the full history by design |
