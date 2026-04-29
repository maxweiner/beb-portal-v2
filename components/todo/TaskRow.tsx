'use client'

// Single task row. Used in active + pinned + completed sections.
// Inline-edits content on click; Esc cancels, Enter / blur saves.

import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Checkbox from '@/components/ui/Checkbox'
import type { Todo } from '@/lib/todo/types'

interface Props {
  todo: Todo
  onToggleComplete: () => void
  onTogglePin: () => void
  onEditContent: (next: string) => void
  onDelete: () => void
  /** True when this row is in a sortable container. Disables drag for
   *  completed rows since they live in their own non-orderable section. */
  draggable: boolean
}

export default function TaskRow({
  todo, onToggleComplete, onTogglePin, onEditContent, onDelete, draggable,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id, disabled: !draggable })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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
    <div ref={setNodeRef} style={{
      ...style,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', background: '#fff',
      borderBottom: '1px solid var(--cream2)',
    }}>
      {draggable && (
        <span
          {...attributes} {...listeners}
          aria-label="Drag to reorder"
          style={{
            cursor: 'grab', color: 'var(--mist)', fontSize: 14,
            padding: '0 2px', userSelect: 'none', touchAction: 'none',
          }}
        >⋮⋮</span>
      )}
      <Checkbox checked={todo.completed} onChange={onToggleComplete} />

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
            flex: 1, fontSize: 14, padding: '4px 6px',
            border: '1px solid var(--green3)', borderRadius: 4,
            background: '#fff', color: 'var(--ink)',
            fontFamily: 'inherit', outline: 'none',
          }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{
            display: 'block', flex: 1, textAlign: 'left',
            background: 'none', border: 'none', padding: 0,
            cursor: 'text', fontFamily: 'inherit',
            fontSize: 14, color: todo.completed ? 'var(--mist)' : 'var(--ink)',
            textDecoration: todo.completed ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{todo.content}</button>
      )}

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
      <button
        onClick={onDelete}
        title="Delete"
        aria-label="Delete task"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 6px', fontSize: 13, color: 'var(--mist)',
        }}
      >🗑</button>
    </div>
  )
}
