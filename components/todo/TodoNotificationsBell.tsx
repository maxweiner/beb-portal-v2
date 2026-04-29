'use client'

// Bell icon + unread count + dropdown for To-Do notifications.
// Lives in the sidebar footer. Polls every 30s; realtime upgrade is
// Phase 6. Clicking a row marks it read and dispatches the
// `beb:open-todo` event so TodoPage can switch + briefly highlight.

import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  fetchTodoNotifications, markAllTodoNotificationsRead,
  markTodoNotificationsRead,
} from '@/lib/todo/api'
import type { Todo, TodoList, TodoNotification } from '@/lib/todo/types'
import { fetchTodos, fetchMyLists } from '@/lib/todo/api'
import type { NavPage } from '@/app/page'

const POLL_MS = 30_000

interface Props {
  setNav: (n: NavPage) => void
}

export default function TodoNotificationsBell({ setNav }: Props) {
  const { user, users } = useApp()
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<TodoNotification[]>([])
  const [lists, setLists] = useState<Record<string, TodoList>>({})
  const [todos, setTodos] = useState<Record<string, Todo>>({})
  const ref = useRef<HTMLDivElement>(null)

  // Initial load + poll. Stops cleanly on unmount.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const refresh = async () => {
      try {
        const rows = await fetchTodoNotifications(30)
        if (cancelled) return
        setNotifs(rows)
      } catch { /* swallow — bell is best-effort */ }
    }
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [user?.id])

  // When the dropdown opens, hydrate list + task labels for the
  // currently-loaded notifications. Cheap to refetch every open.
  useEffect(() => {
    if (!open || notifs.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const [allLists] = await Promise.all([fetchMyLists()])
        if (cancelled) return
        const lm: Record<string, TodoList> = {}
        for (const l of allLists) lm[l.id] = l
        setLists(lm)
        // Fetch todos per unique list_id in the notification batch.
        const listIds = Array.from(new Set(notifs.map(n => n.list_id)))
        const tm: Record<string, Todo> = {}
        for (const lid of listIds) {
          try {
            const t = await fetchTodos(lid)
            for (const x of t) tm[x.id] = x
          } catch { /* skip lists we can't see anymore */ }
        }
        if (!cancelled) setTodos(tm)
      } catch { /* nbd */ }
    })()
    return () => { cancelled = true }
  }, [open, notifs])

  // Click-outside / Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const unread = notifs.filter(n => !n.read).length

  const onPick = async (n: TodoNotification) => {
    setOpen(false)
    if (!n.read) {
      // Optimistic; revert isn't important for a read flag.
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      try { await markTodoNotificationsRead([n.id]) } catch { /* ignore */ }
    }
    setNav('todo')
    // Defer so TodoPage is mounted before we ask it to navigate.
    setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-todo', {
      detail: { listId: n.list_id, todoId: n.todo_id },
    })), 0)
  }

  const markAll = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    try { await markAllTodoNotificationsRead() } catch { /* ignore */ }
  }

  if (!user) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} aria-label="Notifications"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,.85)', padding: '6px 8px',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 14, fontFamily: 'inherit', position: 'relative',
        }}>
        <span aria-hidden style={{ fontSize: 16 }}>🔔</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>
          {unread > 0 ? `${unread} new` : 'Notifications'}
        </span>
        {unread > 0 && (
          <span aria-hidden style={{
            position: 'absolute', top: 2, left: 18,
            background: '#EF4444', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: 1,
            padding: '2px 5px', borderRadius: 8,
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0,
          marginBottom: 8, width: 320,
          background: '#fff', border: '1px solid var(--pearl)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.18)',
          overflow: 'hidden', zIndex: 1100,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--cream2)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
              Notifications
            </span>
            {unread > 0 && (
              <button onClick={markAll} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--green-dark)', fontSize: 11, fontWeight: 700,
                textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
              }}>Mark all as read</button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifs.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--mist)', textAlign: 'center' }}>
                Nothing new.
              </div>
            ) : notifs.map(n => {
              const actor = n.actor_id ? users.find(u => u.id === n.actor_id) : null
              const list = lists[n.list_id]
              const todo = todos[n.todo_id]
              const verb = n.type === 'task_assigned' ? 'assigned you'
                         : n.type === 'task_nudged'   ? 'nudged you about'
                         : 'updated'
              return (
                <button key={n.id} onClick={() => onPick(n)} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: n.read ? 'transparent' : 'var(--green-pale)',
                  border: 'none', padding: '10px 12px',
                  borderBottom: '1px solid var(--cream2)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.35 }}>
                    <strong>{actor?.name?.split(' ')[0] || 'Someone'}</strong>
                    {' '}{verb}{' '}
                    "<span style={{ color: 'var(--ink)' }}>{truncate(todo?.content || '(task)', 60)}</span>"
                    {list && <> in <strong>{list.name}</strong></>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 3 }}>
                    {timeAgo(n.created_at)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
