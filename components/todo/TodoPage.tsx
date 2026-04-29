'use client'

// Top-level To-Do page. Two-pane layout: list rail on the left, list
// detail (or empty state) on the right. Phase 2 is single-user — no
// sharing UI; an "Owner" badge is shown on every list since the user
// owns all of them by definition. Sharing + members land in phase 3.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  fetchMyLists, createList, restoreTodo, restoreList,
} from '@/lib/todo/api'
import type { Todo, TodoList } from '@/lib/todo/types'
import TodoListDetail from './TodoListDetail'

interface UndoTask { kind: 'task'; todo: Todo; listId: string }
interface UndoList { kind: 'list'; list: TodoList }
type UndoEntry = UndoTask | UndoList

const UNDO_DURATION_MS = 10_000

export default function TodoPage() {
  const { user } = useApp()
  const [lists, setLists] = useState<TodoList[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  // Bumped on task-undo to force TodoListDetail to remount + refetch.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchMyLists().then(rows => {
      if (cancelled) return
      setLists(rows)
      setLoaded(true)
      if (rows.length > 0 && !selectedId) setSelectedId(rows[0].id)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-clear the undo toast after 10s.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_DURATION_MS)
    return () => clearTimeout(t)
  }, [undo])

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--mist)' }}>Sign in to view your lists.</div>
  }

  const submitNewList = async () => {
    const name = newName.trim()
    if (!name) { setCreating(false); return }
    try {
      const created = await createList({ name, ownerId: user.id })
      setLists(prev => [created, ...prev])
      setSelectedId(created.id)
    } catch (err: any) {
      alert('Could not create list: ' + (err?.message || 'unknown'))
    } finally {
      setCreating(false)
      setNewName('')
    }
  }

  const selected = lists.find(l => l.id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - 0px)' }}>
      {/* Left rail */}
      <aside style={{
        width: 240, flexShrink: 0,
        borderRight: '1px solid var(--pearl)',
        background: 'var(--cream)',
        padding: '18px 14px', overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
            My Lists
          </h2>
          {!creating && (
            <button onClick={() => setCreating(true)} title="New list"
              style={{
                background: 'var(--green)', color: '#fff', border: 'none',
                width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                fontSize: 16, fontWeight: 900, lineHeight: 1, fontFamily: 'inherit',
              }}>+</button>
          )}
        </div>

        {creating && (
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitNewList()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
            onBlur={submitNewList}
            autoFocus placeholder="List name…"
            style={{
              width: '100%', padding: '8px 10px', fontSize: 13,
              border: '1px solid var(--green3)', borderRadius: 6,
              background: '#fff', color: 'var(--ink)', marginBottom: 8,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        )}

        {!loaded ? (
          <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
        ) : lists.length === 0 ? (
          <div style={{ color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
            No lists yet. Click + to create one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lists.map(l => {
              const sel = l.id === selectedId
              return (
                <button key={l.id} onClick={() => setSelectedId(l.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 10px', borderRadius: 6,
                  background: sel ? 'var(--green-pale)' : 'transparent',
                  border: '1px solid ' + (sel ? 'var(--green3)' : 'transparent'),
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: sel ? 800 : 600,
                  color: sel ? 'var(--green-dark)' : 'var(--ink)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{l.name}</button>
              )
            })}
          </div>
        )}
      </aside>

      {/* Right pane */}
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--cream2)' }}>
        {selected ? (
          <TodoListDetail
            key={selected.id + ':' + refreshKey}
            list={selected}
            currentUserId={user.id}
            isOwner={selected.owner_id === user.id}
            onListRenamed={next => setLists(prev => prev.map(l => l.id === next.id ? next : l))}
            onListDeleted={() => {
              const removed = lists.find(l => l.id === selectedId)
              if (removed) setUndo({ kind: 'list', list: removed })
              setLists(prev => prev.filter(l => l.id !== selectedId))
              setSelectedId(prev => {
                const remaining = lists.filter(l => l.id !== prev)
                return remaining[0]?.id ?? null
              })
            }}
            onTaskSoftDeleted={(todo) => setUndo({ kind: 'task', todo, listId: selected.id })}
          />
        ) : (
          <div style={{ padding: 40, color: 'var(--mist)' }}>
            {lists.length === 0
              ? 'Create your first list to get started.'
              : 'Pick a list from the left.'}
          </div>
        )}
      </main>

      {/* Undo toast */}
      {undo && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: '#fff',
          padding: '10px 14px', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 1200,
          boxShadow: '0 8px 24px rgba(0,0,0,.25)', fontSize: 13,
        }}>
          <span>{undo.kind === 'task' ? 'Task deleted.' : 'List deleted.'}</span>
          <button
            onClick={async () => {
              try {
                if (undo.kind === 'task') {
                  await restoreTodo(undo.todo.id)
                  // Bump refresh key to remount TodoListDetail and refetch.
                  setSelectedId(undo.listId)
                  setRefreshKey(k => k + 1)
                } else {
                  await restoreList(undo.list.id)
                  setLists(prev => [undo.list, ...prev])
                  setSelectedId(undo.list.id)
                }
                setUndo(null)
              } catch (err: any) {
                alert('Could not undo: ' + (err?.message || 'unknown'))
              }
            }}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,.4)',
              color: '#fff', padding: '4px 12px', borderRadius: 6,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Undo</button>
        </div>
      )}
    </div>
  )
}
