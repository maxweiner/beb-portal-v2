'use client'

// Cross-list inbox of tasks assigned to the current user. Three
// sections: Pinned, Active, Completed. Each row shows the task
// content + parent list name; controls are check / edit / pin per
// spec (no delete, no drag — those live on the list view itself).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMyAssignedTodos, setTodoCompleted, updateTodo,
  type MyAssignedTodo,
} from '@/lib/todo/api'
import Checkbox from '@/components/ui/Checkbox'

const POLL_MS = 30_000

interface Props {
  currentUserId: string
  /** Notify the parent so it can switch to the list view + flash the row. */
  onOpenInList: (listId: string, todoId: string) => void
}

export default function MyTasksView({ currentUserId, onOpenInList }: Props) {
  const [tasks, setTasks] = useState<MyAssignedTodo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)

  const refresh = async () => {
    try {
      const rows = await fetchMyAssignedTodos(currentUserId)
      setTasks(rows)
    } catch { /* swallow — best effort */ }
  }

  useEffect(() => {
    let cancelled = false
    fetchMyAssignedTodos(currentUserId).then(rows => {
      if (cancelled) return
      setTasks(rows); setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    const id = setInterval(refresh, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  const { pinned, active, completed } = useMemo(() => {
    const p: MyAssignedTodo[] = []; const a: MyAssignedTodo[] = []; const c: MyAssignedTodo[] = []
    for (const t of tasks) {
      if (t.completed) c.push(t)
      else if (t.pinned) p.push(t)
      else a.push(t)
    }
    return { pinned: p, active: a, completed: c }
  }, [tasks])

  const toggleComplete = async (t: MyAssignedTodo) => {
    const next = !t.completed
    setTasks(prev => prev.map(x => x.id === t.id ? {
      ...x, completed: next,
      completed_at: next ? new Date().toISOString() : null,
      completed_by: next ? currentUserId : null,
    } : x))
    try { await setTodoCompleted(t.id, next, currentUserId) }
    catch (err: any) {
      alert('Could not update task: ' + (err?.message || 'unknown'))
      setTasks(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const togglePin = async (t: MyAssignedTodo) => {
    const next = !t.pinned
    // From the inbox we don't know the destination list's pinned-lane
    // ordering. Use a millisecond-derived position so the freshly-pinned
    // item floats to the top of its list's pinned section. Loses any
    // intentional ordering — that's fine here.
    const newPos = Date.now() / 1000
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, pinned: next, position: newPos } : x))
    try { await updateTodo(t.id, { pinned: next, position: newPos }) }
    catch (err: any) {
      alert('Could not update task: ' + (err?.message || 'unknown'))
      setTasks(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  const editContent = async (t: MyAssignedTodo, content: string) => {
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, content } : x))
    try { await updateTodo(t.id, { content }) }
    catch (err: any) {
      alert('Could not save: ' + (err?.message || 'unknown'))
      setTasks(prev => prev.map(x => x.id === t.id ? t : x))
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 14px' }}>
        My Tasks
      </h1>
      <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: -10, marginBottom: 14 }}>
        Everything assigned to you, across every list.
      </div>

      {!loaded ? (
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{
          padding: '20px 14px', fontSize: 13, color: 'var(--mist)',
          background: '#fff', border: '1px solid var(--cream2)',
          borderRadius: 8, textAlign: 'center', fontStyle: 'italic',
        }}>
          Nothing assigned to you. Enjoy the quiet.
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <Section title="Pinned">
              {pinned.map(t => (
                <Row key={t.id} todo={t}
                  onToggleComplete={() => toggleComplete(t)}
                  onTogglePin={() => togglePin(t)}
                  onEditContent={c => editContent(t, c)}
                  onOpen={() => onOpenInList(t.list_id, t.id)}
                />
              ))}
            </Section>
          )}
          <Section title={pinned.length > 0 ? 'Active' : null}>
            {active.length === 0 ? (
              <Empty text="No active tasks assigned to you." />
            ) : active.map(t => (
              <Row key={t.id} todo={t}
                onToggleComplete={() => toggleComplete(t)}
                onTogglePin={() => togglePin(t)}
                onEditContent={c => editContent(t, c)}
                onOpen={() => onOpenInList(t.list_id, t.id)}
              />
            ))}
          </Section>
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
                }}>
                {showCompleted ? '▾' : '▸'}  Completed ({completed.length})
              </button>
              {showCompleted && (
                <div style={{
                  background: '#fff', border: '1px solid var(--cream2)',
                  borderRadius: 8, overflow: 'hidden',
                }}>
                  {completed.map(t => (
                    <Row key={t.id} todo={t}
                      onToggleComplete={() => toggleComplete(t)}
                      onTogglePin={() => togglePin(t)}
                      onEditContent={c => editContent(t, c)}
                      onOpen={() => onOpenInList(t.list_id, t.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Internal row + helpers ─────────────────────────────────

function Row({ todo, onToggleComplete, onTogglePin, onEditContent, onOpen }: {
  todo: MyAssignedTodo
  onToggleComplete: () => void
  onTogglePin: () => void
  onEditContent: (next: string) => void
  onOpen: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.content)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(todo.content) }, [todo.content])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    setEditing(false)
    if (trimmed && trimmed !== todo.content) onEditContent(trimmed)
    else setDraft(todo.content)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', background: '#fff',
      borderBottom: '1px solid var(--cream2)',
    }}>
      <Checkbox checked={todo.completed} onChange={onToggleComplete} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(todo.content); setEditing(false) }
            }}
            style={{
              width: '100%', fontSize: 14, padding: '4px 6px',
              border: '1px solid var(--green3)', borderRadius: 4,
              background: '#fff', color: 'var(--ink)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', padding: 0,
              cursor: 'text', fontFamily: 'inherit',
              fontSize: 14, color: todo.completed ? 'var(--mist)' : 'var(--ink)',
              textDecoration: todo.completed ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{todo.content}</button>
        )}
        <button
          onClick={onOpen}
          title="Open in list"
          style={{
            display: 'block', textAlign: 'left',
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 11, color: 'var(--mist)', marginTop: 2,
          }}
        >{todo.list?.name || '(unknown list)'} ↗</button>
      </div>

      <button
        onClick={onTogglePin}
        title={todo.pinned ? 'Unpin' : 'Pin'}
        aria-label={todo.pinned ? 'Unpin task' : 'Pin task'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 6px', fontSize: 14,
          color: todo.pinned ? '#F59E0B' : 'var(--mist)',
        }}
      >{todo.pinned ? '★' : '☆'}</button>
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
