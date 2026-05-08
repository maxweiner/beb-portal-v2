'use client'

// Lead capture wizard — three-step flow:
//
//   1. Scan a business card (camera or file pick) → OCR extracts
//      name / company / contact / address → fields pre-fill. Skip
//      this step if there's no card on hand.
//
//   2. Pick the kind: 💎 Buying Event / 👜 Trunk Show / 🤝 Both.
//      "Both" means the prospect is a candidate for both pitches —
//      on save we INSERT two leads (one of each kind) sharing the
//      identity + address fields. Each goes through its own pipeline
//      from there.
//
//   3. Profile — review pre-filled identity fields and fill in the
//      kind-specific store-profile fields. Buying-event pre-pitch
//      questions stack on top of trunk-show ones when "Both" was
//      picked.
//
// When opened from inside a trade show (tradeShowId set), the wizard
// short-circuits: scan → save (kind pinned to 'trade_show', no kind
// picker, no store-profile step). Trade-show leads are tightly tied
// to the booth where they were captured.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { createLead } from '@/lib/sales/leads'
import type { Lead, LeadInterestLevel, LeadKind, LeadParking, LeadSqFootage } from '@/types'
import DatePicker from '@/components/ui/DatePicker'
import { StoreSearch, type PlaceData } from '@/lib/googlePlaces'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  /** When set, the new lead is pre-linked to this trade show
   *  (forces lead_kind='trade_show' and skips the kind picker). */
  tradeShowId?: string
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

type Step = 'scan' | 'kind' | 'profile'
type Kind = 'buying_event' | 'trunk_show' | 'both'

interface DupCandidate {
  source: 'lead' | 'store' | 'trunk_show_store'
  id: string
  name: string
  city?: string | null
  state?: string | null
}

export default function AddLeadModal({ tradeShowId, onCreated, onClose }: Props) {
  const { user, users } = useApp()

  // Step starts at 'scan'. When tradeShowId is set, skip the kind
  // picker since trade_show is forced.
  const [step, setStep] = useState<Step>('scan')
  const [kind, setKind] = useState<Kind>('buying_event')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [dupes, setDupes] = useState<DupCandidate[]>([])
  const [dupAcked, setDupAcked] = useState(false)

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
    // Buying-event profile
    best_time_of_year: '',
    freestanding: null as boolean | null,
    parking: '' as '' | LeadParking,
    year_established: '' as string,
    sq_footage: '' as '' | LeadSqFootage,
    currently_buys: null as boolean | null,
    // Trunk-show profile
    locking_cases: null as boolean | null,
    rated_safe: null as boolean | null,
    sales_staff_count: '' as string,
    years_in_business: '' as string,
    sells_estate_jewelry: null as boolean | null,
    distance_to_airport_miles: '' as string,
  })

  const isTradeShowMode = !!tradeShowId
  const showBuyingFields = !isTradeShowMode && (kind === 'buying_event' || kind === 'both')
  const showTrunkFields  = !isTradeShowMode && (kind === 'trunk_show'   || kind === 'both')

  // For trade-show mode the profile step requires a name; for the
  // store-pitch flows it requires a company. "Both" needs a company.
  const valid = useMemo(() => {
    if (isTradeShowMode) return !!draft.first_name.trim() && !!draft.last_name.trim()
    return !!draft.company_name.trim()
  }, [isTradeShowMode, draft.first_name, draft.last_name, draft.company_name])

  // Trunk rep pool only.
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

  async function runDupCheck(name?: string | null, _city?: string | null, state?: string | null) {
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
        ...(leadsRes.data || []).map((r: any) => ({ source: 'lead' as const, id: r.id, name: r.company_name, city: r.city, state: r.state })),
        ...(storesRes.data || []).map((r: any) => ({ source: 'store' as const, id: r.id, name: r.name, city: r.city, state: r.state })),
        ...(tssRes.data || []).map((r: any) => ({ source: 'trunk_show_store' as const, id: r.id, name: r.name, city: r.city, state: r.state })),
      ]
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
      // Re-encode to JPEG via canvas — strips HEIC and any other
      // exotic format the Anthropic vision API can't read.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const raw = reader.result as string
          const img = document.createElement('img')
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const maxW = 1280
            let w = img.naturalWidth
            let h = img.naturalHeight
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) { resolve(raw); return }
            ctx.drawImage(img, 0, 0, w, h)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          }
          img.onerror = () => resolve(raw)
          img.src = raw
        }
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
        : '✓ Scanned. Review the fields below before saving.')
      // Auto-advance: scan → kind picker (or profile if trade-show mode).
      setStep(isTradeShowMode ? 'profile' : 'kind')
    } catch (err: any) {
      setError(err?.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  function num(s: string): number | null {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : null
  }
  function dec(s: string): number | null {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }

  // Build a single-kind insert payload from the current draft.
  function payloadFor(k: LeadKind) {
    const buying = k === 'buying_event'
    const trunk  = k === 'trunk_show'
    return {
      lead_kind: k,
      first_name: draft.first_name,
      last_name:  draft.last_name,
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
      status: 'new' as const,
      best_time_of_year:    buying ? draft.best_time_of_year : null,
      freestanding:         buying ? draft.freestanding : null,
      parking:              buying ? (draft.parking || null) : null,
      year_established:     buying ? num(draft.year_established) : null,
      sq_footage:           buying ? (draft.sq_footage || null) : null,
      currently_buys:       buying ? draft.currently_buys : null,
      locking_cases:        trunk ? draft.locking_cases : null,
      rated_safe:           trunk ? draft.rated_safe : null,
      sales_staff_count:    trunk ? num(draft.sales_staff_count) : null,
      years_in_business:    trunk ? num(draft.years_in_business) : null,
      sells_estate_jewelry: trunk ? draft.sells_estate_jewelry : null,
      distance_to_airport_miles: trunk ? dec(draft.distance_to_airport_miles) : null,
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
      let firstLead: Lead
      if (isTradeShowMode) {
        firstLead = await createLead(payloadFor('trade_show'))
      } else if (kind === 'both') {
        // Two rows — one per pipeline. Each has its own buying or
        // trunk profile fields populated; identity / address shared.
        const [a, b] = await Promise.all([
          createLead(payloadFor('buying_event')),
          createLead(payloadFor('trunk_show')),
        ])
        firstLead = a  // open the buying-event one by default; trunk
                       // is one click away in the Trunk Shows tab.
        void b
      } else {
        firstLead = await createLead(payloadFor(kind))
      }
      onCreated(firstLead)
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
            {step === 'scan'    && '🎯 New Lead — Step 1 of 3 · Pre-fill'}
            {step === 'kind'    && '🎯 New Lead — Step 2 of 3 · Pick kind'}
            {step === 'profile' && (isTradeShowMode
              ? '🎯 New Lead (linked to this show)'
              : '🎯 New Lead — Step 3 of 3 · Profile')}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        {/* Step indicator */}
        {!isTradeShowMode && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {(['scan', 'kind', 'profile'] as Step[]).map((s, i) => (
              <div key={s} style={{
                flex: 1, height: 4, borderRadius: 2,
                background:
                  step === s ? 'var(--green)' :
                  (['scan', 'kind', 'profile'].indexOf(step) > i) ? 'var(--green3)' :
                  'var(--cream2)',
              }} />
            ))}
          </div>
        )}

        {/* ── Step 1: Pre-fill ──────────────────────────────────
             Two ways to populate the lead before you hit the kind
             picker: scan a physical card, or search the store on
             Google. Skip if you'd rather type by hand. */}
        {step === 'scan' && (
          <>
            {/* Card scan */}
            <div style={{
              background: 'var(--green-pale)', border: '1px dashed var(--green3)',
              borderRadius: 10, padding: 18, marginBottom: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 30 }}>📇</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--green-dark)' }}>
                Scan a business card
              </div>
              <div style={{ fontSize: 12, color: 'var(--green-dark)', opacity: 0.75, maxWidth: 380 }}>
                Camera reads name, company, contact info, address.
              </div>
              <button
                onClick={() => setScannerOpen(true)}
                disabled={scanning || busy}
                className="btn-primary"
                style={{ minHeight: 40, padding: '8px 20px', fontSize: 13 }}
              >
                {scanning ? 'Scanning…' : '📷 Open camera'}
              </button>
            </div>

            {/* OR divider */}
            {!isTradeShowMode && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                margin: '4px 0 12px',
                color: 'var(--mist)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--cream2)' }} />
                <span>OR</span>
                <div style={{ flex: 1, height: 1, background: 'var(--cream2)' }} />
              </div>
            )}

            {/* Google Places lookup — only for store-pitch flows */}
            {!isTradeShowMode && (
              <div style={{
                background: '#fff', border: '1px dashed var(--pearl)',
                borderRadius: 10, padding: 18, marginBottom: 12,
              }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
                  🔍 Look the store up on Google
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 10 }}>
                  Auto-fills name, address, phone, website. Same lookup the Stores page uses.
                </div>
                <StoreSearch
                  placeholder="Type the store name…"
                  onSelect={(p: PlaceData) => {
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
                    setScanNotice('✓ Found on Google. Review the fields in the next step.')
                    setStep('kind')
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                Or skip ahead and fill the fields by hand.
              </div>
              <button onClick={() => setStep(isTradeShowMode ? 'profile' : 'kind')}
                className="btn-outline btn-sm">
                Skip →
              </button>
            </div>
            {scanNotice && (
              <div style={{
                marginTop: 10,
                background: 'var(--green-pale)', color: 'var(--green-dark)',
                padding: '8px 10px', borderRadius: 6, fontSize: 12,
                border: '1px solid var(--green3)',
              }}>{scanNotice}</div>
            )}
            {error && (
              <div style={{ marginTop: 10, background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>
                {error}
              </div>
            )}
          </>
        )}

        {/* ── Step 2: Kind picker ───────────────────────────── */}
        {step === 'kind' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 14 }}>
              Is this a <strong>buying-event</strong> prospect, a <strong>trunk-show</strong> prospect, or both?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
              <KindButton
                kind="buying_event"
                label="💎 Buying Event"
                hint="We'd pitch hosting an estate-jewelry buying event at this store."
                selected={kind === 'buying_event'}
                onClick={() => setKind('buying_event')}
              />
              <KindButton
                kind="trunk_show"
                label="👜 Trunk Show"
                hint="We'd pitch hosting a trunk show at this store."
                selected={kind === 'trunk_show'}
                onClick={() => setKind('trunk_show')}
              />
              <KindButton
                kind="both"
                label="🤝 Both"
                hint="Candidate for either pitch — creates two leads."
                selected={kind === 'both'}
                onClick={() => setKind('both')}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button onClick={() => setStep('scan')} className="btn-outline btn-sm">← Back</button>
              <button onClick={() => setStep('profile')} className="btn-primary btn-sm">
                Continue →
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Profile ──────────────────────────────── */}
        {step === 'profile' && (
          <>
            {/* Google Places search — only for store-pitch flows */}
            {!isTradeShowMode && (
              <div style={{
                background: 'var(--green-pale)', border: '1px dashed var(--green3)',
                borderRadius: 8, padding: 12, marginBottom: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-dark)', marginBottom: 6 }}>
                  🔍 Refine via Google
                </div>
                <StoreSearch onSelect={handlePlaceSelect} placeholder="Type the store name…" />
                <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.75, marginTop: 6 }}>
                  Cross-checks the card scan against Google. Picks up city/state if missing.
                </div>
              </div>
            )}

            {scanNotice && (
              <div style={{
                background: 'var(--green-pale)', color: 'var(--green-dark)',
                padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10,
                border: '1px solid var(--green3)',
              }}>{scanNotice}</div>
            )}

            {/* Identity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label={isTradeShowMode ? 'First name' : 'Contact first name'} required={isTradeShowMode}>
                <input value={draft.first_name} onChange={e => setDraft(p => ({ ...p, first_name: e.target.value }))} autoFocus />
              </Field>
              <Field label={isTradeShowMode ? 'Last name' : 'Contact last name'} required={isTradeShowMode}>
                <input value={draft.last_name} onChange={e => setDraft(p => ({ ...p, last_name: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label={!isTradeShowMode ? 'Store name' : 'Company'} required={!isTradeShowMode}>
                <input value={draft.company_name}
                  onChange={e => setDraft(p => ({ ...p, company_name: e.target.value }))}
                  onBlur={() => !isTradeShowMode && void runDupCheck(draft.company_name, draft.city, draft.state)} />
              </Field>
              <Field label="Title">
                <input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
              <Field label="Email">
                <input type="email" value={draft.email} onChange={e => setDraft(p => ({ ...p, email: e.target.value }))} />
              </Field>
              <Field label={!isTradeShowMode ? 'Cell phone' : 'Phone'}>
                <input type="tel" value={!isTradeShowMode ? draft.cell_phone : draft.phone}
                  onChange={e => setDraft(p => !isTradeShowMode
                    ? ({ ...p, cell_phone: e.target.value })
                    : ({ ...p, phone: e.target.value })
                  )} />
              </Field>
            </div>
            {!isTradeShowMode && (
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
            {showBuyingFields && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--cream2)', margin: '14px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  💎 Buying-event profile
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
            {showTrunkFields && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--cream2)', margin: '14px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  👜 Trunk-show profile
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
            {isTradeShowMode && (
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

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
              {!isTradeShowMode ? (
                <button onClick={() => setStep('kind')} className="btn-outline btn-sm">← Back</button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
                <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
                  {busy ? 'Saving…' : (kind === 'both' && !isTradeShowMode ? 'Save 2 leads' : 'Save lead')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Full-screen scanner overlay */}
        {scannerOpen && (
          <BusinessCardScanner
            onClose={() => setScannerOpen(false)}
            onCapture={async (file) => {
              setScannerOpen(false)
              await handleScanFile(file)
            }}
          />
        )}
      </div>
    </div>
  )
}

function KindButton({ label, hint, selected, onClick }: {
  kind: Kind
  label: string
  hint: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        padding: 14, borderRadius: 10,
        background: selected ? 'var(--green-pale)' : '#fff',
        border: '2px solid ' + (selected ? 'var(--green-dark)' : 'var(--pearl)'),
        display: 'flex', flexDirection: 'column', gap: 4,
        // <button> defaults to nowrap in some browsers; force normal
        // wrapping. min-width:0 lets the flex/grid parent shrink the
        // cell below its content's intrinsic width so the long hint
        // text wraps inside the button instead of spilling sideways.
        minWidth: 0,
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: selected ? 'var(--green-dark)' : 'var(--ink)' }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: 'var(--mist)', lineHeight: 1.4 }}>
        {hint}
      </div>
    </button>
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

/**
 * Full-screen business-card scanner — dark overlay, dashed viewfinder
 * with green corner ticks, big circular shutter, auto-opens the
 * device camera, preview-with-Retake step.
 */
function BusinessCardScanner({ onCapture, onClose }: {
  onCapture: (file: File) => void | Promise<void>
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)

  const openCamera = () => {
    if (!fileRef.current) return
    fileRef.current.value = ''
    fileRef.current.click()
  }

  useEffect(() => {
    const t = setTimeout(openCamera, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPickedFile(file)
    const reader = new FileReader()
    reader.onload = () => setPreviewUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1300, background: '#111',
      display: 'flex', flexDirection: 'column', color: '#fff',
    }}>
      <input
        ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFileChange}
      />
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => { setPreviewUrl(null); setPickedFile(null); onClose() }}
          style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'rgba(255,255,255,.6)' }}
        >× Close</button>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Business card
        </div>
        <span style={{ width: 50 }} />
      </div>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 20, overflowY: 'auto',
      }}>
        {!previewUrl ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Scan business card
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginBottom: 22, textAlign: 'center' }}>
              Frame the card inside the box, then tap the shutter.
            </div>
            <div style={{
              width: 'min(320px, 80vw)',
              aspectRatio: '1.6 / 1',
              border: '2px dashed rgba(255,255,255,.35)',
              borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 28, position: 'relative',
            }}>
              {[
                { top: -1, left: -1 },
                { top: -1, right: -1 },
                { bottom: -1, left: -1 },
                { bottom: -1, right: -1 },
              ].map((c, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  width: 22, height: 22,
                  borderTop:    c.top !== undefined    ? '3px solid #7EC8A0' : 'none',
                  borderBottom: c.bottom !== undefined ? '3px solid #7EC8A0' : 'none',
                  borderLeft:   c.left !== undefined   ? '3px solid #7EC8A0' : 'none',
                  borderRight:  c.right !== undefined  ? '3px solid #7EC8A0' : 'none',
                  ...c,
                }} />
              ))}
              <div style={{ fontSize: 36, opacity: 0.25 }}>📇</div>
            </div>
            <button onClick={openCamera}
              style={{
                width: 72, height: 72, borderRadius: '50%',
                background: '#fff', border: '4px solid rgba(255,255,255,.35)',
                cursor: 'pointer',
              }}
              aria-label="Take photo"
            />
            <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, marginTop: 8 }}>
              Tap to capture
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Looks good?</div>
            <img
              src={previewUrl}
              alt="Captured card"
              style={{
                maxWidth: 'min(360px, 90vw)', maxHeight: '60vh',
                borderRadius: 12, border: '2px solid rgba(255,255,255,.2)',
                marginBottom: 18,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={openCamera}
                style={{
                  padding: '10px 16px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.25)',
                  background: 'transparent', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>↻ Retake</button>
              <button
                onClick={() => { if (pickedFile) void onCapture(pickedFile) }}
                style={{
                  padding: '10px 18px', borderRadius: 8, border: 'none',
                  background: '#7EC8A0', color: '#0F2A1B',
                  fontSize: 13, fontWeight: 800, cursor: 'pointer',
                }}>✓ Use this</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
