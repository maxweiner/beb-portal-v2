'use client'

// Manual lead capture form. Used both from the Leads list page
// and from inside a Trade Show (in which case captured_at_trade
// _show_id is pre-filled). Phase 7 will add a second tab for
// business-card scanning that pre-fills these fields from OCR.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { createLead } from '@/lib/sales/leads'
import type { Lead, LeadInterestLevel, LeadStatus } from '@/types'

interface Props {
  /** When set, the new lead is pre-linked to this trade show. */
  tradeShowId?: string
  onCreated: (lead: Lead) => void
  onClose: () => void
}

export default function AddLeadModal({ tradeShowId, onCreated, onClose }: Props) {
  const { user, users } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    first_name: '', last_name: '', company_name: '', title: '',
    email: '', phone: '', address_line_1: '', city: '', state: '', zip: '',
    website: '',
    assigned_rep_id: user?.id || '',
    interest_level: '' as '' | LeadInterestLevel,
    interest_description: '',
    follow_up_date: '',
    notes: '',
  })

  const valid = !!draft.first_name.trim() && !!draft.last_name.trim()

  // Sales reps (and admin / partner — they can self-assign).
  const repOptions = users
    .filter(u => u.active !== false)
    .filter(u => u.role === 'sales_rep' || u.role === 'admin' || u.role === 'superadmin' || u.is_partner)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const lead = await createLead({
        first_name: draft.first_name,
        last_name:  draft.last_name,
        company_name: draft.company_name,
        title:        draft.title,
        email:        draft.email,
        phone:        draft.phone,
        address_line_1: draft.address_line_1,
        city:         draft.city,
        state:        draft.state,
        zip:          draft.zip,
        website:      draft.website,
        assigned_rep_id: draft.assigned_rep_id || null,
        captured_at_trade_show_id: tradeShowId || null,
        captured_by_user_id: user?.id || null,
        interest_level: draft.interest_level || null,
        interest_description: draft.interest_description,
        follow_up_date: draft.follow_up_date || null,
        notes: draft.notes,
        status: 'new',
      })
      onCreated(lead)
    } catch (err: any) {
      setError(err?.message || 'Could not save')
      setBusy(false)
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '4vh 16px', overflowY: 'auto',
      }}>
      <div style={{ width: 'min(640px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            🎯 New Lead{tradeShowId ? ' (linked to this show)' : ''}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        {/* Identity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="First name" required>
            <input value={draft.first_name} onChange={e => setDraft(p => ({ ...p, first_name: e.target.value }))} autoFocus />
          </Field>
          <Field label="Last name" required>
            <input value={draft.last_name} onChange={e => setDraft(p => ({ ...p, last_name: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Company">
            <input value={draft.company_name} onChange={e => setDraft(p => ({ ...p, company_name: e.target.value }))} />
          </Field>
          <Field label="Title">
            <input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Email">
            <input type="email" value={draft.email} onChange={e => setDraft(p => ({ ...p, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={draft.phone} onChange={e => setDraft(p => ({ ...p, phone: e.target.value }))} />
          </Field>
        </div>

        {/* Address */}
        <Field label="Street address">
          <input value={draft.address_line_1} onChange={e => setDraft(p => ({ ...p, address_line_1: e.target.value }))} />
        </Field>
        <div className="grid gap-3" style={{ marginBottom: 8, gridTemplateColumns: '2fr 1fr 1fr' }}>
          <Field label="City">
            <input value={draft.city} onChange={e => setDraft(p => ({ ...p, city: e.target.value }))} />
          </Field>
          <Field label="State">
            <input value={draft.state} onChange={e => setDraft(p => ({ ...p, state: e.target.value }))} placeholder="NY" />
          </Field>
          <Field label="ZIP">
            <input value={draft.zip} onChange={e => setDraft(p => ({ ...p, zip: e.target.value }))} />
          </Field>
        </div>
        <Field label="Website">
          <input type="url" value={draft.website} onChange={e => setDraft(p => ({ ...p, website: e.target.value }))} placeholder="https://" />
        </Field>

        <hr style={{ border: 'none', borderTop: '1px solid var(--cream2)', margin: '14px 0' }} />

        {/* Pipeline */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Interest">
            <select value={draft.interest_level} onChange={e => setDraft(p => ({ ...p, interest_level: e.target.value as any }))}>
              <option value="">Not set</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌤️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </Field>
          <Field label="Follow-up date">
            <input type="date" value={draft.follow_up_date}
              onChange={e => setDraft(p => ({ ...p, follow_up_date: e.target.value }))} />
          </Field>
        </div>
        <Field label="What were they interested in?">
          <input value={draft.interest_description}
            onChange={e => setDraft(p => ({ ...p, interest_description: e.target.value }))}
            placeholder="e.g. Trunk show in their store" />
        </Field>
        <Field label="Assigned rep">
          <select value={draft.assigned_rep_id}
            onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))}>
            <option value="">Unassigned (admin will route)</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name} · {u.role.replace('_', ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={draft.notes}
            onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} />
        </Field>

        {error && (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
            {busy ? 'Saving…' : 'Save lead'}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--mist)' }}>
          Phase 8 will auto-assign by state-territory when the assigned-rep dropdown is left blank.
          Phase 7 will let you skip this form by scanning a business card.
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <label className="fl">{label}{required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}</label>
      {children}
    </div>
  )
}
