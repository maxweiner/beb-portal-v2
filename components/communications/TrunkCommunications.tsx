'use client'

// Trunk Communications module entry point.
//
// Phase 3 only ships the Templates view (admin-managed letter
// content). Schedules, send flow, send log, and the recent-sends
// landing list arrive in subsequent phases.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import TemplateList from './TemplateList'
import TemplateEditor from './TemplateEditor'
import CommsLogPanel from './CommsLogPanel'
import SendFlow from './SendFlow'
import MasterChecklist from './MasterChecklist'
import type { CommunicationTemplate } from '@/types'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; template: CommunicationTemplate | null }
  | { kind: 'send'; trunkShowId?: string | null; templateId?: string | null }
  | { kind: 'master' }
  | { kind: 'log' }

export default function TrunkCommunications() {
  const { user, commsSendIntent, setCommsSendIntent } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [view, setView] = useState<View>({ kind: 'list' })

  // Consume deep-link intent from the per-show "Resend" button.
  useEffect(() => {
    if (!commsSendIntent) return
    setView({ kind: 'send', trunkShowId: commsSendIntent.trunkShowId, templateId: commsSendIntent.templateId })
    setCommsSendIntent(null)
  }, [commsSendIntent, setCommsSendIntent])

  if (!isAdmin && user?.role !== 'sales_rep') {
    return (
      <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ background: '#fff', padding: 24, borderRadius: 10, border: '1px solid var(--cream2)' }}>
          You don't have access to Trunk Communications.
        </div>
      </div>
    )
  }

  if (view.kind === 'edit') {
    return (
      <TemplateEditor
        template={view.template}
        canEdit={isAdmin}
        onClose={() => setView({ kind: 'list' })}
      />
    )
  }

  if (view.kind === 'send') {
    return (
      <SendFlow
        initialTrunkShowId={view.trunkShowId}
        initialTemplateId={view.templateId}
        onClose={() => setView({ kind: 'list' })}
        onSent={() => {
          alert('Letter sent — log entry recorded.')
          setView({ kind: 'list' })
        }}
      />
    )
  }

  if (view.kind === 'master') {
    return (
      <MasterChecklist
        canEdit={isAdmin}
        onClose={() => setView({ kind: 'list' })}
      />
    )
  }

  if (view.kind === 'log') {
    return (
      <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button onClick={() => setView({ kind: 'list' })} className="btn-outline btn-xs">← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>📨 Communications Log — All shows</h1>
        </div>
        <CommsLogPanel title="📨 Every send, scheduled or fired" />
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>📨 Trunk Communications</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setView({ kind: 'send' })} className="btn-primary btn-sm">📤 Send a letter</button>
          <button onClick={() => setView({ kind: 'log' })} className="btn-outline btn-sm">📨 Log</button>
          {isAdmin && (
            <>
              <button onClick={() => setView({ kind: 'master' })} className="btn-outline btn-sm">🗒 Master Checklist</button>
              <button onClick={() => setView({ kind: 'edit', template: null })} className="btn-outline btn-sm">+ New Template</button>
            </>
          )}
        </div>
      </div>

      <TemplateList
        canEdit={isAdmin}
        onOpen={(t) => setView({ kind: 'edit', template: t })}
      />

      <div style={{
        marginTop: 24, padding: 14, background: 'var(--cream2)',
        borderRadius: 8, fontSize: 12, color: 'var(--mist)',
      }}>
        <strong style={{ color: 'var(--ash)' }}>Coming in later phases:</strong>{' '}
        send schedules (when each template fires) · send flow (rep clicks Send to fire a letter) ·
        per-trunk-show communications log · auto-checked checklist items · dashboard reminders.
      </div>
    </div>
  )
}
