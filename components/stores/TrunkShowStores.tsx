'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import Checkbox from '@/components/ui/Checkbox'
import { StoreSearch, type PlaceData } from '@/lib/googlePlaces'

interface TrunkRep { id: string; name: string }

interface TrunkShowStoreContact {
  name: string
  email: string | null
  send_documents: boolean
}

interface TrunkShowStore {
  id: string
  trunk_shows: boolean | null
  name: string
  ts_reps: string | null
  trunk_rep_user_id: string | null
  comments: string | null
  address_1: string | null
  address_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  store_phone: string | null
  // Legacy columns kept in schema; new UI reads/writes `contacts`.
  contact_1: string | null
  contact_2: string | null
  contact_3: string | null
  email_1: string | null
  email_2: string | null
  url: string | null
  primary_contact_email: string | null
  primary_contact_name: string | null
  contacts: TrunkShowStoreContact[]
  created_at?: string
  updated_at?: string
}

const COLS = `id, trunk_shows, name, ts_reps, trunk_rep_user_id, comments,
  address_1, address_2, city, state, zip, store_phone,
  contact_1, contact_2, contact_3, email_1, email_2, url,
  primary_contact_email, primary_contact_name, contacts,
  created_at, updated_at`

export default function TrunkShowStores() {
  const [stores, setStores] = useState<TrunkShowStore[]>([])
  const [trunkReps, setTrunkReps] = useState<TrunkRep[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<TrunkShowStore | null>(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [newStore, setNewStore] = useState({
    name: '', address_1: '', city: '', state: '', zip: '', url: '', store_phone: '',
  })
  const [placePicked, setPlacePicked] = useState(false)
  const [adding, setAdding] = useState(false)

  const fetchStores = async () => {
    const { data, error } = await supabase
      .from('trunk_show_stores').select(COLS).order('name')
    if (error) { console.error(error); return }
    setStores((data || []) as TrunkShowStore[])
    setLoaded(true)
  }

  const fetchTrunkReps = async () => {
    const { data, error } = await supabase
      .from('users').select('id, name').eq('is_trunk_rep', true).eq('active', true).order('name')
    if (error) { console.error(error); return }
    setTrunkReps((data || []) as TrunkRep[])
  }

  useEffect(() => { fetchStores(); fetchTrunkReps() }, [])

  const repNameById = useMemo(() => {
    const m = new Map<string, string>()
    trunkReps.forEach(r => m.set(r.id, r.name))
    return m
  }, [trunkReps])

  const states = useMemo(
    () => Array.from(new Set(stores.map(s => s.state).filter(Boolean) as string[])).sort(),
    [stores],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stores.filter(s => {
      if (stateFilter && s.state !== stateFilter) return false
      if (activeFilter === 'active' && s.trunk_shows !== true) return false
      if (activeFilter === 'inactive' && s.trunk_shows === true) return false
      if (!q) return true
      const repName = s.trunk_rep_user_id ? repNameById.get(s.trunk_rep_user_id) : null
      const hay = [
        s.name, s.city, s.state, repName, s.ts_reps, s.contact_1, s.contact_2, s.contact_3,
        s.email_1, s.email_2, s.store_phone,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [stores, search, stateFilter, activeFilter, repNameById])

  const activeCount = useMemo(() => stores.filter(s => s.trunk_shows === true).length, [stores])

  const handlePlaceSelect = (data: PlaceData) => {
    setNewStore({
      name: data.name,
      address_1: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      url: data.website || '',
      store_phone: data.phone || '',
    })
    setPlacePicked(true)
  }

  const resetAddForm = () => {
    setNewStore({ name: '', address_1: '', city: '', state: '', zip: '', url: '', store_phone: '' })
    setPlacePicked(false)
  }

  const createStore = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newStore.name.trim()
    if (!trimmed) return
    setAdding(true)
    const { data, error } = await supabase
      .from('trunk_show_stores')
      .insert({
        name: trimmed,
        trunk_shows: true,
        address_1: newStore.address_1 || null,
        city: newStore.city || null,
        state: newStore.state?.toUpperCase() || null,
        zip: newStore.zip || null,
        url: newStore.url || null,
        store_phone: newStore.store_phone || null,
      })
      .select(COLS)
      .single()
    setAdding(false)
    if (error) { alert('Add failed: ' + error.message); return }
    setStores(p => [...p, data as TrunkShowStore].sort((a, b) => a.name.localeCompare(b.name)))
    resetAddForm()
    setShowAdd(false)
    setSelected(data as TrunkShowStore)
  }

  const deleteStore = async (id: string) => {
    if (!confirm('Delete this trunk show store? This cannot be undone.')) return
    const prev = stores
    setStores(s => s.filter(x => x.id !== id))
    if (selected?.id === id) setSelected(null)
    const { error } = await supabase.from('trunk_show_stores').delete().eq('id', id)
    if (error) {
      setStores(prev)
      alert('Delete failed: ' + error.message)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Trunk Show Stores</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, city, contact…" style={{ width: 220 }} />
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All states</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as any)} style={{ width: 'auto' }}>
            <option value="all">All</option>
            <option value="active">Active trunk shows</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Store</button>
        </div>
      </div>

      {showAdd && (
        <div className="card mb-5" style={{ border: '2px solid var(--green3)', marginBottom: 20 }}>
          <div className="card-title">New Trunk Show Store</div>
          <form onSubmit={createStore}>
            <div className="field">
              <label className="fl">Search for Store *</label>
              <StoreSearch onSelect={handlePlaceSelect} />
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4 }}>
                Start typing the store name to search Google Places
              </div>
            </div>

            {placePicked && (
              <div className="notice notice-jade" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ {newStore.name}</div>
                <div style={{ fontSize: 13 }}>{newStore.address_1}, {newStore.city}, {newStore.state} {newStore.zip}</div>
                {newStore.url && <div style={{ fontSize: 12, marginTop: 2 }}>🌐 {newStore.url}</div>}
                {newStore.store_phone && <div style={{ fontSize: 12 }}>📞 {newStore.store_phone}</div>}
              </div>
            )}

            <div className="field">
              <label className="fl">Store Name *</label>
              <input value={newStore.name} onChange={e => setNewStore(p => ({ ...p, name: e.target.value }))}
                placeholder="Edit name if needed" required />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary btn-sm" disabled={adding || !newStore.name.trim()}>
                {adding ? 'Adding…' : 'Add Store'}
              </button>
              <button type="button" className="btn-outline btn-sm" onClick={() => { setShowAdd(false); resetAddForm() }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>City</th>
                <th>State</th>
                <th>Active</th>
                <th>Trunk Rep</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>Loading…</td></tr>
              )}
              {loaded && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>No stores match your filters.</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}
                  onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream2)'}
                  onMouseOut={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td><span style={{ color: 'var(--green-dark)', fontWeight: 700 }}>◆ {s.name}</span></td>
                  <td>{s.city || <span style={{ color: 'var(--silver)' }}>—</span>}</td>
                  <td>{s.state || <span style={{ color: 'var(--silver)' }}>—</span>}</td>
                  <td>
                    {s.trunk_shows === true
                      ? <span style={chip('active')}>✓ Active</span>
                      : <span style={chip('inactive')}>—</span>}
                  </td>
                  <td>{s.trunk_rep_user_id
                    ? (repNameById.get(s.trunk_rep_user_id) || <span style={{ color: 'var(--silver)' }}>—</span>)
                    : (s.ts_reps
                        ? <span style={{ color: 'var(--silver)', fontStyle: 'italic' }} title="Legacy text — pick a Trunk Rep from the dropdown to convert">{s.ts_reps}</span>
                        : <span style={{ color: 'var(--silver)' }}>—</span>)}</td>
                  <td>{s.store_phone || <span style={{ color: 'var(--silver)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mist)', textAlign: 'right' }}>
        {loaded && `${filtered.length} of ${stores.length} stores · ${activeCount} active trunk show clients`}
      </div>

      {selected && <Modal store={selected}
        trunkReps={trunkReps}
        onClose={() => setSelected(null)}
        onSaved={(updated) => {
          setStores(p => p.map(x => x.id === updated.id ? updated : x))
          setSelected(updated)
        }}
        onDelete={() => deleteStore(selected.id)} />}
    </div>
  )
}

/* ── chip styling ─────────────────────────────────────── */
function chip(kind: 'active' | 'inactive'): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    active:   { background: '#E6F4EC', color: 'var(--green)' },
    inactive: { background: '#F1EFEC', color: 'var(--mist)' },
  }
  return {
    display: 'inline-block', padding: '1px 8px', borderRadius: 999,
    fontSize: 11, fontWeight: 800, letterSpacing: '.04em',
    ...(map[kind] || map.inactive),
  }
}

// First contact flagged send_documents=true with an email
// (in array order) becomes the canonical recipient. Falls back
// to the first contact with any email if none are flagged.
function derivePrimaryEmail(contacts: { email: string | null; send_documents: boolean }[]): string | null {
  const flagged = contacts.find(c => c.send_documents && c.email && c.email.trim())
  if (flagged) return flagged.email!.trim()
  const any = contacts.find(c => c.email && c.email.trim())
  return any ? any.email!.trim() : null
}
function derivePrimaryName(contacts: { name: string; email: string | null; send_documents: boolean }[]): string | null {
  const flagged = contacts.find(c => c.send_documents && c.email && c.email.trim())
  if (flagged) return flagged.name?.trim() || null
  const any = contacts.find(c => c.email && c.email.trim())
  return any?.name?.trim() || null
}

/* ── Module-level field components ──
   Defined outside Modal so React doesn't unmount + remount
   the underlying <input> on every parent re-render (which
   stole focus and made typing feel like "saves on every
   keystroke"). Keep these stable. */

function F({
  label, value, onChange, type = 'text', placeholder = '',
}: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="field">
      <label className="fl">{label}</label>
      <input type={type} value={value ?? ''} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function TA({
  label, value, onChange, placeholder = '',
}: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="field">
      <label className="fl">{label}</label>
      <textarea value={value ?? ''} placeholder={placeholder} rows={3}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid var(--pearl)', borderRadius: 'var(--r)', fontFamily: 'inherit', fontSize: 13 }} />
    </div>
  )
}

function ContactsList({
  contacts, onChange,
}: {
  contacts: TrunkShowStoreContact[]
  onChange: (next: TrunkShowStoreContact[]) => void
}) {
  function update(idx: number, patch: Partial<TrunkShowStoreContact>) {
    onChange(contacts.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }
  function remove(idx: number) {
    onChange(contacts.filter((_, i) => i !== idx))
  }
  function add() {
    onChange([...contacts, { name: '', email: '', send_documents: false }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 130px 32px', gap: 8,
        fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em',
      }}>
        <span>Name</span>
        <span>Email</span>
        <span style={{ textAlign: 'center' }}>Send Documents</span>
        <span></span>
      </div>
      {contacts.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', padding: '8px 0', textAlign: 'center' }}>
          No contacts yet. Click "+ Add contact" below.
        </div>
      ) : (
        contacts.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 130px 32px', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={c.name ?? ''}
              onChange={e => update(i, { name: e.target.value })}
              placeholder="Contact name"
            />
            <input
              type="email"
              value={c.email ?? ''}
              onChange={e => update(i, { email: e.target.value })}
              placeholder="contact@example.com"
            />
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 12, color: 'var(--ash)', fontWeight: 600,
            }}>
              <input
                type="checkbox"
                checked={!!c.send_documents}
                onChange={e => update(i, { send_documents: e.target.checked })}
                style={{
                  width: 18, height: 18, padding: 0, margin: 0,
                  appearance: 'auto', WebkitAppearance: 'checkbox',
                  border: 'none', background: 'transparent', borderRadius: 0,
                } as React.CSSProperties}
              />
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove contact"
              style={{
                background: 'transparent', border: 'none', color: 'var(--mist)',
                cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1,
              }}
            >✕</button>
          </div>
        ))
      )}
      <div>
        <button
          type="button"
          onClick={add}
          className="btn-outline btn-xs"
          style={{ marginTop: 4 }}
        >
          + Add contact
        </button>
      </div>
    </div>
  )
}

/* ── DETAIL MODAL ─────────────────────────────────────── */
function Modal({ store, trunkReps, onClose, onSaved, onDelete }: {
  store: TrunkShowStore
  trunkReps: TrunkRep[]
  onClose: () => void
  onSaved: (s: TrunkShowStore) => void
  onDelete: () => void | Promise<void>
}) {
  const [details, setDetails] = useState<TrunkShowStore>({ ...store })

  // Keep local copy in sync if parent swaps the selected store
  useEffect(() => { setDetails({ ...store }) }, [store.id])

  // Single autosave watcher: any field change debounces a save of the
  // full editable column set. Simpler than per-section autosaves and
  // matches how this CRUD-light reference table is used.
  const status = useAutosave(
    details,
    async (d) => {
      const patch = {
        trunk_shows: d.trunk_shows ?? null,
        name: d.name?.trim() || store.name,
        trunk_rep_user_id: d.trunk_rep_user_id || null,
        comments: emptyToNull(d.comments),
        address_1: emptyToNull(d.address_1),
        address_2: emptyToNull(d.address_2),
        city: emptyToNull(d.city),
        state: emptyToNull(d.state)?.toUpperCase() || null,
        zip: emptyToNull(d.zip),
        store_phone: emptyToNull(d.store_phone),
        contact_1: emptyToNull(d.contact_1),
        contact_2: emptyToNull(d.contact_2),
        contact_3: emptyToNull(d.contact_3),
        email_1: emptyToNull(d.email_1),
        email_2: emptyToNull(d.email_2),
        url: emptyToNull(d.url),
        contacts: (d.contacts || []).filter((c: any) => c && (c.name?.trim() || c.email?.trim())),
        // Re-derive the canonical "primary" recipient from the first
        // contact flagged send_documents=true so the trunk-comms
        // send pipeline picks the right address.
        primary_contact_email: derivePrimaryEmail(d.contacts || []),
        primary_contact_name:  derivePrimaryName(d.contacts || []),
      }
      const { data, error } = await supabase
        .from('trunk_show_stores').update(patch).eq('id', store.id)
        .select(COLS).single()
      if (error) throw error
      onSaved(data as TrunkShowStore)
    },
    { delay: 1000 },
  )

  const fullAddress = [details.address_1, details.city, details.state, details.zip].filter(Boolean).join(', ')
  const mapUrl = fullAddress && process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}&q=${encodeURIComponent(fullAddress)}`
    : null

  const set = <K extends keyof TrunkShowStore>(k: K, v: TrunkShowStore[K]) =>
    setDetails(p => ({ ...p, [k]: v }))

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-lg)' }}>

        {/* Dark header */}
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 14 }}>◆ Trunk Show Store</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{store.name}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {mapUrl && (
            <div style={{ borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--pearl)' }}>
              <iframe src={mapUrl} width="100%" height="200" style={{ border: 0, display: 'block' }} allowFullScreen loading="lazy" />
            </div>
          )}

          {/* Store Info */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                Store Information<AutosaveIndicator status={status} />
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <F label="Store Name" value={details.name} onChange={v => set('name', v)} placeholder="Jeweler name" />
              <div className="field">
                <label className="fl">Trunk Rep</label>
                <select value={details.trunk_rep_user_id ?? ''}
                  onChange={e => set('trunk_rep_user_id', e.target.value || null)}>
                  <option value="">— Unassigned —</option>
                  {trunkReps.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {!details.trunk_rep_user_id && details.ts_reps && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
                    Legacy text: <strong>{details.ts_reps}</strong> — pick a Trunk Rep above to convert.
                  </div>
                )}
              </div>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label className="fl">Active Trunk Show Client</label>
                <Checkbox
                  checked={details.trunk_shows === true}
                  onChange={(v) => set('trunk_shows', v)}
                  size={18}
                  label={<span style={{ fontSize: 13 }}>Yes — actively running trunk shows here</span>}
                />
              </div>
              <F label="Street Address" value={details.address_1}  onChange={v => set('address_1', v)} />
              <F label="Unit"           value={details.address_2}  onChange={v => set('address_2', v)} />
              <F label="City"           value={details.city}       onChange={v => set('city', v)} />
              <F label="State"          value={details.state}      onChange={v => set('state', v)} placeholder="2-letter" />
              <F label="Zip"            value={details.zip}        onChange={v => set('zip', v)} />
              <F label="Store Phone"    value={details.store_phone} onChange={v => set('store_phone', v)} />
              <div style={{ gridColumn: 'span 2' }}>
                <F label="URL" value={details.url} onChange={v => set('url', v)} placeholder="https://" />
              </div>
            </div>
          </div>

          {/* Contacts */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">Contacts<AutosaveIndicator status={status} /></div>
            <ContactsList
              contacts={details.contacts || []}
              onChange={(next) => set('contacts', next)}
            />
          </div>

          {/* Comments */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">Comments<AutosaveIndicator status={status} /></div>
            <TA label="" value={details.comments} onChange={v => set('comments', v)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onDelete}
              style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', padding: '6px 12px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              🗑 Delete Store
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}
