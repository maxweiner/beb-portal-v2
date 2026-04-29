'use client'

// Avatar + first-name button in the dashboard hero. Click opens a 360-px
// popover anchored below the trigger with: profile header, the user's
// upcoming-events list (shared with the mobile sheet), and Sign Out.
// The hero has `overflow: hidden` so the popover renders fixed-positioned
// against the viewport via getBoundingClientRect.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Event } from '@/types'
import type { NavPage } from '@/app/page'
import MyUpcomingEventsList from './MyUpcomingEventsList'

export default function ProfileTrigger({
  user, setNav,
}: {
  user: User | null
  setNav?: (n: NavPage) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      const width = 360
      const left = Math.min(Math.max(r.left, 12), window.innerWidth - width - 12)
      setPos({ top: r.bottom + 8, left })
    }
    place()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onDocClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  const initial = (user?.name?.charAt(0) || '?').toUpperCase()
  const roleLabel = user?.role === 'superadmin' ? 'Super Admin'
    : user?.role === 'admin' ? 'Admin'
    : user?.role === 'buyer' ? 'Buyer'
    : user?.role === 'pending' ? 'Pending' : ''

  const onOpenEvent = (_ev: Event) => {
    setOpen(false)
    setNav?.('events')
  }

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(v => !v)} style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 12,
        fontFamily: 'inherit', color: '#fff', marginTop: 2,
      }}>
        {user?.photo_url ? (
          <img src={user.photo_url} alt="" style={{
            width: 38, height: 38, borderRadius: '50%', objectFit: 'cover',
            border: '2px solid rgba(255,255,255,.25)', flexShrink: 0,
          }} />
        ) : (
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'rgba(255,255,255,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 900, fontSize: 16,
            border: '2px solid rgba(255,255,255,.25)', flexShrink: 0,
          }}>{initial}</div>
        )}
        <span style={{
          fontSize: 28, fontWeight: 900, color: '#fff',
          letterSpacing: '-.02em', display: 'inline-flex', alignItems: 'baseline', gap: 6,
          lineHeight: 1.1,
        }}>
          {user?.name?.split(' ')[0]}
          <span aria-hidden style={{ fontSize: 14, opacity: .7, fontWeight: 500 }}>▾</span>
        </span>
      </button>

      {open && pos && (
        <div ref={popRef} style={{
          position: 'fixed', top: pos.top, left: pos.left,
          width: 360, maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: 'var(--card-bg, #fff)',
          border: '1px solid var(--pearl)',
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
          zIndex: 1100,
          animation: 'ptFade .15s ease-out',
        }}>
          <style>{`@keyframes ptFade { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }`}</style>

          {/* Header */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 16px 14px' }}>
            {user?.photo_url ? (
              <img src={user.photo_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--green)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 20, flexShrink: 0,
              }}>{initial}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 15, fontWeight: 900, color: 'var(--ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user?.name}
              </div>
              {roleLabel && (
                <div style={{
                  fontSize: 10, fontWeight: 800, color: 'var(--green-dark)',
                  textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 2,
                }}>
                  {roleLabel}
                </div>
              )}
              {user?.email && (
                <div style={{
                  fontSize: 12, color: 'var(--mist)', marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {user.email}
                </div>
              )}
            </div>
          </div>

          {/* My events */}
          <div style={{ padding: '12px 12px 14px', borderTop: '1px solid var(--cream2)' }}>
            <MyUpcomingEventsList onOpenEvent={onOpenEvent} />
          </div>

          {/* Footer */}
          <button onClick={() => supabase.auth.signOut()} style={{
            display: 'block', width: '100%', padding: '12px',
            background: 'var(--cream2)', border: 'none', borderTop: '1px solid var(--pearl)',
            cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--ink)',
            fontFamily: 'inherit', letterSpacing: '.02em',
          }}>
            Sign Out
          </button>
        </div>
      )}
    </>
  )
}
