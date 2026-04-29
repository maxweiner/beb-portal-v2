-- ============================================================
-- To-Do Lists — Phase 1: schema + RLS
--
-- Tables:
--   todo_lists           One list per row. Owned by a user; private until
--                        shared via todo_list_members.
--   todo_list_members    Who has access. Roles: 'owner' | 'editor'.
--                        Exactly one membership row per (list, user).
--   todos                Tasks within a list. Soft-delete via deleted_at.
--   todo_notifications   In-app feed entries. Types: 'task_assigned' for
--                        now; 'task_nudged' lands in the nudge phase.
--
-- Soft-delete: lists and tasks set deleted_at instead of removing the row.
-- App-level queries filter `deleted_at IS NULL`. A daily cron purges rows
-- older than 30 days (lands in the trash phase).
--
-- RLS model:
--   - Member can SELECT / INSERT / UPDATE / DELETE tasks in their lists.
--   - Owner has full control of the list (rename, delete, share, etc.).
--   - Notifications are private to the recipient.
--   - Server-side service-role writes (e.g., notification creation, cron
--     hard-delete) bypass RLS in the usual way.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS todo_lists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(trim(name)) > 0),
  owner_id    uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  color       text        NULL,                   -- hex or token name
  icon        text        NULL,                   -- lucide-react icon name
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL                    -- soft-delete; NULL = live
);

CREATE TABLE IF NOT EXISTS todo_list_members (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id   uuid        NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text        NOT NULL CHECK (role IN ('owner', 'editor')),
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (list_id, user_id)
);

CREATE TABLE IF NOT EXISTS todos (
  id            uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid             NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
  content       text             NOT NULL CHECK (length(trim(content)) > 0),
  assignee_id   uuid             NULL REFERENCES users(id) ON DELETE SET NULL,
  completed     boolean          NOT NULL DEFAULT false,
  completed_at  timestamptz      NULL,
  completed_by  uuid             NULL REFERENCES users(id) ON DELETE SET NULL,
  pinned        boolean          NOT NULL DEFAULT false,
  -- Fractional position so drag-reorder can insert between two items by
  -- averaging without renumbering everything. New items append at MAX+1.
  position      double precision NOT NULL DEFAULT 0,
  created_by    uuid             NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now(),
  deleted_at    timestamptz      NULL
);

CREATE TABLE IF NOT EXISTS todo_notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text        NOT NULL CHECK (type IN ('task_assigned', 'task_nudged')),
  todo_id       uuid        NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  list_id       uuid        NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
  actor_id      uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  read          boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_todo_lists_owner       ON todo_lists (owner_id);
CREATE INDEX IF NOT EXISTS idx_todo_lists_updated_at  ON todo_lists (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_lists_deleted_at  ON todo_lists (deleted_at);

CREATE INDEX IF NOT EXISTS idx_todo_list_members_user ON todo_list_members (user_id);
CREATE INDEX IF NOT EXISTS idx_todo_list_members_list ON todo_list_members (list_id);

CREATE INDEX IF NOT EXISTS idx_todos_list             ON todos (list_id);
CREATE INDEX IF NOT EXISTS idx_todos_assignee         ON todos (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_deleted_at       ON todos (deleted_at);
-- Composite: the canonical "render this list in order" query.
CREATE INDEX IF NOT EXISTS idx_todos_list_render
  ON todos (list_id, completed, pinned DESC, position, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_todo_notifications_recipient_unread
  ON todo_notifications (recipient_id, created_at DESC)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_todo_notifications_recipient_all
  ON todo_notifications (recipient_id, created_at DESC);

-- ── 3. Helper functions (used by RLS policies) ───────────────
-- Defined AFTER the tables exist so LANGUAGE sql validation passes.
-- STABLE so the planner can cache within a query.

CREATE OR REPLACE FUNCTION todo_current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM users WHERE email = auth.jwt() ->> 'email' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION todo_is_list_member(p_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM todo_list_members m
    WHERE m.list_id = p_list_id
      AND m.user_id = todo_current_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION todo_is_list_owner(p_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM todo_list_members m
    WHERE m.list_id = p_list_id
      AND m.user_id = todo_current_user_id()
      AND m.role = 'owner'
  )
$$;

-- ── 4. Triggers ──────────────────────────────────────────────

-- Touch updated_at on every row update.
CREATE OR REPLACE FUNCTION todo_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_todo_lists_touch ON todo_lists;
CREATE TRIGGER trg_todo_lists_touch
BEFORE UPDATE ON todo_lists
FOR EACH ROW EXECUTE FUNCTION todo_touch_updated_at();

DROP TRIGGER IF EXISTS trg_todos_touch ON todos;
CREATE TRIGGER trg_todos_touch
BEFORE UPDATE ON todos
FOR EACH ROW EXECUTE FUNCTION todo_touch_updated_at();

-- Auto-add the owner as a 'owner' member when a list is created. Runs
-- with elevated privileges so it can insert into todo_list_members
-- before the new owner has any membership row of their own.
CREATE OR REPLACE FUNCTION todo_add_owner_as_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO todo_list_members (list_id, user_id, role, added_by)
  VALUES (NEW.id, NEW.owner_id, 'owner', NEW.owner_id)
  ON CONFLICT (list_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_todo_lists_add_owner ON todo_lists;
CREATE TRIGGER trg_todo_lists_add_owner
AFTER INSERT ON todo_lists
FOR EACH ROW EXECUTE FUNCTION todo_add_owner_as_member();

-- ── 5. RLS ───────────────────────────────────────────────────

ALTER TABLE todo_lists          ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_list_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_notifications  ENABLE ROW LEVEL SECURITY;

-- ─ todo_lists ─
DROP POLICY IF EXISTS "todo_lists_select_member" ON todo_lists;
CREATE POLICY "todo_lists_select_member"
  ON todo_lists FOR SELECT TO authenticated
  USING (todo_is_list_member(id));

DROP POLICY IF EXISTS "todo_lists_insert_self_owner" ON todo_lists;
CREATE POLICY "todo_lists_insert_self_owner"
  ON todo_lists FOR INSERT TO authenticated
  WITH CHECK (owner_id = todo_current_user_id());

DROP POLICY IF EXISTS "todo_lists_update_owner" ON todo_lists;
CREATE POLICY "todo_lists_update_owner"
  ON todo_lists FOR UPDATE TO authenticated
  USING (todo_is_list_owner(id))
  WITH CHECK (todo_is_list_owner(id));

DROP POLICY IF EXISTS "todo_lists_delete_owner" ON todo_lists;
CREATE POLICY "todo_lists_delete_owner"
  ON todo_lists FOR DELETE TO authenticated
  USING (todo_is_list_owner(id));

-- ─ todo_list_members ─
DROP POLICY IF EXISTS "todo_list_members_select_member" ON todo_list_members;
CREATE POLICY "todo_list_members_select_member"
  ON todo_list_members FOR SELECT TO authenticated
  USING (todo_is_list_member(list_id));

-- Owner inserts new editors. The auto-add-owner trigger runs as
-- SECURITY DEFINER and bypasses this.
DROP POLICY IF EXISTS "todo_list_members_insert_owner" ON todo_list_members;
CREATE POLICY "todo_list_members_insert_owner"
  ON todo_list_members FOR INSERT TO authenticated
  WITH CHECK (todo_is_list_owner(list_id));

DROP POLICY IF EXISTS "todo_list_members_update_owner" ON todo_list_members;
CREATE POLICY "todo_list_members_update_owner"
  ON todo_list_members FOR UPDATE TO authenticated
  USING (todo_is_list_owner(list_id))
  WITH CHECK (todo_is_list_owner(list_id));

-- Delete: owner can remove any member; a non-owner can remove themselves.
DROP POLICY IF EXISTS "todo_list_members_delete" ON todo_list_members;
CREATE POLICY "todo_list_members_delete"
  ON todo_list_members FOR DELETE TO authenticated
  USING (
    todo_is_list_owner(list_id)
    OR user_id = todo_current_user_id()
  );

-- ─ todos ─
DROP POLICY IF EXISTS "todos_select_member" ON todos;
CREATE POLICY "todos_select_member"
  ON todos FOR SELECT TO authenticated
  USING (todo_is_list_member(list_id));

DROP POLICY IF EXISTS "todos_insert_member" ON todos;
CREATE POLICY "todos_insert_member"
  ON todos FOR INSERT TO authenticated
  WITH CHECK (todo_is_list_member(list_id));

DROP POLICY IF EXISTS "todos_update_member" ON todos;
CREATE POLICY "todos_update_member"
  ON todos FOR UPDATE TO authenticated
  USING (todo_is_list_member(list_id))
  WITH CHECK (todo_is_list_member(list_id));

DROP POLICY IF EXISTS "todos_delete_member" ON todos;
CREATE POLICY "todos_delete_member"
  ON todos FOR DELETE TO authenticated
  USING (todo_is_list_member(list_id));

-- ─ todo_notifications ─
DROP POLICY IF EXISTS "todo_notifications_select_self" ON todo_notifications;
CREATE POLICY "todo_notifications_select_self"
  ON todo_notifications FOR SELECT TO authenticated
  USING (recipient_id = todo_current_user_id());

-- Notifications are written server-side via the service role. No
-- authenticated INSERT policy — clients can't fabricate notifications.

DROP POLICY IF EXISTS "todo_notifications_update_self" ON todo_notifications;
CREATE POLICY "todo_notifications_update_self"
  ON todo_notifications FOR UPDATE TO authenticated
  USING (recipient_id = todo_current_user_id())
  WITH CHECK (recipient_id = todo_current_user_id());

DROP POLICY IF EXISTS "todo_notifications_delete_self" ON todo_notifications;
CREATE POLICY "todo_notifications_delete_self"
  ON todo_notifications FOR DELETE TO authenticated
  USING (recipient_id = todo_current_user_id());

DO $$ BEGIN
  RAISE NOTICE 'todo_lists schema + RLS applied (4 tables, 3 helpers, 3 triggers).';
END $$;
