// Row shapes mirroring supabase-migration-todo-lists.sql.

export type TodoRole = 'owner' | 'editor'
export type TodoNotificationType = 'task_assigned' | 'task_nudged'

export interface TodoList {
  id: string
  name: string
  owner_id: string
  color: string | null
  icon: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TodoListMember {
  id: string
  list_id: string
  user_id: string
  role: TodoRole
  added_at: string
  added_by: string | null
}

export interface Todo {
  id: string
  list_id: string
  content: string
  assignee_id: string | null
  completed: boolean
  completed_at: string | null
  completed_by: string | null
  pinned: boolean
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
