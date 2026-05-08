'use client'

// Manual lead capture form. Three flavors driven by lead_kind:
//   trade_show    — booth captures (existing flow + OCR card scan)
//   buying_event  — store profile fields needed to pitch a buying event
//   trunk_show    — store profile fields needed to pitch a trunk show
//
// Buying-event + trunk-show flows lead with a Google Places search so
// the rep can pick the store and have name/address/phone/website auto-
// filled. The OCR card-scan path is hidden for those kinds since
// they're prospect-research entries, not booth captures.

import { useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { createLead } from '@/lib/sales/leads'
import type { Lead, LeadInterestLevel, LeadKind, LeadParking, LeadSqFootage } from '@/types'
import DatePicker from '@/components/ui/DatePicker'
import { StoreSearch, type PlaceData } from '@/lib/googlePlaces'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  /** When set, the new lead is pre-linked to this trade show (forces lead_kind='trade_show'). */
  tradeShowId?: string
  /** Pre-select the kind tab. Defaults to 'trade_show'. */
  defaultKind?: LeadKind
  onCreated: (lead: Lead) => void
  onClose: () => void
}

const PARKING_OPTIONS: { value: LeadParking; label: string }[] = [
  { value: 'own_lot', label: 'Own Lot' },
  { value: 'shared_lot', label: 'Shared Lot' },
  { value: 'street', label: 'Street' },
  { value: 'none', label: 'None' },
]

const SQ_FOOTAGE_OPTIONS: { value: LeadSqFootage; label: string }[] = [
  { value: 'small',  label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large',  label: 'Large' },
]

interface DupCandidate {
  source: 'lead' | 'store' | 'trunk_show_store'
  id: string
  name: string
  city?: string | null
  state?: string | null
}

export default function AddLeadModal({ tradeShowId, defaultKind = 'trade_show', onCreated, onClose }: Props) {
  const { user, users } = useApp()

  // When the modal is opened from inside a trade show, pin the kind.
  const [kind, setKind] = useState<LeadKind>(tradeShowId ? 'trade_show' : defaultKind)
  const showOcr = kind === 'trade_show'
  const showStoreFields = kind !== 'trade_show'

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  const [dupes, setDupes] = useState<DupCandidate[]>([])
  const [dupAcked, setDupAcked] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [draft, setDraft] = useState({
    first_name: '', last_name: '', company_name: '', title: '',
    email: '', phone: '',
    store_phone: '', cell_phone: '', referral_source: '',
    address_line_1: '', city: '', state: '', zip: '',
    website: '',
    assigned_rep_id: user?.id || '',
    interest_level: '' as '' | LeadInterestLevel,
    interest_description: '',
    follow_up_date: '',
    notes: '',
    // Buying-event
    best_time_of_year: '',
    freestanding: null as boolean | null,
    parking: '' as '' | LeadParking,
    year_established: '' as string,
    sq_footage: '' as '' | LeadSqFootage,
    currently_buys: null as boolean | null,
    // Trunk-show
    locking_cases: null as boolean | null,
    rated_safe: null as boolean | null,
    sales_staff_count: '' as string,
    years_in_business: '' as string,
    sells_estate_jewelry: null as boolean | null,
    distance_to_airport_miles: '' as string,
  })

  // Different validation rules per kind. Trade-show needs a person
  // (first/last name); buying/trunk pitches need a store name.
  const valid = useMemo(() => {
    if (kind === 'trade_show') return !!draft.first_name.trim() && !!draft.last_name.trim()
    return !!draft.company_name.trim()
  }, [kind, draft.first_name, draft.last_name, draft.company_name])

  // Trunk rep pool only — must have is_trunk_rep flag set in Admin → Users.
  const repOptions = users
    .filter(u => u.active !== false)
    .filter(u => (u as any).is_trunk_rep === true)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  function handlePlaceSelect(p: PlaceData) {
    setDraft(prev => ({
      ...prev,
      company_name:    prev.company_name    || p.name || '',
      address_line_1:  prev.address_line_1  || p.address || '',
      city:            prev.city            || p.city || '',
      state:           prev.state           || p.state || '',
      zip:             prev.zip             || p.zip || '',
      website:         prev.website         || p.website || '',
      store_phone:     prev.store_phone     || p.phone || '',
    }))
    void runDupCheck(p.name, p.city, p.state)
  }

  // Fuzzy dup check across leads + stores + trunk_show_stores.
  // Triggered when the user picks a Google Place or types in
  // "company_name" then blurs. Warn-only — never blocks save.
  async function runDupCheck(name?: string | null, city?: string | null, state?: string | null) {
    const q = (name || '').trim()
    if (q.length < 3) { setDupes([]); return }
    try {
      const ilike = `%${q}%`
      const [leadsRes, storesRes, tssRes] = await Promise.all([
        supabase.from('leads')
          .select('id, company_name, city, state').is('deleted_at', null)
          .ilike('company_name', ilike).limit(5),
        supabase.from('stores').select('id, name, city, state').ilike('name', ilike).limit(5),
        supabase.from('trunk_show_stores').select('id, name, city, state').ilike('name', ilike).limit(5),
      ])
      const all: DupCandidate[] = [
        ...(leadsRes.data || []).map((r: any) => ({
          source: 'lead' as const, id: r.id, name: r.company_name, city: r.city, state: r.state,
        })),
        ...(storesRes.data || []).map((r: any) => ({
          source: 'store' as const, id: r.id, name: r.name, city: r.city, state: r.state,
        })),
        ...(tssRes.data || []).map((r: any) => ({
          source: 'trunk_show_store' as const, id: r.id, name: r.name, city: r.city, state: r.state,
        })),
      ]
      // Tighten further if we have a state — same-state matches only,
      // unless we're left with nothing (then surface the loose set).
      const tight = state ? all.filter(r => !r.state || r.state.toUpperCase() === state.toUpperCase()) : all
      setDupes(tight.length ? tight : all)
      setDupAcked(false)
    } catch { setDupes([]) }
  }

  async function handleScanFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please pick an image file (JPG / PNG / HEIC).')
      return
    }
    setScanning(true); setError(null); setScanNotice(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read the file.'))
        reader.readAsDataURL(file)
      })
      const res = await fetch('/api/scan-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, type: 'business_card' }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || `Scan failed (${res.status})`)
      const d = json.data || {}
      setDraft(p => ({
        ...p,
        first_name:    p.first_name    || d.first_name    || '',
        last_name:     p.last_name     || d.last_name     || '',
        company_name:  p.company_name  || d.company_name  || '',
        title:         p.title         || d.title         || '',
        email:         p.email         || d.email         || '',
        phone:         p.phone         || d.phone         || '',
        address_line_1: p.address_line_1 || d.address_line_1 || '',
        city:          p.city          || d.city          || '',
        state:         p.state         || d.state         || '',
        zip:           p.zip           || d.zip           || '',
        website:       p.website       || d.website       || '',
      }))
      setScanNotice(json.parseError
        ? "Couldn't auto-fill — review the card and enter manually."
        : 'Scanned. Review the fields below before saving.')
    } catch (err: any) {
      setError(err?.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function submit() {
    if (!valid || busy) return
    if (dupes.length > 0 && !dupAcked) {
      setError('Possible duplicates found below — review then check the box to continue.')
      return
    }
    setBusy(true); setError(null)
    try {
      const num = (s: string) => {
        const n = parseInt(s, 10)
        return Number.isFinite(n) ? n : null
      }
      const dec = (s: string) => {
        const n = parseFloat(s)
        return Number.isFinite(n) ? n : null
      }
      const lead = await createLead({
        lead_kind: kind,
        first_name: draft.first_name || (kind !== 'trade_show' ? '' : draft.first_name),
        last_name:  draft.last_name  || (kind !== 'trade_show' ? '' : draft.last_name),
        company_name: draft.company_name,
        title:        draft.title,
        email:        draft.email,
        phone:        draft.phone,
        store_phone:  draft.store_phone,
        cell_phone:   draft.cell_phone,
        referral_source: draft.referral_source,
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
        best_time_of_year:    kind === 'buying_event' ? draft.best_time_of_year : null,
        freestanding:         kind === 'buying_event' ? draft.freestanding : null,
        parking:              kind === 'buying_event' ? (draft.parking || null) : null,
        year_established:     kind === 'buying_event' ? num(draft.year_established) : null,
        sq_footage:           kind === 'buying_event' ? (draft.sq_footage || null) : null,
        currently_buys:       kind === 'buying_event' ? draft.currently_buys : null,
        locking_cases:        kind === 'trunk_show' ? draft.locking_cases : null,
        rated_safe:           kind === 'trunk_show' ? draft.rated_safe : null,
        sales_staff_count:    kind === 'trunk_show' ? num(draft.sales_staff_count) : null,
        years_in_business:    kind === 'trunk_show' ? num(draft.years_in_business) : null,
        sells_estate_jewelry: kind === 'trunk_show' ? draft.sells_estate_jewelry : null,
        distance_to_airport_miles: kind === 'trunk_show' ? dec(draft.distance_to_airport_miles) : null,
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
      <div style={{ width: 'min(680px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            🎯 New Lead{tradeShowId ? ' (linked to this show)' : ''}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        {/* Kind switcher (hidden when pre-pinned by tradeShowId) */}
        {!tradeShowId && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, background: 'var(--cream2)', borderRadius: 6, padding: 4 }}>
            {([
              ['trade_show',   '🎯 Trade Show'],
              ['buying_event', '💎 Buying Event'],
              ['trunk_show',   '👜 Trunk Show'],
            ] as [LeadKind, string][]).map(([k, label]) => {
              const sel = kind === k
              return (
                <button key={k} onClick={() => setKind(k)}
                  style={{
                    flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 700,
                    background: sel ? '#fff' : 'transparent',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                    color: sel ? 'var(--ink)' : 'var(--mist)',
                    fontFamily: 'inherit',
                  }}>{label}</button>
              )
            })}
          </div>
        )}

        {/* Google Places search — only for store-pitch flows */}
        {showStoreFields && (
          <div style={{
            background: 'var(--green-pale)', border: '1px dashed var(--green3)',
            borderRadius: 8, padding: 12, marginBottom: 14,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-dark)', marginBottom: 6 }}>
              🔍 Find the store on Google
            </div>
            <StoreSearch onSelect={handlePlaceSelect} placeholder="Type the store name…" />
            <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.75, marginTop: 6 }}>
              Auto-fills name, address, phone, website. Edit anything below.
            </div>
          </div>
        )}

        {/* Scan business card — only for trade-show flow */}
        {showOcr && (
          <>
            <div style={{
              background: 'var(--green-pale)', border: '1px dashed var(--green3)',
              borderRadius: 8, padding: 12, marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 22 }}>📇</span>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-dark)' }}>
                  Scan a business card
                </div>
                <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.75 }}>
                  Auto-fills name, company, contact, address from the image. Review before saving.
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleScanFile(file)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning || busy}
                className="btn-primary btn-sm"
              >
                {scanning ? 'Scanning…' : 'Scan card'}
              </button>
            </div>
            {scanNotice && (
              <div style={{
                background: 'var(--green-pale)', color: 'var(--green-dark)',
                padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10,
                border: '1px solid var(--green3)',
              }}>{scanNotice}</div>
            )}
          </>
        )}

        {/* Identity (always shown — store-pitch flows still want a primary contact) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label={kind === 'trade_show' ? 'First name' : 'Contact first name'} required={kind === 'trade_show'}>
            <input value={draft.first_name} onChange={e => setDraft(p => ({ ...p, first_name: e.target.value }))} autoFocus />
          </Field>
          <Field label={kind === 'trade_show' ? 'Last name' : 'Contact last name'} required={kind === 'trade_show'}>
            <input value={draft.last_name} onChange={e => setDraft(p => ({ ...p, last_name: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label={showStoreFields ? 'Store name' : 'Company'} required={showStoreFields}>
            <input value={draft.company_name}
              onChange={e => setDraft(p => ({ ...p, company_name: e.target.value }))}
              onBlur={() => showStoreFields && void runDupCheck(draft.company_name, draft.city, draft.state)} />
          </Field>
          <Field label="Title">
            <input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
          <Field label="Email">
            <input type="email" value={draft.email} onChange={e => setDraft(p => ({ ...p, email: e.target.value }))} />
          </Field>
          <Field label={showStoreFields ? 'Cell phone' : 'Phone'}>
            <input type="tel" value={showStoreFields ? draft.cell_phone : draft.phone}
              onChange={e => setDraft(p => showStoreFields
                ? ({ ...p, cell_phone: e.target.value })
                : ({ ...p, phone: e.target.value })
              )} />
          </Field>
        </div>
        {showStoreFields && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
            <Field label="Store phone">
              <input type="tel" value={draft.store_phone} onChange={e => setDraft(p => ({ ...p, store_phone: e.target.value }))} />
            </Field>
            <Field label="Referral source">
              <input value={draft.referral_source}
                onChange={e => setDraft(p => ({ ...p, referral_source: e.target.value }))}
                placeholder="Who told us about them?" />
            </Field>
          </div>
        )}

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

        {/* Buying-event store profile */}
        {kind === 'buying_event' && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--cream2)', margin: '14px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
              Store profile
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label="Best time of year for an event">
                <input value={draft.best_time_of_year}
                  onChange={e => setDraft(p => ({ ...p, best_time_of_year: e.target.value }))}
                  placeholder="e.g. Snowbirds Jan-Mar" />
              </Field>
              <Field label="Year established">
                <input type="number" inputMode="numeric" value={draft.year_established}
                  onChange={e => setDraft(p => ({ ...p, year_established: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label="Parking">
                <select value={draft.parking}
                  onChange={e => setDraft(p => ({ ...p, parking: e.target.value as any }))}>
                  <option value="">Not set</option>
                  {PARKING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Square footage">
                <select value={draft.sq_footage}
                  onChange={e => setDraft(p => ({ ...p, sq_footage: e.target.value as any }))}>
                  <option value="">Not set</option>
                  {SQ_FOOTAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <TriField label="Freestanding building?" value={draft.freestanding}
                onChange={v => setDraft(p => ({ ...p, freestanding: v }))} />
              <TriField label="Currently buys estate jewelry?" value={draft.currently_buys}
                onChange={v => setDraft(p => ({ ...p, currently_buys: v }))} />
            </div>
          </>
        )}

        {/* Trunk-show store profile */}
        {kind === 'trunk_show' && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--cream2)', margin: '14px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
              Store profile
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <TriField label="Locking cases?" value={draft.locking_cases}
                onChange={v => setDraft(p => ({ ...p, locking_cases: v }))} />
              <TriField label="Rated safe on premises?" value={draft.rated_safe}
                onChange={v => setDraft(p => ({ ...p, rated_safe: v }))} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label="# of sales staff">
                <input type="number" inputMode="numeric" value={draft.sales_staff_count}
                  onChange={e => setDraft(p => ({ ...p, sales_staff_count: e.target.value }))} />
              </Field>
              <Field label="Years in business">
                <input type="number" inputMode="numeric" value={draft.years_in_business}
                  onChange={e => setDraft(p => ({ ...p, years_in_business: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <TriField label="Sells estate jewelry now?" value={draft.sells_estate_jewelry}
                onChange={v => setDraft(p => ({ ...p, sells_estate_jewelry: v }))} />
              <Field label="Distance to airport (miles)">
                <input type="number" inputMode="decimal" step="0.1" value={draft.distance_to_airport_miles}
                  onChange={e => setDraft(p => ({ ...p, distance_to_airport_miles: e.target.value }))} />
              </Field>
            </div>
          </>
        )}

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
            <DatePicker value={draft.follow_up_date}
              onChange={v => setDraft(p => ({ ...p, follow_up_date: v }))} />
          </Field>
        </div>
        {kind === 'trade_show' && (
          <Field label="What were they interested in?">
            <input value={draft.interest_description}
              onChange={e => setDraft(p => ({ ...p, interest_description: e.target.value }))}
              placeholder="e.g. Trunk show in their store" />
          </Field>
        )}
        <Field label="Assigned rep">
          <select value={draft.assigned_rep_id}
            onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))}>
            <option value="">Unassigned (admin will route)</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={draft.notes}
            onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} />
        </Field>

        {/* Duplicate warning */}
        {dupes.length > 0 && (
          <div style={{
            background: '#FFFBEB', border: '1px solid #FCD34D', color: '#7A5B00',
            padding: 10, borderRadius: 6, marginTop: 10, marginBottom: 10, fontSize: 12,
          }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ Possible duplicates</div>
            <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
              {dupes.slice(0, 6).map(d => (
                <li key={`${d.source}-${d.id}`}>
                  <span style={{ fontWeight: 700 }}>{d.name}</span>
                  {d.city || d.state ? <span> · {[d.city, d.state].filter(Boolean).join(', ')}</span> : null}
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#A8A89A', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {d.source === 'lead' ? 'Existing lead' : d.source === 'store' ? 'Live store' : 'Trunk-show store'}
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 6 }}>
              <Checkbox checked={dupAcked} onChange={setDupAcked}
                label={<span style={{ fontWeight: 700 }}>Save anyway — these aren't a match</span>} />
            </div>
          </div>
        )}

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

function TriField({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Field label={label}>
      <select value={value === null ? '' : value ? 'yes' : 'no'}
        onChange={e => {
          const v = e.target.value
          onChange(v === '' ? null : v === 'yes')
        }}>
        <option value="">Not set</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  )
}
