'use client'

// Popover anchored to a task row's avatar slot. Lets the caller pick
// an assignee (or clear). Auto-share happens server-side via the
// todo_assign_task RPC, so the picker just sends the pick upward.

import { useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import UserPicker from '@/components/ui/UserPicker'

interface Props {
  /** Anchor: rect we should position next to. */
  anchorRect: DOMRect
  hasCurrent: boolean
  onPick: (userId: string) => void
  onClear: () => void
  onClose: () => void
}

export default function AssigneePicker({
  anchorRect, hasCurrent, onPick, onClear, onClose,
}: Props) {
  const { users } = useApp()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  // Position: open just below the anchor, right-aligned to it. Clamp
  // so we don't fall off the right edge.
  const width = 320
  const top = anchorRect.bottom + 6
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchorRect.right - width))

  return (
    <div ref={ref} style={{
      position: 'fixed', top, left, width,
      background: '#fff', border: '1px solid var(--pearl)',
      borderRadius: 10, padding: 10,
      boxShadow: '0 12px 32px rgba(0,0,0,.18)',
      zIndex: 1100,
    }}>
      <UserPicker
        users={users}
        onPick={u => onPick(u.id)}
        onClear={hasCurrent ? onClear : undefined}
        placeholder="Assign to…"
      />
    </div>
  )
}
