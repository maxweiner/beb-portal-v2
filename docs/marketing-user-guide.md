# Marketing Module — User Guide

The Marketing module manages **per‑event print campaigns** (VDP mailers,
address‑list postcards, and newspaper ads) end‑to‑end: from setting a
budget, through planning + proof approvals, to running the card and
emailing the accountant. It replaces the old "Notify Marketing" pop‑up
and the ad‑hoc email threads with one shared workspace that BEB buyers,
the outside marketing team (Collected Concepts), and approvers all
share.

---

## 1. Who can do what

| Role                                 | What they see                                                                                          |
|--------------------------------------|--------------------------------------------------------------------------------------------------------|
| **Buyer** (admin / regular user with marketing access) | Full Campaigns tab. Sets budget, notifies the team, can mark paid, can run a campaign end‑to‑end.       |
| **Marketing Team** (role `marketing`, e.g. Collected) | Campaigns tab only. Submits planning, uploads proofs, requests payment, marks campaigns paid.           |
| **Approver**                         | Same view as their base role, plus **Approve / Request Revision / Authorize Payment** buttons.          |
| **Superadmin**                       | Everything above, plus the **Settings** tab (Access, Approvers, Team Emails, Payment Methods, Lead Times, Email Templates). |
| **No marketing access**              | "🔒 Marketing access required" card — ask a superadmin to flip the switch in Settings → Access.        |

> Marketing access is governed by **`users.marketing_access`** (a boolean
> superadmins toggle in Settings) *or* having `role = 'marketing'`. Either
> one gets you in.

---

## 2. The five phases of every campaign

Every campaign — VDP, Postcard, or Newspaper — moves through the same
five phases. The sticky stepper at the top of every campaign page tells
you exactly where you are and lets you jump between phases.

```
1. Setup → 2. Planning → 3. Proofing → 4. Payment → 5. Done
   (Buyer)   (Mktg Team)   (Mktg Team)   (Mktg Team)
```

- A campaign **auto‑advances** as each phase's required action is taken.
- Completed phases auto‑collapse to a one‑line summary; click them to
  re‑open.
- A red **⚠** badge appears on the campaign list when **mail‑by** is
  ≤ 3 days away and the campaign isn't yet Paid.

---

## 3. Creating a campaign

There are two entry points:

1. **Marketing → Campaigns → `+ New Campaign`**
   Pick an event from the searchable list (filter by **0–60 / 60–90 /
   91+ days**), then pick the flow (📬 VDP, 📮 Postcard, 📰 Newspaper).
   You can also **ignore** an event from this picker — it then drops out
   of the list until "Show ignored" is selected.
2. **From an Event page** — the post‑create prompt suggests starting a
   campaign right away, pinning the event for you.

Each `(event, flow_type)` pair is unique. If the campaign already
exists, the modal swaps the submit button for **"Open existing →"**.

---

## 4. Walking through a campaign

### Phase 1 — Setup *(Buyer)*

1. Enter a **Marketing Budget** for the campaign and click **Save
   Budget**.
2. Click **📧 Notify Marketing Team** — this is the action that hands
   the campaign off to Collected. The button is disabled until a budget
   is set.
3. You'll see "✓ Notified N recipient(s)" on success. The campaign
   advances to **Planning**. You can re‑notify if you need to ping them
   again.

Recipients are configured in **Settings → Team Emails** (superadmin).

### Phase 2 — Planning *(Marketing Team, with Buyer approval)*

The planning UI differs per flow:

- **📬 VDP** — enter total VDP count + a list of 5‑digit zip codes
  (comma/space/newline OK, or upload a CSV). The form **pre‑fills from
  the most recent approved VDP campaign for the same store** so you
  rarely start from scratch.
- **📮 Postcard** — pick filter values (`max record age`,
  `max proximity`). The match count is computed live against the
  store's master address list. You can **upload a CSV** here to grow
  the master list; rows are deduped by address+zip.
- **📰 Newspaper** — enter the publication name. (Full newspaper
  planning UI is out of scope for v1 — the rest of the flow still
  works.)

Once submitted:

- Status moves to *awaiting planning approval*.
- An **approver** sees **Approve** and **Request Changes**. Request
  Changes bounces it back with a reviewer comment; Marketing edits and
  re‑submits.
- On approval, the campaign computes its **Mail‑by date** from the
  event start date + the lead time configured for that flow (see
  Settings → Lead Times), and moves to Proofing.

### Phase 3 — Proofing *(Marketing Team uploads, Approver decides)*

- Marketing uploads one or more files per **proof version**. Each
  version gets a "Uploaded N · note · uploader" header. Prior versions
  collapse under **"View version history"**.
- Anyone with access can leave **comments** on a proof.
- There's a campaign‑wide **Notes from the Marketing Team** field that
  saves as you type.
- Approvers see **Approve** or **Request Revision** on the latest
  proof. Approved proofs get an angled **"✅ Approved"** overlay on the
  preview (the actual file is never modified).
- Approval moves the campaign to **Payment**.

### Phase 4 — Payment

Three sub‑states. The UI shows only the one that applies to you.

| sub_status                  | Marketing Team sees       | Approver sees                                |
|-----------------------------|---------------------------|----------------------------------------------|
| `awaiting_payment_request`  | **💳 Request Payment**     | nothing yet                                  |
| `awaiting_payment_method`   | "Awaiting approver"       | **Pick card label + note → Authorize**       |
| `awaiting_paid_mark`        | **✓ Mark as Paid** (card + note are locked) | read‑only confirmation                       |

- Card *labels* (e.g. "Max Amex 6006") are managed in Settings → Payment
  Methods. **No card numbers** are ever stored in the system.
- **Lock‑on‑decline**: clicking "Request Payment" a second time wipes
  the prior authorization and re‑notifies approvers — useful if a card
  is declined and you need a different one.

### Phase 5 — Done

- Confetti header: "🎉 All set to Buy, Win Win Deals for All".
- An **accountant receipt PDF** is auto‑generated and emailed to the
  address in `settings.accountant_email`. The card label, note, paid
  date, and budget are all in the PDF.
- If the email gets lost, click **"Re‑send accountant receipt"** in the
  Done section to regenerate and re‑send.

---

## 5. The campaign list

- **List view (📋)** — one row per campaign, sorted at‑risk first then
  by event date. Each row shows `Store · Flow · Event Date` plus a
  colored status badge.
- **Sheet view (📊)** — a table you can scan/sort/filter quickly. The
  toggle remembers your choice per browser.

Tip: cancelled events keep their campaigns (PR #402 pauses rather than
deletes them), so a campaign for a cancelled event still resolves its
store + event date in the list and detail views.

---

## 6. Files & Artifacts

At the bottom of every campaign page, the **Files & Artifacts** card
aggregates everything stored against that campaign:

- Every proof version (file count + status), with **Open** / **Copy
  link** actions.
- Postcard CSV upload audit rows (filename, total / new / duplicate
  row counts).
- The accountant receipt PDF (once Done).

It's the one place to send a partner or auditor a complete trail.

---

## 7. Sharing with outside partners (Collected, etc.)

There are **two ways** an outside partner can interact with a campaign:

### 7a. Portal account (full access)

**Settings → Access → "Invite marketing partner"** (superadmin only).
Enter an email + name and we provision a Supabase Auth user with
`role = 'marketing'`, `marketing_access = true`. They get a magic‑link
"set your password" email from Supabase, log in, and see only the
Marketing module.

Use this for your everyday Collected operators — they need this for
proof uploads, comments, and CSV uploads (which require a real session).

### 7b. Magic link (single campaign, no login)

The "Notify Marketing Team" + planning‑decision emails contain a
**magic link** to `app.beneficialestate.com/marketing/<token>`. That
public page lets the recipient:

- View the campaign details (budget, mail‑by, current phase).
- **Submit Planning** (VDP zips/count or newspaper publication name —
  postcards still need portal login for CSV upload).
- **Request Payment** / **Mark as Paid** when those phases come up.
- Read QR shortlinks for any store assets attached to the campaign.

Approver actions (Approve / Request Revision / Authorize Payment) are
**deliberately not on magic links** — they require a real user_id for
the audit trail. Approvers do those from the portal or via the
reply‑to‑approve email flow.

Magic links expire on the date shown at the bottom of the page; ask a
BEB rep for a fresh one if it lapses.

---

## 8. Settings reference *(Superadmin only)*

`Marketing → Settings` in the portal. Six sections:

| Section            | What it does                                                                                                       |
|--------------------|--------------------------------------------------------------------------------------------------------------------|
| **Access**         | Per‑user `marketing_access` checkboxes. Also the **"Invite marketing partner"** button (Section 7a).               |
| **Approvers**      | Pick which users can Approve / Request Revision / Authorize Payment. A user is an approver if `is_active = true`. |
| **Team Emails**    | Recipients of "Notify Marketing Team" emails. These are external email addresses (e.g., Collected operators).      |
| **Payment Methods**| Card *labels* (e.g., "Max Amex 6006"). No card numbers. Archived labels stop appearing in picker dropdowns.        |
| **Lead Times**     | Days before event start to set the **mail‑by date**, per flow type. Used when planning is approved.                |
| **Email Templates**| Editable subject + body for every email the module sends (notify, planning submitted, proof ready, paid, etc.).    |

Lead Times and Email Templates take effect immediately for the **next**
event — already‑computed mail‑by dates don't retroactively change.

---

## 9. At‑a‑glance reminders / escalations

- **At‑risk badge** — a red ⚠ appears in the list when mail‑by is
  within 3 days and the campaign isn't yet Paid.
- **Cron escalations** — `app/api/cron/marketing-escalations` runs daily
  and pings approvers + the Marketing Team for any phase that's
  stalled past its expected duration.
- The Daily Briefing surfaces any campaigns blocking an upcoming event.

---

## 10. FAQ / troubleshooting

**"I clicked Notify Marketing Team but nobody got an email."**
Check **Settings → Team Emails** — the list might be empty or wrong.
Re‑click the button after fixing it; it sends each time.

**"The accountant didn't get the receipt PDF."**
Check `settings.accountant_email` is set. From the Done section, click
**"Re‑send accountant receipt"** — it regenerates and re‑sends.

**"The Approve button isn't showing for me."**
You aren't in **Settings → Approvers**. Ask a superadmin to add you (or
your `is_active` flag is off).

**"My partner can't upload a CSV via the magic link."**
That's by design. CSV uploads require a real login session. Either
upload it yourself on their behalf, or invite them as a marketing
partner (Section 7a).

**"I want to delete a campaign."**
Open the campaign → **"Delete this campaign"** link in the top‑right.
This is irreversible. Cancelling the underlying event will *pause*
campaigns instead.

**"The event for my campaign is cancelled — do I lose the history?"**
No. Cancellation pauses the campaign (PR #402). The campaign page
still resolves the store + event date and the audit trail is intact.

---

*Last updated: 2026‑05‑12. Module rebuild shipped 2026‑04‑30 in
PRs #191–#204. File locations: UI under `components/marketing/`,
APIs under `app/api/marketing/`, auth helpers in
`lib/marketing/auth.ts`, public magic‑link page at
`app/marketing/[token]/page.tsx`.*
