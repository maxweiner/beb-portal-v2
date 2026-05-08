'use client'

// Lead detail page. Editable per-section autosave on the standard
// fields, plus a per-kind "captured profile" panel for buying-event
// and trunk-show leads (the prospect-research fields the rep gathered
// up front). Convert button branches on lead_kind:
//   • trade_show   — opens the legacy ConvertModal (manual store +
//                    trunk-show create)
//   • buying_event — opens BuyingConvertModal → POST /api/leads/.../convert
//   • trunk_show   — opens TrunkConvertModal  → POST /api/leads/.../convert

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { supabase } from '@/lib/supabase'
import { getLead, updateLead, softDeleteLead } from '@/lib/sales/leads'
import { createTrunkShow } from '@/lib/sales/trunkShows'
import type { Lead, LeadInterestLevel, LeadStatus } from '@/types'
import type { NavPage } from '@/app/page'
import DatePicker from '@/components/ui/DatePicker'

interface Props {
  leadId: string
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
  setNav?: (n: NavPage) => void
}

export default function LeadDetail({ leadId, onBack, onChanged, onDeleted, setNav }: Props) {
  const { user, users, stores } = useApp()
  const [convertOpen, setConvertOpen] = useState(false)
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const canMutate = isAdmin || user?.role === 'sales_rep'
  const [lead, setLead] = useState<Lead | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    first_name: string; last_name: string; company_name: string; title: string
    email: string; phone: string
    address_line_1: string; address_line_2: string; city: string; state: string; zip: string
    website: string
    assigned_rep_id: string
    status: LeadStatus
    interest_level: '' | LeadInterestLevel
    interest_description: string
    follow_up_date: string
    notes: string
  }>({
    first_name: '', last_name: '', company_name: '', title: '',
    email: '', phone: '',
    address_line_1: '', address_line_2: '', city: '', state: '', zip: '',
    website: '',
    assigned_rep_id: '',
    status: 'new',
    interest_level: '',
    interest_description: '',
    follow_up_date: '',
    notes: '',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await getLead(leadId)
        if (cancelled) return
        if (!row) { setError('Lead not found.'); setLoaded(true); return }
        setLead(row)
        setDraft({
          first_name:    row.first_name || '',
          last_name:     row.last_name || '',
          company_name:  row.company_name || '',
          title:         row.title || '',
          email:         row.email || '',
          phone:         row.phone || '',
          address_line_1: row.address_line_1 || '',
          address_line_2: row.address_line_2 || '',
          city:          row.city || '',
          state:         row.state || '',
          zip:           row.zip || '',
          website:       row.website || '',
          assigned_rep_id: row.assigned_rep_id || '',
          status:        row.status,
          interest_level: row.interest_level || '',
          interest_description: row.interest_description || '',
          follow_up_date: row.follow_up_date || '',
          notes:         row.notes || '',
        })
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Failed to load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [leadId])

  const status = useAutosave(
    draft,
    async (d) => {
      if (!lead || !canMutate) return
      await updateLead(lead.id, {
        first_name: d.first_name || lead.first_name,
        last_name:  d.last_name  || lead.last_name,
        company_name: d.company_name,
        title:        d.title,
        email:        d.email,
        phone:        d.phone,
        address_line_1: d.address_line_1,
        address_line_2: d.address_line_2,
        city:           d.city,
        state:          d.state,
        zip:            d.zip,
        website:        d.website,
        assigned_rep_id: d.assigned_rep_id || null,
        status:         d.status,
        interest_level: d.interest_level || null,
        interest_description: d.interest_description,
        follow_up_date: d.follow_up_date || null,
        notes:          d.notes,
      })
      onChanged()
    },
    { delay: 800, enabled: loaded && !!lead && draft.first_name.trim().length > 0
                          && draft.last_name.trim().length > 0 && canMutate },
  )

  async function handleDelete() {
    if (!lead || !isAdmin) return
    if (!confirm(`Delete lead "${lead.first_name} ${lead.last_name}"? Soft-deletes the row.`)) return
    try {
      await softDeleteLead(lead.id)
      onDeleted()
    } catch (err: any) {
      alert(err?.message || 'Could not delete')
    }
  }

  // Trunk rep pool only — must have is_trunk_rep flag set in
  // Admin → Users.
  const repOptions = users
    .filter(u => u.active !== false)
    .filter(u => (u as any).is_trunk_rep === true)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  if (!loaded) return <div className="p-6 text-center" style={{ color: 'var(--mist)' }}>Loading…</div>
  if (error || !lead) return (
    <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onBack} className="btn-outline btn-sm" style={{ marginBottom: 14 }}>← Leads</button>
      <div className="card" style={{ padding: 20, color: '#991B1B', background: '#FEE2E2' }}>{error || 'Not found'}</div>
    </div>
  )

  return (
    <div className="p-6" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn-outline btn-sm">← Leads</button>
        <div style={{ flex: 1 }} />
        <AutosaveIndicator status={status} />
        {lead.status !== 'converted' && (
          <button onClick={() => setConvertOpen(true)} className="btn-primary btn-sm">
            {convertButtonLabel(lead.lead_kind)}
          </button>
        )}
        {lead.status === 'converted' && (
          <button
            onClick={() => {
              if (lead.lead_kind === 'buying_event') setNav?.('buying-events')
              else if (lead.lead_kind === 'trunk_show') setNav?.('trunk-shows')
              else setNav?.('trunk-shows')
            }}
            className="btn-outline btn-sm"
          >
            {viewConvertedTargetLabel(lead.lead_kind)}
          </button>
        )}
        {isAdmin && (
          <button onClick={handleDelete} className="btn-outline btn-sm" style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>
            Delete
          </button>
        )}
      </div>

      {convertOpen && lead.lead_kind === 'trade_show' && (
        <ConvertModal
          lead={lead}
          repOptions={repOptions}
          onClose={() => setConvertOpen(false)}
          onConverted={async () => {
            setConvertOpen(false)
            onChanged()
            try {
              const fresh = await getLead(lead.id)
              if (fresh) setLead(fresh)
            } catch { /* swallow */ }
            setNav?.('trunk-shows')
          }}
        />
      )}
      {convertOpen && lead.lead_kind === 'buying_event' && (
        <BuyingConvertModal
          lead={lead}
          onClose={() => setConvertOpen(false)}
          onConverted={async () => {
            setConvertOpen(false)
            onChanged()
            try {
              const fresh = await getLead(lead.id)
              if (fresh) setLead(fresh)
            } catch { /* swallow */ }
            setNav?.('buying-events')
          }}
        />
      )}
      {convertOpen && lead.lead_kind === 'trunk_show' && (
        <TrunkConvertModal
          lead={lead}
          repOptions={repOptions}
          onClose={() => setConvertOpen(false)}
          onConverted={async () => {
            setConvertOpen(false)
            onChanged()
            try {
              const fresh = await getLead(lead.id)
              if (fresh) setLead(fresh)
            } catch { /* swallow */ }
            setNav?.('trunk-shows')
          }}
        />
      )}

      {/* Identity */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="First name" required>
            <input value={draft.first_name} onChange={e => setDraft(p => ({ ...p, first_name: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Last name" required>
            <input value={draft.last_name} onChange={e => setDraft(p => ({ ...p, last_name: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Company">
            <input value={draft.company_name} onChange={e => setDraft(p => ({ ...p, company_name: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Title">
            <input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Email">
            <input type="email" value={draft.email} onChange={e => setDraft(p => ({ ...p, email: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={draft.phone} onChange={e => setDraft(p => ({ ...p, phone: e.target.value }))} disabled={!canMutate} />
          </Field>
        </div>
      </div>

      {/* Address */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Address
        </div>
        <Field label="Street">
          <input value={draft.address_line_1} onChange={e => setDraft(p => ({ ...p, address_line_1: e.target.value }))} disabled={!canMutate} />
        </Field>
        <Field label="Suite / Apt">
          <input value={draft.address_line_2} onChange={e => setDraft(p => ({ ...p, address_line_2: e.target.value }))} disabled={!canMutate} />
        </Field>
        <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
          <Field label="City">
            <input value={draft.city} onChange={e => setDraft(p => ({ ...p, city: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="State">
            <input value={draft.state} onChange={e => setDraft(p => ({ ...p, state: e.target.value }))} disabled={!canMutate} placeholder="NY" />
          </Field>
          <Field label="ZIP">
            <input value={draft.zip} onChange={e => setDraft(p => ({ ...p, zip: e.target.value }))} disabled={!canMutate} />
          </Field>
        </div>
        <Field label="Website">
          <input type="url" value={draft.website} onChange={e => setDraft(p => ({ ...p, website: e.target.value }))} disabled={!canMutate} />
        </Field>
      </div>

      {/* Pipeline */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Pipeline
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Status">
            <select value={draft.status} onChange={e => setDraft(p => ({ ...p, status: e.target.value as LeadStatus }))} disabled={!canMutate}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="converted">Converted</option>
              <option value="dead">Dead</option>
            </select>
          </Field>
          <Field label="Assigned rep">
            <select value={draft.assigned_rep_id}
              onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))}
              disabled={!canMutate}>
              <option value="">Unassigned</option>
              {repOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Interest">
            <select value={draft.interest_level}
              onChange={e => setDraft(p => ({ ...p, interest_level: e.target.value as any }))}
              disabled={!canMutate}>
              <option value="">Not set</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌤️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </Field>
          <Field label="Follow-up date">
            <DatePicker value={draft.follow_up_date}
              onChange={v => setDraft(p => ({ ...p, follow_up_date: v }))} disabled={!canMutate} />
          </Field>
        </div>
        <Field label="Interest description">
          <input value={draft.interest_description}
            onChange={e => setDraft(p => ({ ...p, interest_description: e.target.value }))}
            disabled={!canMutate} />
        </Field>
        <Field label="Notes">
          <textarea rows={4} value={draft.notes}
            onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} disabled={!canMutate} />
        </Field>
      </div>

      {/* Per-kind captured profile (read-only — gathered at lead time) */}
      {lead.lead_kind === 'buying_event' && <BuyingProfile lead={lead} />}
      {lead.lead_kind === 'trunk_show' && <TrunkProfile lead={lead} />}
    </div>
  )
}

/* ── Per-kind captured profile read-out ──────────────────── */

const PARKING_LABEL: Record<string, string> = {
  own_lot: 'Own Lot', shared_lot: 'Shared Lot', street: 'Street', none: 'None',
}
const SQ_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

function ProfileSection({ title, rows }: {
  title: string
  rows: { label: string; value: any }[]
}) {
  // Skip the section entirely when nothing is filled in.
  const visible = rows.filter(r => r.value !== null && r.value !== undefined && r.value !== '')
  if (visible.length === 0) return null
  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
        {title}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map(r => (
          <div key={r.label}>
            <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{r.label}</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{String(r.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function yn(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return v ? 'Yes' : 'No'
}

function BuyingProfile({ lead }: { lead: Lead }) {
  return (
    <ProfileSection title="Captured store profile" rows={[
      { label: 'Best time of year', value: lead.best_time_of_year },
      { label: 'Year established', value: lead.year_established },
      { label: 'Square footage', value: lead.sq_footage ? SQ_LABEL[lead.sq_footage] : null },
      { label: 'Parking', value: lead.parking ? PARKING_LABEL[lead.parking] : null },
      { label: 'Freestanding building', value: yn(lead.freestanding) },
      { label: 'Currently buys estate jewelry', value: yn(lead.currently_buys) },
      { label: 'Store phone', value: lead.store_phone },
      { label: 'Cell phone', value: lead.cell_phone },
      { label: 'Referral source', value: lead.referral_source },
    ]} />
  )
}

function TrunkProfile({ lead }: { lead: Lead }) {
  return (
    <ProfileSection title="Captured store profile" rows={[
      { label: 'Locking cases', value: yn(lead.locking_cases) },
      { label: 'Rated safe on premises', value: yn(lead.rated_safe) },
      { label: '# of sales staff', value: lead.sales_staff_count },
      { label: 'Years in business', value: lead.years_in_business },
      { label: 'Sells estate jewelry now', value: yn(lead.sells_estate_jewelry) },
      { label: 'Distance to airport (mi)', value: lead.distance_to_airport_miles },
      { label: 'Store phone', value: lead.store_phone },
      { label: 'Cell phone', value: lead.cell_phone },
      { label: 'Referral source', value: lead.referral_source },
    ]} />
  )
}

function convertButtonLabel(kind: Lead['lead_kind']): string {
  if (kind === 'buying_event') return '✨ Convert + Reserve Buying Event'
  if (kind === 'trunk_show')   return '✨ Convert + Reserve Trunk Show'
  return '✨ Convert to Trunk Show'
}

function viewConvertedTargetLabel(kind: Lead['lead_kind']): string {
  if (kind === 'buying_event') return 'View buying events →'
  if (kind === 'trunk_show')   return 'View trunk shows →'
  return 'View trunk shows →'
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <label className="fl">{label}{required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}</label>
      {children}
    </div>
  )
}

/* ── Convert-to-Trunk-Show modal ─────────────────────────── */

function ConvertModal({
  lead, repOptions, onClose, onConverted,
}: {
  lead: Lead
  repOptions: any[]
  onClose: () => void
  onConverted: () => void | Promise<void>
}) {
  const { stores } = useApp()
  const [storeId, setStoreId] = useState<string>(lead.converted_to_store_id || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [repId, setRepId] = useState<string>(lead.assigned_rep_id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // If a store name happens to match the lead's company exactly,
  // suggest it as the default store.
  const matchByCompany = useMemo(() => {
    if (!lead.company_name) return null
    const norm = (s: string | null) => (s || '').toLowerCase().trim()
    return stores.find(s => norm(s.name) === norm(lead.company_name)) || null
  }, [stores, lead.company_name])
  useEffect(() => {
    if (!storeId && matchByCompany) setStoreId(matchByCompany.id)
  }, [matchByCompany, storeId])

  const valid = !!storeId && !!startDate && !!endDate
                 && endDate >= startDate && !!repId

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const ts = await createTrunkShow({
        store_id: storeId,
        start_date: startDate,
        end_date: endDate,
        assigned_rep_id: repId,
      })
      // Mark the lead converted + record the linked store.
      await updateLead(lead.id, {
        status: 'converted',
        // assigned_rep_id stays whatever it was; it's a separate axis.
      })
      // updateLead doesn't accept converted_to_store_id since it's
      // not in LeadDraft — patch directly.
      const { error: patchErr } = await supabase
        .from('leads').update({ converted_to_store_id: storeId }).eq('id', lead.id)
      if (patchErr) throw new Error(patchErr.message)
      await onConverted()
    } catch (e: any) {
      setErr(e?.message || 'Could not convert')
      setBusy(false)
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 16px',
      }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            ✨ Convert to Trunk Show
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 12 }}>
          Creates a trunk show at the linked store and marks
          <strong> {lead.first_name} {lead.last_name}</strong> as converted.
          The lead row stays for history.
        </div>

        <Field label="Store" required>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">Pick a store…</option>
            {stores.filter(s => s.active !== false)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.city ? ` · ${s.city}, ${s.state}` : ''}
                </option>
              ))}
          </select>
          {!matchByCompany && lead.company_name && !storeId && (
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
              No store found matching "{lead.company_name}". Pick one or have an admin create the store first.
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Start date" required>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="End date" required>
            <DatePicker value={endDate} onChange={setEndDate} />
          </Field>
        </div>
        <Field label="Assigned rep" required>
          <select value={repId} onChange={e => setRepId(e.target.value)}>
            <option value="">Pick a rep…</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>

        {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
            {busy ? 'Converting…' : 'Convert + create trunk show'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Buying-event convert modal ──────────────────────────── */

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function BuyingConvertModal({
  lead, onClose, onConverted,
}: {
  lead: Lead
  onClose: () => void
  onConverted: () => void | Promise<void>
}) {
  const [startDate, setStartDate] = useState('')
  const [buyersNeeded, setBuyersNeeded] = useState('3')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = !!startDate

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          start_date: startDate,
          buyers_needed: Number(buyersNeeded) || 3,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Convert failed (${r.status})`)
      await onConverted()
    } catch (e: any) {
      setErr(e?.message || 'Could not convert')
      setBusy(false)
    }
  }

  return (
    <ConvertShell title="✨ Convert + Reserve Buying Event" onClose={onClose}
      preface={<>Creates a <strong>{lead.company_name || 'store'}</strong> store record (if missing)
        and a 📌 reserved (Save the Date) buying event on the chosen date. The lead row stays for history.</>}>
      <Field label="Start date" required>
        <DatePicker value={startDate} onChange={setStartDate} />
      </Field>
      <Field label="Buyers needed">
        <input type="number" min={1} max={20} step={1} value={buyersNeeded}
          onChange={e => setBuyersNeeded(e.target.value)} style={{ width: 120 }} />
      </Field>
      {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <ConvertActions onClose={onClose} disabled={!valid || busy} busy={busy}
        confirmLabel="Save the Date" onConfirm={submit} />
    </ConvertShell>
  )
}

/* ── Trunk-show convert modal ────────────────────────────── */

function TrunkConvertModal({
  lead, repOptions, onClose, onConverted,
}: {
  lead: Lead
  repOptions: any[]
  onClose: () => void
  onConverted: () => void | Promise<void>
}) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [repId, setRepId] = useState<string>(lead.assigned_rep_id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = !!startDate && !!endDate && endDate >= startDate && !!repId

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          assigned_rep_id: repId,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Convert failed (${r.status})`)
      await onConverted()
    } catch (e: any) {
      setErr(e?.message || 'Could not convert')
      setBusy(false)
    }
  }

  return (
    <ConvertShell title="✨ Convert + Reserve Trunk Show" onClose={onClose}
      preface={<>Creates a <strong>{lead.company_name || 'store'}</strong> trunk-show store (if missing)
        and a 📌 reserved (Save the Date) trunk show on the chosen dates. The lead row stays for history.</>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
        <Field label="Start date" required>
          <DatePicker value={startDate} onChange={setStartDate} />
        </Field>
        <Field label="End date" required>
          <DatePicker value={endDate} onChange={setEndDate} />
        </Field>
      </div>
      <Field label="Assigned rep" required>
        <select value={repId} onChange={e => setRepId(e.target.value)}>
          <option value="">Pick a rep…</option>
          {repOptions.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </Field>
      {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <ConvertActions onClose={onClose} disabled={!valid || busy} busy={busy}
        confirmLabel="Save the Date" onConfirm={submit} />
    </ConvertShell>
  )
}

/* ── Shared modal shell ──────────────────────────────────── */

function ConvertShell({ title, preface, onClose, children }: {
  title: string
  preface: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 16px',
      }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 12 }}>{preface}</div>
        {children}
      </div>
    </div>
  )
}

function ConvertActions({ onClose, disabled, busy, confirmLabel, onConfirm }: {
  onClose: () => void
  disabled: boolean
  busy: boolean
  confirmLabel: string
  onConfirm: () => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
      <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
      <button onClick={onConfirm} disabled={disabled} className="btn-primary btn-sm">
        {busy ? 'Converting…' : confirmLabel}
      </button>
    </div>
  )
}
