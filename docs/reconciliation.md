# Wells Fargo Cleared-Check Reconciliation

A nightly-or-on-demand check on every check we wrote vs. every check Wells Fargo cleared, surfaced at `/reconciliation` (sidebar → Operations → Reconciliation). Brand-scoped: BEB and Liberty have separate accounts and separate findings.

## Who can use it

Accounting, admin, superadmin, and partners (`users.is_partner`). RLS on every reconciliation table enforces this; the page UI also gates so non-allowed users see a friendly "ask an admin" message.

## Import flow

1. Open `/reconciliation` while in the brand whose account you're importing.
2. Click **Upload CSV** → pick the Wells Fargo activity export.
3. The server:
   - parses the CSV (header row + quoted values),
   - filters to rows where `CHECK #` is non-empty *and* `DESCRIPTION` is one of `CHECK`, `CASHED CHECK`, `DEPOSITED OR CASHED CHECK` (case-insensitive),
   - normalizes amounts to positive `numeric(12,2)` and dates to ISO,
   - inserts into `cleared_checks` with `ON CONFLICT (brand, check_number, cleared_date, cleared_amount) DO NOTHING` so re-importing the same export is a no-op,
   - records a `cleared_check_imports` row with `row_count / imported_count / skipped_count / duplicate_count`,
   - re-runs the matcher.

A real second clearing (different date *or* different amount) produces a second row — that's exactly how duplicate clearings get flagged.

## Matching rules

For each `check_number` in the brand's bank account:

| Type | Rule |
| --- | --- |
| ✅ matched | written check exists, exactly one clearing, |Δ| ≤ $0.01 (no row stored) |
| ⚠️ amount_mismatch | written check exists, one clearing, |Δ| > $0.01 |
| 🚨 duplicate_clearing | same check number cleared more than once |
| ❓ orphan_cleared | clearing(s) exist with no written check (and not on the allowlist) |
| 📭 outstanding | written check exists, no clearings yet |

"Written checks" come from a union of `buyer_checks` and `event_days.store_commission_check_*`, joined to `events.brand`. Trunk-show / trade-show checks aren't in scope.

The matcher is `public.reconciliation_run_match(p_brand text)` — run automatically on every import and via the **Re-run matching** button on the page. Findings are upserted on `(brand, check_number, finding_type)` so user-set status (`disputed` / `resolved` / `ignored`) survives re-runs. Open findings whose issue resolved itself between runs are dropped.

## Status workflow

Each finding has a status: `open` (default) → `disputed` / `resolved` / `ignored`. Statuses persist across matcher runs. Resolving or disputing stamps `resolved_by` + `resolved_at` with the actor.

## Allowlist for non-event checks

Rent, payroll, vendor checks etc. show up as `orphan_cleared` because they were never written through the buying app. On any orphan finding, click **Not an event check** to add the check number to `non_event_check_numbers` for the current brand. Future imports auto-classify the same number as ignored — it never appears as an orphan again.

## Dispute letters

For `amount_mismatch` and `duplicate_clearing` findings, click **Dispute letter PDF** in the detail modal. The server renders a one-page letter (check #, written + cleared amounts, dates, description, signed by the current user) that's mailable to Wells Fargo. Brand address + account-last-four can be set in the `settings` table:

- `reconciliation.beb.address`
- `reconciliation.beb.account_last_four`
- `reconciliation.liberty.address`
- `reconciliation.liberty.account_last_four`

## Outstanding aging

The Outstanding tab buckets uncleared written checks by age (0–30 / 30–60 / 60–90 / 90+). The 90+ bucket suggests stop-payment + reissue — usually means the check was lost.

## Sidebar alert

A red badge on the Reconciliation nav item shows the count of *open* `amount_mismatch` + `duplicate_clearing` + `orphan_cleared` findings for the active brand. Resolves automatically as findings are addressed.

## Where things live

| File | Purpose |
| --- | --- |
| `supabase-migration-reconciliation-schema.sql` | Tables + RLS + indexes |
| `supabase-migration-reconciliation-matcher.sql` | `reconciliation_run_match()` SQL function |
| `supabase-migration-reconciliation-module.sql` | role_modules registration |
| `app/api/reconciliation/import/route.ts` | CSV parse + insert + match |
| `app/api/reconciliation/match/route.ts` | On-demand matcher trigger |
| `app/api/reconciliation/findings/[id]/route.ts` | PATCH status / note |
| `app/api/reconciliation/findings/[id]/mark-not-event-check/route.ts` | Allowlist add |
| `app/api/reconciliation/findings/[id]/dispute-letter/route.ts` | PDF render |
| `lib/reconciliation/disputeLetterPdf.tsx` | React-PDF document |
| `components/reconciliation/ReconciliationPage.tsx` | Page UI |
| `components/reconciliation/useReconciliationAlerts.ts` | Sidebar badge feeder |
