'use client'

// Marketing → Settings parent. Renders only for superadmin (gated upstream
// by Marketing.tsx). Six sub-panels matching the 5 spec sections plus the
// "Marketing Access" grant/revoke toggle the user explicitly asked for.

import { useState } from 'react'
import MarketingAccessPanel from './settings/MarketingAccessPanel'
import ApproversPanel from './settings/ApproversPanel'
import TeamEmailsPanel from './settings/TeamEmailsPanel'
import PaymentMethodsPanel from './settings/PaymentMethodsPanel'
import LeadTimesPanel from './settings/LeadTimesPanel'
import EmailTemplatesPanel from './settings/EmailTemplatesPanel'

type Section = 'access' | 'approvers' | 'team' | 'payment' | 'lead' | 'templates'

const SECTIONS: [Section, string, string][] = [
  ['access',    'Access',          'Grant or revoke marketing access on a per-user basis.'],
  ['approvers', 'Approvers',       'Users who can approve planning, proofs, and payment requests.'],
  ['team',      'Team Emails',     'Recipients of "Notify Marketing Team" emails (Collected Concepts).'],
  ['payment',   'Payment Methods', 'Saved card labels (e.g., "Max Amex 6006"). No card numbers stored.'],
  ['lead',      'Lead Times',      'Days before event start to mail by, per flow type.'],
  ['templates', 'Email Templates', 'Editable subject + body for marketing notifications.'],
]

export default function MarketingSettings() {
  const [section, setSection] = useState<Section>('access')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      {/* Section nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map(([id, label, desc]) => {
          const sel = section === id
          return (
            <button key={id} onClick={() => setSection(id)} style={{
              // Fill the 220px nav column so the description text wraps
              // inside the card instead of overflowing into the right
              // panel. Buttons default to inline-block; force block + 100%.
              display: 'block', width: '100%',
              textAlign: 'left', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--pearl)',
              background: sel ? 'var(--green-pale)' : '#fff',
              color: sel ? 'var(--green-dark)' : 'var(--ink)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{label}</div>
              <div style={{
                fontSize: 11, color: 'var(--mist)', marginTop: 2, lineHeight: 1.3,
                wordBreak: 'break-word',
              }}>
                {desc}
              </div>
            </button>
          )
        })}
      </nav>

      {/* Active section */}
      <div>
        {section === 'access'    && <MarketingAccessPanel />}
        {section === 'approvers' && <ApproversPanel />}
        {section === 'team'      && <TeamEmailsPanel />}
        {section === 'payment'   && <PaymentMethodsPanel />}
        {section === 'lead'      && <LeadTimesPanel />}
        {section === 'templates' && <EmailTemplatesPanel />}
      </div>
    </div>
  )
}
