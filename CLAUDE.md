# BEB Portal v2 — project context for Claude Code

> Loaded automatically into every Claude Code session that runs from a clone of this repo. Edit when project conventions change.

## What this is

- **Next.js 14 App Router** running on **Vercel** under the `beneficialestate` team.
- Production domain: `portal.bebllp.com`.
- Backend: **Supabase Postgres** (RLS-heavy) + Storage + Realtime + cron via Vercel.
- Two brands, switched globally via `useApp().brand`: `'beb'` (Beneficial Estate Buyers — buying-events business) and `'liberty'` (Liberty Estate Buyers — wholesale inventory business).
- Email: **Resend** (NOT Postmark). API key lives in the `settings` table key=`email`.
- PDFs: `@react-pdf/renderer` rendered server-side via `renderToBuffer`.
- SMS: Twilio toll-free; **explicit per-row consent required** (`sms_opted_in` boolean on every public booking).

## Tech essentials

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run build
```

Env vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`. Resend key is read from the `settings` table at runtime, not the env.

## Critical conventions

### Database & RLS

- **Auth_id-first lookups**: `get_effective_user_id()` matches `auth.uid()` against `users.auth_id` first, falling back to `users.email = auth.jwt()->>'email'`. Use it — never inline an email match in RLS.
- **Role checks**: never gate on `role = 'admin'` alone (silently filters superadmins). Use `has_any_role(...)` or `role IN ('admin', 'superadmin')`.
- **`is_partner`** boolean on `users` table — `users.is_partner = true` for Max / Joe / Rich. Don't treat partner as a role.
- **Multi-role**: `user_roles` join table holds extra roles. `has_any_role(...)` reads it.
- **`role_modules`** drives sidebar + page visibility. Settings → 🛡️ Role Manager (max@bebllp.com only) edits it.
- **SQL migrations** live as `supabase-migration-*.sql` at the repo root. **They are NOT auto-applied.** After merging a PR that adds one, manually run it in the Supabase Dashboard SQL editor before declaring the feature done. ALWAYS copy migration content to the operator's clipboard with `pbcopy` and report line count.
- **`FOR ALL` RLS policies** with `auth.users` joins fail at PLAN time regardless of bucket — be very careful with Storage policies.
- **Cancelled-event filter**: `status <> 'cancelled' AND cancelled_at IS NULL` (legacy rows only set one). Reference impl at `lib/context.tsx:467`.

### Money

- **Whole-dollar policy (2026-05-15)** on these columns: `inventory_items.cost_cents`, `wholesale_price_cents`, `retail_price_cents`, `edge_price_cents`, `wholesale_memo_lines.memo_price_cents`, `wholesale_invoice_lines.sale_price_cents`, `buyer_checks.amount`. UI rejects fractional cents; existing rows were rounded.
- **Still allows cents**: insurance valuation, invoice payments (must match the actual ACH/wire/check cents), all expense / receipt totals.
- Helpers: `dollarsToWholeCents` + `centsToWholeDollarsString` in `lib/wholesale/format.ts`.

### Forms

- `globals.css` has a generic `input` rule that historically broke raw `<input type="checkbox/radio">`. PR #652 scoped it to exclude checkbox / radio / file / color / range / buttons. Raw checkboxes render natively; the shared `<Checkbox />` component is still preferred for visual consistency.

## Module map

| Module | Key files | Notes |
|---|---|---|
| Buying Events Hub | `components/events/HubView.tsx`, `BuyingEventsView.tsx` | Default view; launcher grid per event; users can hide/reorder via Customize modal. Legacy view hidden 2026-05-15. |
| Marketing | `components/marketing/*`, `app/api/marketing/*` | VDP / Postcard / Newspaper campaigns. Magic-link emails point at `/?nav=marketing&campaign=<id>`. 30-day magic-link TTL. |
| Customers | `components/customers/*` | Per-store DB. Phone-first booking + `🔁 Repeat` chip when phone matches. |
| Appointments | `components/appointments-admin/*`, `app/book/[slug]/*`, `app/store-portal/[token]/*` | Public booking (QR / URL), staff portal, admin. SimplyBook.me replacement. |
| Wholesale (Liberty-only) | `components/wholesale/*` | Inventory + memos + invoices + Send-to-Edge. |
| Send to Edge | `components/wholesale/EdgeSendView.tsx`, `lib/wholesale/edge*.ts` | Liberty-only. Emails Mary Moses CSV + photos. Vendor info + retail price scrubbed from outgoing CSV. |
| Shipping | `components/shipping/*` | Per-event box-return tracking. No-hold stores ship immediately (start_date + 3). |
| White Sheet OCR | `components/whitesheets/*`, `lib/white-sheets/*`, `app/api/cron/process-white-sheets/*` | PDF upload → split → Claude vision OCR → auto-commit or review pile. BATCH_SIZE=3 to stay under Anthropic's 30K-TPM org cap. |
| Expenses | `components/expenses/*` | Trip=event. Reminders only after event end. Resend (not Postmark). React-PDF accountant emails. Delegates supported (Settings → 🤝 Expense Delegates). |
| Reconciliation | `components/reconciliation/*` | Check register sync. Whole-dollar enforcement. |

## Workflow

- **Every change is a PR.** Branch off `main`, push, open PR, merge with `gh pr merge <N> --squash --delete-branch`.
- **Commits**: end the message with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` per the harness convention.
- **One feature per PR.** Don't bundle unrelated fixes.
- **SQL migrations are NOT applied by merging.** After merge, paste the SQL into Supabase Dashboard manually.
- **Tooltip discoverability + persistent banners**: when shipping a discoverability feature, pair the hover tooltip with a 3-visit teaching banner (see `users.preferences.buying_events_hub_reorder_tip_seen_count` pattern in `HubView.tsx`).

## Decision rules (memorize these)

- **Default view for buyers**: Hub. Legacy is hidden but not deleted (route handler kept ~30 days).
- **Mobile vs desktop**: always device-default per fresh page load; per-tab override sits in `sessionStorage('beb_mobile_mode')`. No cross-session memory.
- **Ask decision questions one at a time** — don't dump Q1–Q5 lists. Lead with the most blocking question, wait, then move on.
- **No-hold store shipping**: still ships, just immediately. `ship_date = start_date + 3 days`. They MUST appear in the Shipping portal.

## Spec docs

`docs/` contains long-form specs:

- `appointments-spec.md` — appointments redesign
- `intake-purchase-spec.md` — buy-intake flow
- `white-sheet-ocr-spec.md` — OCR pipeline
- `marketing-user-guide.md` — marketing module guide
- `reconciliation.md` — bank reconciliation
- `store-portal-roadmap.md` — public store portal
- `wholesale.md` — wholesale module

When in doubt about a feature's intent, the spec doc is the source of truth before the code is.

## Active in-flight initiatives

(Use `git log --oneline -20` to see the most recent merges, and check open PRs at https://github.com/maxweiner/beb-portal-v2/pulls)

## How to be helpful here

- **Always copy SQL migrations to clipboard** before reporting; mention line count.
- When debugging "cron not running" or "function not found", verify the migration was applied before deeper investigation.
- Recap merged PRs in a status table at the end of work sessions.
- Treat partial-completion as failure — don't claim a feature is done until the SQL is applied AND the PR is merged AND deployed.
