-- ============================================================
-- To-Do Lists — Phase 3: assign-task RPC
--
-- Auto-share-on-assign requires editors to add new members. The
-- regular INSERT policy on todo_list_members allows owner only, by
-- design — so the auto-share path goes through this SECURITY DEFINER
-- function. The function still validates the caller is a member of
-- the list (any role) before granting the elevated insert.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION todo_assign_task(
  p_todo_id uuid,
  p_assignee_id uuid    -- NULL to clear assignment
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id   uuid;
  v_caller_id uuid;
BEGIN
  v_caller_id := todo_current_user_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT list_id INTO v_list_id FROM todos WHERE id = p_todo_id;
  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Todo not found';
  END IF;

  IF NOT todo_is_list_member(v_list_id) THEN
    RAISE EXCEPTION 'Not a member of this list';
  END IF;

  IF p_assignee_id IS NOT NULL THEN
    INSERT INTO todo_list_members (list_id, user_id, role, added_by)
    VALUES (v_list_id, p_assignee_id, 'editor', v_caller_id)
    ON CONFLICT (list_id, user_id) DO NOTHING;
  END IF;

  UPDATE todos SET assignee_id = p_assignee_id WHERE id = p_todo_id;
END;
$$;

REVOKE ALL ON FUNCTION todo_assign_task(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION todo_assign_task(uuid, uuid) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'todo_assign_task RPC created.';
END $$;
