-- AI Reports — user-defined scheduled reports that query live data
-- and have Claude write a fresh narrative each time they fire.
--
-- Created 2026-05-17 as part of the AI Reports initiative
-- (replacing the deprecated Custom Reports v2 tab).
--
-- One row per user-defined report. The cron worker at
-- /api/cron/ai-reports walks the active rows every 15 min, finds
-- ones whose schedule matches "right now," queries events +
-- event_days within the time_window, hands the data to Claude with
-- the user's prompt, and emails the result via Resend to every user
-- id in recipient_user_ids.

create table if not exists ai_reports (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  prompt                 text not null,
  brand                  text not null check (brand in ('beb', 'liberty')),

  -- Schedule. schedule_type drives which of the day_of_* columns is
  -- honored (the others are ignored). Hour + minute are always in
  -- America/New_York (the buying-business HQ tz).
  schedule_type          text not null check (schedule_type in ('daily', 'weekly', 'monthly')),
  schedule_day_of_week   int  check (schedule_day_of_week between 0 and 6),    -- 0 = Sun
  schedule_day_of_month  int  check (schedule_day_of_month between 1 and 31),
  schedule_hour          int  not null check (schedule_hour between 0 and 23),
  schedule_minute        int  not null check (schedule_minute between 0 and 59),

  -- Data window the cron fetches before handing off to Claude.
  time_window            text not null check (time_window in ('last_7d', 'last_30d', 'last_90d', 'current_month')),

  -- Recipients are stored as an array of users.id so the receive list
  -- updates automatically if a user changes their email.
  recipient_user_ids     uuid[] not null default '{}',

  -- State
  active                 boolean not null default true,
  last_sent_at           timestamptz,
  last_send_status       text,             -- 'sent' | 'error'
  last_send_error        text,
  last_send_body         text,             -- the actual narrative Claude generated, for audit

  -- Audit
  created_by             uuid references users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists ai_reports_active_brand_idx
  on ai_reports (active, brand)
  where active = true;

-- RLS — only admin / superadmin can manage AI reports (creates,
-- edits, deletes). All admins can see all reports across the org
-- (no per-user ownership lock since these are operational tooling).
-- Everyone else has no SELECT — we don't surface these to non-admins
-- in any UI, and the cron uses the service key.
alter table ai_reports enable row level security;

drop policy if exists ai_reports_admin_all on ai_reports;
create policy ai_reports_admin_all on ai_reports
  for all
  using (has_any_role('admin', 'superadmin'))
  with check (has_any_role('admin', 'superadmin'));

-- updated_at maintenance
create or replace function ai_reports_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ai_reports_touch_updated_at on ai_reports;
create trigger ai_reports_touch_updated_at
  before update on ai_reports
  for each row execute function ai_reports_touch_updated_at();
