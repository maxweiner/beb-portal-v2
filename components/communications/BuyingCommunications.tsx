'use client'

// Buying Communications module — parallel to TrunkCommunications.
// Phase 1 (this PR): templates list + edit + AI generator. Phase 2
// adds the send flow + comms log. Phase 3 adds master checklist +
// schedules.
//
// Architecture: shares TemplateList + TemplateEditor + AiTemplateModal
// with the trunk module via a `domain='buying'` prop on each. Schema
// and API routes are fully separate per Max's option-A choice; the
// React components are shared because their UI is identical.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import TemplateList from './TemplateList'
import TemplateEditor from './TemplateEditor'
import AiTemplateModal from './AiTemplateModal'
import BuyingSendFlow from './BuyingSendFlow'
import type { CommunicationTemplate } from '@/types'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; template: CommunicationTemplate | null }
  | { kind: 'send'; eventId?: string | null; templateId?: string | null }

export default function BuyingCommunications() {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [view, setView] = useState<View>({ kind: 'list' })
  const [aiModal, setAiModal] = useState<
    | { mode: 'new' }
    | { mode: 'refine'; existing: CommunicationTemplate }
    | null
  >(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)

  if (!isAdmin) {
    return (
      <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ background: '#fff', padding: 24, borderRadius: 10, border: '1px solid var(--cream2)' }}>
          You don&apos;t have access to Buying Communications.
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
        domain="buying"
      />
    )
  }

  if (view.kind === 'send') {
    return (
      <BuyingSendFlow
        initialEventId={view.eventId}
        initialTemplateId={view.templateId}
        onClose={() => setView({ kind: 'list' })}
        onSent={() => {
          alert('Letter sent — log entry recorded.')
          setView({ kind: 'list' })
        }}
      />
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>📨 Buying Communications</h1>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
            Templates for emails sent to store contacts about upcoming buying events. Send flow + log land in phase 2.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setView({ kind: 'send' })} className="btn-primary btn-sm">📤 Send a letter</button>
          <button
            onClick={() => setAiModal({ mode: 'new' })}
            className="btn-outline btn-sm"
            title="Generate a brand-new template from a description (Claude Haiku 4.5)"
          >✨ New with AI</button>
          <button onClick={() => setView({ kind: 'edit', template: null })} className="btn-outline btn-sm">+ New Template</button>
        </div>
      </div>

      <TemplateList
        key={listRefreshKey}
        canEdit={isAdmin}
        onOpen={(t) => setView({ kind: 'edit', template: t })}
        onRefineWithAi={(t) => setAiModal({ mode: 'refine', existing: t })}
        domain="buying"
      />

      {aiModal && (
        <AiTemplateModal
          mode={aiModal.mode}
          existing={aiModal.mode === 'refine' ? aiModal.existing : null}
          onClose={() => setAiModal(null)}
          onSaved={() => {
            setAiModal(null)
            setListRefreshKey(k => k + 1)
          }}
          domain="buying"
        />
      )}

      <div style={{
        marginTop: 24, padding: 14, background: 'var(--cream2)',
        borderRadius: 8, fontSize: 12, color: 'var(--mist)',
      }}>
        <strong style={{ color: 'var(--ash)' }}>Coming in later phases:</strong>{' '}
        per-event communications log · master checklist · auto-send schedules tied to event dates.
        <br />
        <strong style={{ color: 'var(--ash)' }}>Sends are gated</strong> behind a kill switch — an admin must enable
        them in Settings → Buying Comms → Sending enabled before the Send button actually fires.
      </div>
    </div>
  )
}
