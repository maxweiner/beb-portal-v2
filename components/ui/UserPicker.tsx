'use client'

// Reusable user search + select. Renders an inline search input and a
// scrollable list of matches. Used by the To-Do feature (share modal,
// assign-task popover) and is intentionally generic so it can land in
// other surfaces later.

import { useMemo, useState } from 'react'
import type { User } from '@/types'
import Avatar from './Avatar'

interface Props {
  users: User[]
  /** User ids to omit from results (e.g. existing members). */
  excludeIds?: string[]
  onPick: (u: User) => void
  /** Optional "Clear" row at the top. Click → onPick(null). */
  onClear?: () => void
  placeholder?: string
  /** Max rows shown — virtualization isn't needed for the org's user count. */
  limit?: number
  autoFocus?: boolean
}

export default function UserPicker({
  users, excludeIds, onPick, onClear,
  placeholder = 'Search by name or email…',
  limit = 50, autoFocus = true,
}: Props) {
  const [q, setQ] = useState('')
  const exclude = new Set(excludeIds ?? [])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users
      .filter(u => u.active !== false && !exclude.has(u.id))
      .filter(u => !needle
        || u.name?.toLowerCase().includes(needle)
        || u.email?.toLowerCase().includes(needle))
      .slice(0, limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, users, excludeIds?.join(','), limit])

  return (
    <div>
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '8px 10px', fontSize: 13,
          border: '1px solid var(--pearl)', borderRadius: 6,
          background: '#fff', color: 'var(--ink)', marginBottom: 8,
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      <div style={{
        maxHeight: 240, overflowY: 'auto',
        background: '#fff', border: '1px solid var(--cream2)',
        borderRadius: 6,
      }}>
        {onClear && (
          <button onClick={onClear} style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '8px 10px', background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--cream2)', cursor: 'pointer',
            fontSize: 12, color: 'var(--mist)', fontStyle: 'italic',
            fontFamily: 'inherit',
          }}>Clear assignment</button>
        )}
        {matches.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--mist)' }}>
            No users match.
          </div>
        ) : matches.map(u => (
          <button key={u.id} onClick={() => onPick(u)} style={{
            display: 'flex', width: '100%', textAlign: 'left',
            padding: '8px 10px', background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--cream2)', cursor: 'pointer',
            fontFamily: 'inherit', alignItems: 'center', gap: 10,
          }}>
            <Avatar name={u.name || u.email || '?'} photoUrl={u.photo_url} size={26} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{u.name || '(no name)'}</span>
              <span style={{
                display: 'block', fontSize: 11, color: 'var(--mist)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{u.email}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
