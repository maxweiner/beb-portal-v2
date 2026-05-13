'use client'

// Expenses & Invoicing — main entry point.
//
// Renders list ↔ detail, plus the "Submitting for:" picker at the
// top when the current user has active expense_delegates rows
// pointing at them (i.e. someone — usually Max — has paired them
// as a delegate for one or more principals).
//
// The picker re-scopes the whole module to the selected principal:
//   - List view shows the principal's reports, drafts, picker
//     gates, etc.
//   - Detail view treats the caller as the effective owner for
//     mutation gates (canMutate / isOwner).
//   - All four owner-only API routes (mark-paid, recall,
//     upload-receipt, calculate-mileage) accept a delegate via
//     canActOnReport() server-side, matching the client semantic.
//
// Outside this module the user stays themselves — `effectiveUserId`
// is local component state, NOT in lib/context.tsx. That's
// intentional per the spec: scoped delegation, narrower blast
// radius than full impersonation.
//
// Persistence: sessionStorage so the picker survives nav-away-and-
// back inside the same tab session, but a hard refresh resets to
// the user's own queue. Keeps the surface non-sticky.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import ExpensesList from './ExpensesList'
import ExpenseReportDetail from './ExpenseReportDetail'

interface DelegationOption {
  principal_user_id: string
  principal_name: string
}

const PICKER_SESSION_KEY = 'beb-expenses-effective-user-id'

export default function Expenses() {
  const { user } = useApp()
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  // Active delegations where the current user is the delegate. RLS
  // on expense_delegates lets the delegate read their own rows.
  // Empty list → picker doesn't render.
  const [delegations, setDelegations] = useState<DelegationOption[]>([])
  const [delegationsLoaded, setDelegationsLoaded] = useState(false)

  // effectiveUserId carries the "Submitting for:" selection through
  // to the list + detail views. Starts as the real user; the picker
  // can flip it to a principal.
  const [effectiveUserId, setEffectiveUserId] = useState<string>('')

  // Hydrate effectiveUserId from sessionStorage on first paint so a
  // nav-away-and-back inside the same tab restores the picker
  // state.
  useEffect(() => {
    if (!user) return
    const stored = typeof window !== 'undefined'
      ? window.sessionStorage.getItem(PICKER_SESSION_KEY)
      : null
    setEffectiveUserId(stored || user.id)
  }, [user])

  // Load active delegations for the current user.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const { data: rows, error } = await supabase
        .from('expense_delegates')
        .select('principal_user_id')
        .eq('delegate_user_id', user.id)
        .is('revoked_at', null)
      if (cancelled) return
      if (error || !rows || rows.length === 0) {
        setDelegations([])
        setDelegationsLoaded(true)
        return
      }
      // Resolve principal names in a separate query — the foreign-table
      // shorthand `principal:principal_user_id ( name )` doesn't always
      // pass RLS cleanly across brands, so we look up names separately.
      const ids = Array.from(new Set(rows.map(r => r.principal_user_id)))
      const { data: us } = await supabase
        .from('users')
        .select('id, name')
        .in('id', ids)
      if (cancelled) return
      const nameById = new Map((us || []).map(u => [u.id, u.name]))
      setDelegations(
        rows.map(r => ({
          principal_user_id: r.principal_user_id,
          principal_name: nameById.get(r.principal_user_id) || 'Unknown user',
        })),
      )
      setDelegationsLoaded(true)
    })()
    return () => { cancelled = true }
  }, [user])

  // When the picker changes, persist + reset detail view (otherwise
  // we'd be looking at a report owned by the old principal while
  // the list scope has flipped to the new one).
  const handlePickerChange = (id: string) => {
    setEffectiveUserId(id)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PICKER_SESSION_KEY, id)
    }
    setSelectedReportId(null)
  }

  // Deep-link from elsewhere in the app (e.g. partner approvals modal).
  // When opened externally, drop back to the caller's own context so
  // the deep-linked report opens scoped to its owner — the picker
  // doesn't apply to externally-routed deep links.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ reportId?: string }>).detail?.reportId
      if (id) {
        if (user) {
          setEffectiveUserId(user.id)
          if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(PICKER_SESSION_KEY)
          }
        }
        setSelectedReportId(id)
      }
    }
    window.addEventListener('beb:open-expense-report', onOpen)
    return () => window.removeEventListener('beb:open-expense-report', onOpen)
  }, [user])

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>
        Sign in to view expenses.
      </div>
    )
  }

  // Resolve the active id passed downward. Falls back to user.id
  // until the picker has hydrated to avoid a flash of empty state
  // on first render.
  const activeUserId = effectiveUserId || user.id
  const isDelegating = activeUserId !== user.id

  const picker = delegationsLoaded && delegations.length > 0 ? (
    <div style={{
      padding: '10px 14px',
      background: isDelegating ? '#FEF3C7' : 'var(--cream2)',
      borderRadius: 10,
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
        🤝 Submitting for:
      </span>
      <select
        value={activeUserId}
        onChange={e => handlePickerChange(e.target.value)}
        style={{ fontSize: 13, padding: '6px 10px', fontFamily: 'inherit' }}
      >
        <option value={user.id}>Me ({user.name})</option>
        {delegations.map(d => (
          <option key={d.principal_user_id} value={d.principal_user_id}>
            {d.principal_name}
          </option>
        ))}
      </select>
      {isDelegating && (
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#92400E',
          padding: '4px 10px',
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #FCD34D',
        }}>
          ⚠ Acting on behalf — the resulting report is owned by{' '}
          {delegations.find(d => d.principal_user_id === activeUserId)?.principal_name}
        </span>
      )}
    </div>
  ) : null

  if (selectedReportId) {
    return (
      <>
        {picker}
        <ExpenseReportDetail
          reportId={selectedReportId}
          onBack={() => setSelectedReportId(null)}
          effectiveUserId={activeUserId}
        />
      </>
    )
  }

  return (
    <>
      {picker}
      <ExpensesList
        onOpen={(reportId) => setSelectedReportId(reportId)}
        effectiveUserId={activeUserId}
      />
    </>
  )
}
