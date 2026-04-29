'use client'

// Owner-only modal: search and add editors, see current members,
// remove anyone but the owner.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { addListMember, removeListMember } from '@/lib/todo/api'
import type { TodoList, TodoListMember } from '@/lib/todo/types'
import Avatar from '@/components/ui/Avatar'
import UserPicker from '@/components/ui/UserPicker'

interface Props {
  list: TodoList
  members: TodoListMember[]
  currentUserId: string
  onClose: () => void
  onMembersChanged: () => void
}

export default function ShareListModal({
  list, members, currentUserId, onClose, onMembersChanged,
}: Props) {
  const { users } = useApp()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const memberIds = members.map(m => m.user_id)

  const add = async (userId: string) => {
    setBusy(true)
    try {
      await addListMember({ listId: list.id, userId, addedBy: currentUserId })
      onMembersChanged()
    } catch (err: any) {
      alert('Could not add member: ' + (err?.message || 'unknown'))
    } finally { setBusy(false) }
  }

  const remove = async (userId: string) => {
    if (userId === list.owner_id) return
    setBusy(true)
    try {
      await removeListMember(list.id, userId)
      onMembersChanged()
    } catch (err: any) {
      alert('Could not remove member: ' + (err?.message || 'unknown'))
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460,
        padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,.18)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
            Share "{list.name}"
          </h3>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--mist)', padding: '0 6px',
          }}>×</button>
        </div>

        <UserPicker
          users={users}
          excludeIds={memberIds}
          onPick={u => add(u.id)}
          placeholder="Add a member by name or email…"
        />

        <div style={{
          marginTop: 14, fontSize: 11, fontWeight: 800, color: 'var(--mist)',
          textTransform: 'uppercase', letterSpacing: '.06em',
        }}>
          Members ({members.length})
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {members.map(m => {
            const u = users.find(x => x.id === m.user_id)
            const name = u?.name || u?.email || '(unknown)'
            const isOwnerRow = m.role === 'owner'
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 8px', borderRadius: 6, background: 'var(--cream2)',
              }}>
                <Avatar name={name} photoUrl={u?.photo_url} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{name}</span>
                  <span style={{ fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {m.role}
                  </span>
                </span>
                {!isOwnerRow && (
                  <button onClick={() => remove(m.user_id)} disabled={busy}
                    title="Remove" aria-label={`Remove ${name}`}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--mist)', fontSize: 16, padding: '2px 6px',
                    }}>×</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
