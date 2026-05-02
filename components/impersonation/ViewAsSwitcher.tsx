'use client'

// "View As" switcher control. Renders only when the current user
// is the hardcoded impersonator (max@bebllp.com). Lives directly
// above the sign-out button in both Sidebar.tsx (desktop) and
// MobileLayout.tsx (mobile menu).
//
// States:
//   - eligible + idle    →  "View as user…" button. Click → picker.
//   - eligible + active  →  "Viewing as {name}" + "Exit".
//   - not eligible       →  null (nothing rendered).
//
// No banners / toasts / title prefixes. The control's own label
// is the only impersonation indicator (per spec Q1 answer).

import { useEffect, useMemo, useState } from 'react'
import type { User } from '@/types'
import { useApp } from '@/lib/context'
import {
  isImpersonatorEmail,
  startImpersonation,
  stopImpersonation,
  useImpersonationStatus,
  type ImpersonationTarget,
} from '@/lib/impersonation/client'

interface Props {
  /** 'desktop' = compact for sidebar footer. 'mobile' = full-row
   *  button matching the mobile menu's row buttons. */
  variant: 'desktop' | 'mobile'
}

export default function ViewAsSwitcher({ variant }: Props) {
  const { user, users } = useApp()
  const eligible = isImpersonatorEmail(user?.email)
  const { status, refresh } = useImpersonationStatus(eligible)
  const [pickerOpen, setPickerOpen] = useState(false)

  const active = status?.active ? status.session : null

  // Cmd+Shift+E exits impersonation when active. Mounted only for
  // eligible users so it never fires on other accounts. Esc-Esc
  // would conflict with modal-close ergonomics elsewhere.
  useEffect(() => {
    if (!eligible || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void stopImpersonation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [eligible, active])

  if (!eligible) return null

  if (active) {
    return variant === 'desktop'
      ? <DesktopActive target={active.target} onExit={async () => { await stopImpersonation() }} />
      : <MobileActive   target={active.target} onExit={async () => { await stopImpersonation() }} />
  }

  return (
    <>
      {variant === 'desktop'
        ? <DesktopIdle onClick={() => setPickerOpen(true)} />
        : <MobileIdle  onClick={() => setPickerOpen(true)} />}
      {pickerOpen && (
        <PickerModal
          users={users}
          selfId={user?.id}
          onClose={() => setPickerOpen(false)}
          onPick={async (u) => {
            try {
              await startImpersonation(u.id)
            } catch (err: any) {
              setPickerOpen(false)
              alert(err?.message || 'Could not start impersonation')
              await refresh()
            }
          }}
        />
      )}
    </>
  )
}

// ── icons ──────────────────────────────────────────────────────

function EyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// ── desktop renderings ────────────────────────────────────────

function DesktopIdle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-outline btn-xs btn-full"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }}
      title="View as another user"
    >
      <EyeIcon /> View as user…
    </button>
  )
}

function DesktopActive({ target, onExit }: { target: ImpersonationTarget; onExit: () => void | Promise<void> }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
      padding: '6px 8px',
      background: 'rgba(255,255,255,.06)',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: 6,
      fontSize: 11,
    }}>
      <EyeIcon size={12} />
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontWeight: 700,
      }}
        title={`Viewing as ${target.name} (${target.email})`}
      >
        Viewing as {target.name}
      </span>
      <button
        onClick={onExit}
        style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
          color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11,
          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
        }}
      >Exit</button>
    </div>
  )
}

// ── mobile renderings ─────────────────────────────────────────
// Match the row style in MobileLayout.tsx so the control reads
// like one of the menu items (vs. a foreign callout).

function MobileIdle({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '14px 20px', background: 'transparent', border: 'none',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
      gap: 12, color: 'rgba(255,255,255,.85)', fontWeight: 700, fontSize: 14,
      textAlign: 'left', minHeight: 44,
    }}>
      <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
        <EyeIcon size={16} />
      </span>
      View as user…
    </button>
  )
}

function MobileActive({ target, onExit }: { target: ImpersonationTarget; onExit: () => void | Promise<void> }) {
  return (
    <div style={{
      width: '100%', padding: '10px 20px', display: 'flex', alignItems: 'center',
      gap: 10, color: 'rgba(255,255,255,.85)', fontSize: 13,
    }}>
      <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
        <EyeIcon size={16} />
      </span>
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontWeight: 700,
      }}>
        Viewing as {target.name}
      </span>
      <button onClick={onExit} style={{
        background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
        color: '#fff', borderRadius: 4, padding: '4px 10px', fontSize: 12,
        cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, minHeight: 32,
      }}>Exit</button>
    </div>
  )
}

// ── picker modal ──────────────────────────────────────────────

function PickerModal({
  users, selfId, onClose, onPick,
}: {
  users: User[]
  selfId: string | undefined
  onClose: () => void
  onPick: (u: User) => void | Promise<void>
}) {
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users
      .filter(u => u.active !== false)
      .filter(u => u.role !== 'pending')
      .filter(u => u.id !== selfId)
      .filter(u => !needle
        || u.name?.toLowerCase().includes(needle)
        || u.email?.toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .slice(0, 20)
  }, [users, q, selfId])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        zIndex: 9999, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', paddingTop: '10vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', color: 'var(--ink)', width: 'min(420px, 92vw)',
          borderRadius: 10, padding: 14, boxShadow: '0 12px 40px rgba(0,0,0,.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 800 }}>View as user…</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, lineHeight: 1, color: 'var(--mist)',
          }}>×</button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name or email…"
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14,
            border: '1px solid var(--pearl)', borderRadius: 6,
            background: '#fff', color: 'var(--ink)', marginBottom: 10,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{
          maxHeight: 320, overflowY: 'auto',
          border: '1px solid var(--cream2)', borderRadius: 6,
        }}>
          {matches.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--mist)' }}>
              No users match.
            </div>
          ) : matches.map(u => (
            <button
              key={u.id}
              onClick={async () => { setBusyId(u.id); try { await onPick(u) } finally { setBusyId(null) } }}
              disabled={!!busyId}
              style={{
                display: 'flex', width: '100%', textAlign: 'left',
                padding: '10px 12px', background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--cream2)',
                cursor: busyId ? 'default' : 'pointer',
                fontFamily: 'inherit', alignItems: 'center', gap: 10,
                opacity: busyId && busyId !== u.id ? 0.5 : 1,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 13, fontWeight: 700,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{u.name || '(no name)'}</span>
                <span style={{
                  display: 'block', fontSize: 11, color: 'var(--mist)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{u.email}</span>
              </span>
              <RoleBadge role={u.role} />
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)', lineHeight: 1.4 }}>
          Showing {matches.length} of {users.length} users. Page reloads on select.
        </div>
      </div>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const display = (role || '').replace('_', ' ')
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 4,
      background: 'var(--cream2)', color: 'var(--ink)',
      flexShrink: 0,
    }}>{display}</span>
  )
}
