'use client'

// Right pane of the To-Do page when a list is selected. Header (with
// inline rename + delete), quick-add input, pinned/active/completed
// sections. Optimistic mutations with rollback on supabase error.

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { useApp } from '@/lib/context'
import {
  fetchTodos, createTodo, updateTodo, setTodoCompleted, softDeleteTodo,
  updateList, softDeleteList,
  fetchListMembers, assignTodo,
} from '@/lib/todo/api'
import { nextPosition, positionBetween } from '@/lib/todo/positions'
import type { Todo, TodoList, TodoListMember } from '@/lib/todo/types'
import Avatar from '@/components/ui/Avatar'
import TaskRow from './TaskRow'
import ShareListModal from './ShareListModal'
import AssigneePicker from './AssigneePicker'

interface Props {
  list: TodoList
  currentUserId: string
  isOwner: boolean
  onListRenamed: (next: TodoList) => void
  onListDeleted: () => void
  onTaskSoftDeleted: (todo: Todo) => void
  /** Briefly flashes this task's row when set; pair with onHighlightShown. */
  highlightTodoId?: string | null
  onHighlightShown?: () => void
}

export default function TodoListDetail({
  list, currentUserId, isOwner,
  onListRenamed, onListDeleted, onTaskSoftDeleted,
  highlightTodoId, onHighlightShown,
}: Props) {
  const { users } = useApp()
  const [todos, setTodos] = useState<Todo[]>([])
  const [members, setMembers] = useState<TodoListMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(list.name)
  const [showCompleted, setShowCompleted] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)
  const [pickerFor, setPickerFor] = useState<{ todoId: string; rect: DOMRect } | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const refetchMembers = async () => {
    const m = await fetchListMembers(list.id)
    setMembers(m)
  }

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    Promise.all([fetchTodos(list.id), fetchListMembers(list.id)])
      .then(([rows, m]) => {
        if (cancelled) return
        setTodos(rows); setMembers(m); setLoaded(true)
      })
    return () => { cancelled = true }
  }, [list.id])

  useEffect(() => { setNameDraft(list.name) }, [list.name])

  // Auto-clear the highlight flag after the flash animation finishes.
  useEffect(() => {
    if (!highlightTodoId) return
    const t = setTimeout(() => onHighlightShown?.(), 2200)
    return () => clearTimeout(t)
  }, [highlightTodoId, onHighlightShown])

  const { pinned, active, completed } = useMemo(() => {
    const p: Todo[] = []; const a: Todo[] = []; const c: Todo[] = []
    for (const t of todos) {
      if (t.completed) c.push(t)
      else if (t.pinned) p.push(t)
      else a.push(t)
    }
    p.sort((x, y) => x.position - y.position)
    a.sort((x, y) => x.position - y.position)
    c.sort((x, y) => (y.completed_at ?? '').localeCompare(x.completed_at ?? ''))
    return { pinned: p, active: a, completed: c }
  }, [todos])

  // ── Mutations (all optimistic) ────────────────────────────

  const addTask = async () => {
    const content = draftText.trim()
    if (!content) return
    const tempId = 'tmp-' + Math.random().toString(36).slice(2)
    const pos = nextPosition([...active, ...pinned])
    const optimistic: Todo = {
      id: tempId, list_id: list.id, content, assignee_id: null,
      completed: false, completed_at: null, completed_by: null,
      pinned: false, position: pos, created_by: currentUserId,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      deleted_at: null,
    }
    setTodos(prev => [...prev, optimistic])
    setDraftText('')
    try {
      const real = await createTodo({
        listId: list.id, content, position: pos, createdBy: currentUserId,
      })
      setTodos(prev => prev.map(t => t.id === tempId ? real : t))
    } catch (err: any) {
      alert('Could not add task: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.filter(t => t.id !== tempId))
      setDraftText(content)
    }
  }

  const toggleComplete = async (t: Todo) => {
    const next = !t.completed
    setTodos(prev => prev.map(x => x.id === t.id ? {
      ...x, completed: next,
      completed_at: next ? new Date().toISOString() : null,
      completed_by: next ? currentUserId : null,
    } : x))
    try { await setTodoCompleted(t.id, next, currentUserId) }
    catch (err: any) {
      alert('Could not update task: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const togglePin = async (t: Todo) => {
    const next = !t.pinned
    // Drop into the right lane at the end of pinned/active.
    const lane = next ? pinned : active
    const newPos = nextPosition(lane.filter(x => x.id !== t.id))
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, pinned: next, position: newPos } : x))
    try { await updateTodo(t.id, { pinned: next, position: newPos }) }
    catch (err: any) {
      alert('Could not update task: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const editContent = async (t: Todo, content: string) => {
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, content } : x))
    try { await updateTodo(t.id, { content }) }
    catch (err: any) {
      alert('Could not save: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const handleAssign = async (t: Todo, assigneeId: string | null) => {
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, assignee_id: assigneeId } : x))
    setPickerFor(null)
    try {
      await assignTodo(t.id, assigneeId)
      // Auto-share may have added a member; refetch.
      if (assigneeId) await refetchMembers()
    } catch (err: any) {
      alert('Could not assign: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const deleteTask = async (t: Todo) => {
    setTodos(prev => prev.filter(x => x.id !== t.id))
    try {
      await softDeleteTodo(t.id)
      onTaskSoftDeleted(t)
    } catch (err: any) {
      alert('Could not delete: ' + (err?.message || 'unknown'))
      setTodos(prev => [...prev, t])
    }
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active: dragged, over } = e
    if (!over || dragged.id === over.id) return
    const lane = pinned.some(t => t.id === dragged.id) ? pinned : active
    if (!lane.some(t => t.id === over.id)) return // can't cross lanes by drag
    const oldIdx = lane.findIndex(t => t.id === dragged.id)
    const newIdx = lane.findIndex(t => t.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    // Compute neighbors in the new ordering (excluding the dragged row).
    const without = lane.filter(t => t.id !== dragged.id)
    const before = without[newIdx - 1]?.position
    const after = without[newIdx]?.position
    const newPos = positionBetween(before ?? null, after ?? null)
    const draggedTodo = lane[oldIdx]
    setTodos(prev => prev.map(x => x.id === draggedTodo.id ? { ...x, position: newPos } : x))
    try { await updateTodo(draggedTodo.id, { position: newPos }) }
    catch (err: any) {
      alert('Could not reorder: ' + (err?.message || 'unknown'))
      setTodos(prev => prev.map(x => x.id === draggedTodo.id ? draggedTodo : x))
    }
  }

  // ── List header actions ───────────────────────────────────

  const commitName = async () => {
    const trimmed = nameDraft.trim()
    setEditingName(false)
    if (!trimmed || trimmed === list.name) { setNameDraft(list.name); return }
    try {
      await updateList(list.id, { name: trimmed })
      onListRenamed({ ...list, name: trimmed })
    } catch (err: any) {
      alert('Could not rename: ' + (err?.message || 'unknown'))
      setNameDraft(list.name)
    }
  }

  const handleDeleteList = async () => {
    if (!confirm(`Delete "${list.name}"? You can restore it from Trash for 30 days.`)) return
    try { await softDeleteList(list.id); onListDeleted() }
    catch (err: any) { alert('Could not delete list: ' + (err?.message || 'unknown')) }
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {editingName ? (
          <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { setNameDraft(list.name); setEditingName(false) }
            }}
            autoFocus
            style={{
              fontSize: 22, fontWeight: 900, color: 'var(--ink)',
              background: '#fff', border: '1px solid var(--green3)',
              borderRadius: 6, padding: '4px 8px', flex: 1,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        ) : (
          <h1
            onClick={isOwner ? () => setEditingName(true) : undefined}
            style={{
              fontSize: 22, fontWeight: 900, color: 'var(--ink)',
              margin: 0, cursor: isOwner ? 'text' : 'default', flex: 1,
            }}
          >{list.name}</h1>
        )}
        <MemberStack members={members} />
        {isOwner && (
          <>
            <button onClick={() => setShareOpen(true)} className="btn-outline btn-sm">
              Share
            </button>
            <button onClick={handleDeleteList} className="btn-outline btn-sm">
              Delete list
            </button>
          </>
        )}
      </div>

      {/* Quick-add */}
      <input
        value={draftText}
        onChange={e => setDraftText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') addTask() }}
        placeholder="Add a task and press Enter…"
        style={{
          width: '100%', padding: '10px 12px', fontSize: 14,
          border: '1px solid var(--pearl)', borderRadius: 8,
          background: '#fff', color: 'var(--ink)',
          fontFamily: 'inherit', outline: 'none', marginBottom: 14,
        }}
      />

      {!loaded ? (
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {pinned.length > 0 && (
            <Section title="Pinned">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pinned.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {pinned.map(t => (
                    <TaskRow key={t.id} todo={t} draggable
                      assignee={users.find(u => u.id === t.assignee_id) || null}
                      onToggleComplete={() => toggleComplete(t)}
                      onTogglePin={() => togglePin(t)}
                      onEditContent={c => editContent(t, c)}
                      onDelete={() => deleteTask(t)}
                      onOpenAssignee={rect => setPickerFor({ todoId: t.id, rect })}
                      highlight={t.id === highlightTodoId}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </Section>
          )}

          <Section title={pinned.length > 0 ? 'Active' : null}>
            {active.length === 0 ? (
              <Empty text="No active tasks. Add one above." />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={active.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {active.map(t => (
                    <TaskRow key={t.id} todo={t} draggable
                      assignee={users.find(u => u.id === t.assignee_id) || null}
                      onToggleComplete={() => toggleComplete(t)}
                      onTogglePin={() => togglePin(t)}
                      onEditContent={c => editContent(t, c)}
                      onDelete={() => deleteTask(t)}
                      onOpenAssignee={rect => setPickerFor({ todoId: t.id, rect })}
                      highlight={t.id === highlightTodoId}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </Section>

          {shareOpen && (
            <ShareListModal
              list={list}
              members={members}
              currentUserId={currentUserId}
              onClose={() => setShareOpen(false)}
              onMembersChanged={refetchMembers}
            />
          )}
          {pickerFor && (() => {
            const t = todos.find(x => x.id === pickerFor.todoId)
            if (!t) return null
            return (
              <AssigneePicker
                anchorRect={pickerFor.rect}
                hasCurrent={!!t.assignee_id}
                onPick={uid => handleAssign(t, uid)}
                onClear={() => handleAssign(t, null)}
                onClose={() => setPickerFor(null)}
              />
            )
          })()}
          {completed.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button
                onClick={() => setShowCompleted(v => !v)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '6px 0', marginBottom: 4,
                  fontSize: 11, fontWeight: 800, color: 'var(--mist)',
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  fontFamily: 'inherit',
                }}
              >
                {showCompleted ? '▾' : '▸'}  Completed ({completed.length})
              </button>
              {showCompleted && completed.map(t => (
                <TaskRow key={t.id} todo={t} draggable={false}
                  assignee={users.find(u => u.id === t.assignee_id) || null}
                  onToggleComplete={() => toggleComplete(t)}
                  onTogglePin={() => togglePin(t)}
                  onEditContent={c => editContent(t, c)}
                  onDelete={() => deleteTask(t)}
                  onOpenAssignee={rect => setPickerFor({ todoId: t.id, rect })}
                  highlight={t.id === highlightTodoId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MemberStack({ members }: { members: TodoListMember[] }) {
  const { users } = useApp()
  const visible = members.slice(0, 5)
  const overflow = members.length - visible.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((m, i) => {
        const u = users.find(x => x.id === m.user_id)
        const name = u?.name || u?.email || '?'
        return (
          <span key={m.id} title={name} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <Avatar name={name} photoUrl={u?.photo_url} size={26} ring />
          </span>
        )
      })}
      {overflow > 0 && (
        <span style={{
          marginLeft: -8,
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--cream2)', color: 'var(--ash)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800,
          boxShadow: '0 0 0 2px #fff',
        }}>+{overflow}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string | null; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      {title && (
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--mist)',
          textTransform: 'uppercase', letterSpacing: '.06em',
          marginBottom: 4,
        }}>{title}</div>
      )}
      <div style={{
        background: '#fff', border: '1px solid var(--cream2)',
        borderRadius: 8, overflow: 'hidden',
      }}>{children}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>
      {text}
    </div>
  )
}
