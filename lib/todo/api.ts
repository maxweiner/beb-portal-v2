// Supabase queries for the To-Do feature. Pure functions over the
// browser supabase client. RLS gates everything by membership; these
// just fetch and write.

import { supabase } from '@/lib/supabase'
import type { Todo, TodoList } from './types'

const LIST_COLS = 'id, name, owner_id, color, icon, created_at, updated_at, deleted_at'
const TODO_COLS = 'id, list_id, content, assignee_id, completed, completed_at, completed_by, pinned, position, created_by, created_at, updated_at, deleted_at'

// ── Lists ──────────────────────────────────────────────────

/** All lists the current user is a member of (owned + shared). */
export async function fetchMyLists(): Promise<TodoList[]> {
  const { data, error } = await supabase
    .from('todo_lists')
    .select(LIST_COLS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []) as TodoList[]
}

export async function createList(input: {
  name: string
  ownerId: string
  color?: string | null
  icon?: string | null
}): Promise<TodoList> {
  const { data, error } = await supabase
    .from('todo_lists')
    .insert({
      name: input.name.trim(),
      owner_id: input.ownerId,
      color: input.color ?? null,
      icon: input.icon ?? null,
    })
    .select(LIST_COLS)
    .single()
  if (error) throw error
  return data as TodoList
}

export async function updateList(
  id: string,
  patch: Partial<Pick<TodoList, 'name' | 'color' | 'icon'>>,
): Promise<void> {
  const { error } = await supabase.from('todo_lists').update(patch).eq('id', id)
  if (error) throw error
}

export async function softDeleteList(id: string): Promise<void> {
  const { error } = await supabase.from('todo_lists')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function restoreList(id: string): Promise<void> {
  const { error } = await supabase.from('todo_lists')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw error
}

// ── Todos ──────────────────────────────────────────────────

export async function fetchTodos(listId: string): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select(TODO_COLS)
    .eq('list_id', listId)
    .is('deleted_at', null)
    .order('completed', { ascending: true })
    .order('pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as Todo[]
}

export async function createTodo(input: {
  listId: string
  content: string
  position: number
  createdBy: string
  assigneeId?: string | null
}): Promise<Todo> {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      list_id: input.listId,
      content: input.content.trim(),
      position: input.position,
      created_by: input.createdBy,
      assignee_id: input.assigneeId ?? null,
    })
    .select(TODO_COLS)
    .single()
  if (error) throw error
  return data as Todo
}

export async function updateTodo(
  id: string,
  patch: Partial<Pick<Todo, 'content' | 'pinned' | 'position' | 'assignee_id'>>,
): Promise<void> {
  const { error } = await supabase.from('todos').update(patch).eq('id', id)
  if (error) throw error
}

export async function setTodoCompleted(
  id: string,
  completed: boolean,
  byUserId: string,
): Promise<void> {
  const { error } = await supabase.from('todos').update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
    completed_by: completed ? byUserId : null,
  }).eq('id', id)
  if (error) throw error
}

export async function softDeleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function restoreTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw error
}
