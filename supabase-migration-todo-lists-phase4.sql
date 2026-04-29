-- ============================================================
-- To-Do Lists — Phase 4: notify on assignment
--
-- Replaces todo_assign_task() so it also writes a todo_notifications
-- row when:
--   - the new assignee is not NULL,
--   - the new assignee differs from the previous assignee,
--   - the new assignee is not the caller themselves.
--
-- All other notification triggers (edit, complete, delete, share)
-- remain intentionally absent per spec.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION todo_assign_task(
  p_todo_id uuid,
  p_assignee_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id      uuid;
  v_caller_id    uuid;
  v_old_assignee uuid;
BEGIN
  v_caller_id := todo_current_user_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT list_id, assignee_id INTO v_list_id, v_old_assignee
    FROM todos WHERE id = p_todo_id;
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

  IF p_assignee_id IS NOT NULL
     AND p_assignee_id IS DISTINCT FROM v_old_assignee
     AND p_assignee_id <> v_caller_id THEN
    INSERT INTO todo_notifications (recipient_id, type, todo_id, list_id, actor_id)
    VALUES (p_assignee_id, 'task_assigned', p_todo_id, v_list_id, v_caller_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION todo_assign_task(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION todo_assign_task(uuid, uuid) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'todo_assign_task now creates a notification on real assignment changes.';
END $$;
