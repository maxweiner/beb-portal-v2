'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import Checkbox from '@/components/ui/Checkbox'
import PhoneInput from '@/components/ui/PhoneInput'
import { rawDigits } from '@/lib/phone'
import { StoreSearch, type PlaceData } from '@/lib/googlePlaces'
import LeadProfileCard from '@/components/sales/LeadProfileCard'

interface TrunkRep { id: string; name: string }

interface TradeOrganization {
  id: string
  name: string
  sort_order: number
  archived_at: string | null
}

interface TrunkShowStoreContact {
  name: string
  /** Free-text role at the store. Common values via <datalist>: Owner,
   *  Manager, Staff Member. Optional. */
  title?: string | null
  /** Raw 10-digit cell number; rendered through PhoneInput which
   *  formats XXX-XXX-XXXX on display. Optional. */
  phone?: string | null
  email: string | null
  send_documents: boolean
}

const CONTACT_TITLE_OPTIONS = ['Owner', 'Manager', 'Staff'] as const

interface TrunkShowStore {
  id: string
  trunk_shows: boolean | null
  /** Dormant flag. When false the store is hidden from default
   *  list views; toggle "Show inactive" in the list header to
   *  manage. Distinct from trunk_shows (partner-status). */
  active: boolean
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
  /** Base-64 data URL — same shape buying-event stores use. */
  store_image_url: string | null
  created_at?: string
  updated_at?: string
}

const COLS = `id, trunk_shows, active, name, ts_reps, trunk_rep_user_id, comments,
  address_1, address_2, city, state, zip, store_phone,
  contact_1, contact_2, contact_3, email_1, email_2, url,
  primary_contact_email, primary_contact_name, contacts,
  store_image_url,
  created_at, updated_at`

export default function TrunkShowStores() {
  const [stores, setStores] = useState<TrunkShowStore[]>([])
  const [trunkReps, setTrunkReps] = useState<TrunkRep[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<TrunkShowStore | null>(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('')
  // `activeFilter` here filters on the `trunk_shows` column (i.e.
  // "is this a trunk-show partner?") — a separate concept from the
  // new dormant flag. Kept as-is for back-compat.
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  // Dormant flag: stores with active=false are hidden by default.
  const [showInactive, setShowInactive] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newStore, setNewStore] = useState({
    name: '', address_1: '', city: '', state: '', zip: '', url: '', store_phone: '',
  })
  const [placePicked, setPlacePicked] = useState(false)
  const [adding, setAdding] = useState(false)
  // Trade organizations (RJO + future). orgs is the master list;
  // membership is store_id → Set<org_id> built from the join table.
  // selectedOrgIds drives the top-of-page filter (multi-select; any
  // match wins). orgDropdownOpen/orgDropdownRef gate the checkbox
  // popover. addOrgName lets the user create new orgs inline.
  const [orgs, setOrgs] = useState<TradeOrganization[]>([])
  const [membership, setMembership] = useState<Map<string, Set<string>>>(new Map())
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set())
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false)
  const [addOrgName, setAddOrgName] = useState('')
  const [addingOrg, setAddingOrg] = useState(false)
  const orgDropdownRef = useRef<HTMLDivElement>(null)

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

  const fetchOrgs = async () => {
    const { data, error } = await supabase
      .from('trade_organizations')
      .select('id, name, sort_order, archived_at')
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) { console.error(error); return }
    setOrgs((data || []) as TradeOrganization[])
  }
  const fetchMembership = async () => {
    const { data, error } = await supabase
      .from('store_trade_organization_members')
      .select('store_id, org_id')
    if (error) { console.error(error); return }
    const m = new Map<string, Set<string>>()
    for (const r of (data || []) as Array<{ store_id: string; org_id: string }>) {
      let s = m.get(r.store_id)
      if (!s) { s = new Set(); m.set(r.store_id, s) }
      s.add(r.org_id)
    }
    setMembership(m)
  }

  useEffect(() => {
    fetchStores(); fetchTrunkReps(); fetchOrgs(); fetchMembership()
  }, [])

  // Click-outside closes the org filter dropdown — anything inside
  // the popover (incl. the inline "+ Add" input) keeps it open.
  useEffect(() => {
    if (!orgDropdownOpen) return
    function onDocClick(e: MouseEvent) {
      if (!orgDropdownRef.current) return
      if (!orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [orgDropdownOpen])

  // Lookup helpers for the chip column + modal.
  const orgsById = useMemo(() => {
    const m = new Map<string, TradeOrganization>()
    for (const o of orgs) m.set(o.id, o)
    return m
  }, [orgs])

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
      if (!showInactive && s.active === false) return false
      if (stateFilter && s.state !== stateFilter) return false
      if (activeFilter === 'active' && s.trunk_shows !== true) return false
      if (activeFilter === 'inactive' && s.trunk_shows === true) return false
      // Trade-organization filter: any-of match. A store has to be a
      // member of at least one of the selected orgs to pass.
      if (selectedOrgIds.size > 0) {
        const myOrgs = membership.get(s.id)
        if (!myOrgs || myOrgs.size === 0) return false
        let any = false
        for (const id of selectedOrgIds) {
          if (myOrgs.has(id)) { any = true; break }
        }
        if (!any) return false
      }
      if (!q) return true
      const repName = s.trunk_rep_user_id ? repNameById.get(s.trunk_rep_user_id) : null
      // Include org names in the free-text search blob so typing
      // "RJO" finds member stores too.
      const myOrgs = membership.get(s.id)
      const orgNames = myOrgs
        ? Array.from(myOrgs).map(id => orgsById.get(id)?.name).filter(Boolean)
        : []
      const hay = [
        s.name, s.city, s.state, repName, s.ts_reps, s.contact_1, s.contact_2, s.contact_3,
        s.email_1, s.email_2, s.store_phone, ...orgNames,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [stores, search, stateFilter, activeFilter, showInactive, repNameById, selectedOrgIds, membership, orgsById])

  const activeCount = useMemo(() => stores.filter(s => s.trunk_shows === true).length, [stores])

  // Create a new trade organization. Inline in the dropdown so the
  // user doesn't have to leave the filter context. Errors fall back
  // to alert() since this is a low-frequency operation.
  const createOrg = async () => {
    const trimmed = addOrgName.trim()
    if (!trimmed || addingOrg) return
    setAddingOrg(true)
    const { data, error } = await supabase
      .from('trade_organizations')
      .insert({ name: trimmed, sort_order: orgs.length })
      .select('id, name, sort_order, archived_at')
      .single()
    setAddingOrg(false)
    if (error) { alert('Add failed: ' + error.message); return }
    const created = data as TradeOrganization
    setOrgs(p => [...p, created].sort((a, b) => a.name.localeCompare(b.name)))
    setAddOrgName('')
  }

  // Toggle a store's membership in an org. Optimistic update keeps
  // the UI responsive; on failure we revert the local map.
  const toggleStoreOrg = async (storeId: string, orgId: string, on: boolean) => {
    setMembership(prev => {
      const m = new Map(prev)
      const s = new Set(m.get(storeId) || [])
      if (on) s.add(orgId); else s.delete(orgId)
      m.set(storeId, s)
      return m
    })
    const { error } = on
      ? await supabase.from('store_trade_organization_members')
          .upsert({ store_id: storeId, org_id: orgId })
      : await supabase.from('store_trade_organization_members')
          .delete().eq('store_id', storeId).eq('org_id', orgId)
    if (error) {
      // Revert on failure.
      setMembership(prev => {
        const m = new Map(prev)
        const s = new Set(m.get(storeId) || [])
        if (on) s.delete(orgId); else s.add(orgId)
        m.set(storeId, s)
        return m
      })
      alert(`Org change failed: ${error.message}`)
    }
  }

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
          <Checkbox checked={showInactive} onChange={setShowInactive}
            label={<span style={{ fontSize: 12, color: 'var(--mist)' }}>Show inactive</span>} />
          {/* Trade organization filter — multi-select popover.
              Button label summarises the current selection.
              Dropdown body lists every active org as a checkbox,
              with an inline "+ Add new…" composer at the bottom.
              All actions stay inside orgDropdownRef so the click-
              outside listener doesn't close the popover early. */}
          <div ref={orgDropdownRef} style={{ position: 'relative' }}>
            <button type="button"
              onClick={() => setOrgDropdownOpen(o => !o)}
              className="btn-outline btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {selectedOrgIds.size === 0
                ? 'All orgs'
                : (selectedOrgIds.size === 1
                    ? (orgsById.get(Array.from(selectedOrgIds)[0])?.name || '1 org')
                    : `${selectedOrgIds.size} orgs`)}
              <span style={{ fontSize: 10, color: 'var(--mist)' }}>▾</span>
            </button>
            {orgDropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 1100,
                minWidth: 220, marginTop: 4,
                background: '#fff', border: '1px solid var(--pearl)',
                borderRadius: 8, padding: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6, padding: '0 4px' }}>
                  Filter by org
                </div>
                {orgs.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--mist)', padding: '4px 6px' }}>No orgs yet — add one below.</div>
                )}
                {orgs.map(o => {
                  const checked = selectedOrgIds.has(o.id)
                  return (
                    <div key={o.id} style={{ padding: '4px 6px' }}>
                      <Checkbox
                        checked={checked}
                        size={16}
                        onChange={(next) => {
                          setSelectedOrgIds(prev => {
                            const s = new Set(prev)
                            if (next) s.add(o.id); else s.delete(o.id)
                            return s
                          })
                        }}
                        label={<span style={{ fontSize: 13, color: 'var(--ink)' }}>{o.name}</span>}
                      />
                    </div>
                  )
                })}
                {selectedOrgIds.size > 0 && (
                  <button type="button"
                    onClick={() => setSelectedOrgIds(new Set())}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '4px 6px', marginTop: 4,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 11, color: 'var(--mist)',
                    }}>
                    Clear selection
                  </button>
                )}
                <div style={{ borderTop: '1px solid var(--cream2)', marginTop: 6, paddingTop: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4, padding: '0 4px' }}>
                    Add new
                  </div>
                  <div style={{ display: 'flex', gap: 4, padding: '0 4px' }}>
                    <input value={addOrgName}
                      onChange={e => setAddOrgName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createOrg() } }}
                      placeholder="e.g. IJO"
                      style={{ flex: 1, fontSize: 12, padding: '4px 8px' }} />
                    <button type="button"
                      onClick={() => void createOrg()}
                      disabled={!addOrgName.trim() || addingOrg}
                      className="btn-primary btn-xs">
                      {addingOrg ? '…' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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
                <th>Orgs</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>Loading…</td></tr>
              )}
              {loaded && filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>No stores match your filters.</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} onClick={() => setSelected(s)}
                  style={{ cursor: 'pointer', opacity: s.active === false ? 0.55 : 1 }}
                  onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream2)'}
                  onMouseOut={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {s.store_image_url ? (
                        <img src={s.store_image_url} alt=""
                          style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--pearl)' }} />
                      ) : (
                        <span style={{
                          width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                          background: 'var(--cream2)', display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, color: 'var(--mist)', fontWeight: 800,
                        }}>◆</span>
                      )}
                      <span style={{ color: 'var(--green-dark)', fontWeight: 700 }}>{s.name}</span>
                      {s.active === false && (
                        <span style={{
                          padding: '1px 6px', borderRadius: 4,
                          background: 'var(--cream2)', color: 'var(--mist)',
                          fontSize: 10, fontWeight: 800, letterSpacing: '.04em',
                        }}>INACTIVE</span>
                      )}
                    </div>
                  </td>
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
                  <td>
                    {(() => {
                      const ids = Array.from(membership.get(s.id) || [])
                      if (ids.length === 0) return <span style={{ color: 'var(--silver)' }}>—</span>
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {ids.map(id => {
                            const o = orgsById.get(id)
                            if (!o) return null
                            return (
                              <span key={id} style={{
                                padding: '1px 6px', borderRadius: 4,
                                background: 'var(--cream2)', color: 'var(--ink)',
                                fontSize: 10, fontWeight: 800, letterSpacing: '.03em',
                              }}>{o.name}</span>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </td>
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
        orgs={orgs}
        memberOrgIds={membership.get(selected.id) || new Set()}
        onToggleOrg={(orgId, on) => toggleStoreOrg(selected.id, orgId, on)}
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
    onChange([...contacts, { name: '', title: '', phone: '', email: '', send_documents: false }])
  }

  // 5 inputs + send-doc + remove. The grid template fits at ~860px;
  // wraps below that. Using a wider min-width via overflowX so
  // narrow viewports scroll horizontally inside the modal.
  const cols = '1fr 130px 130px 1fr 110px 32px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 8, minWidth: 720,
          fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          <span>Name</span>
          <span>Title</span>
          <span>Cell</span>
          <span>Email</span>
          <span style={{ textAlign: 'center' }}>Send Docs</span>
          <span></span>
        </div>
        {contacts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--mist)', padding: '8px 0', textAlign: 'center' }}>
            No contacts yet. Click "+ Add contact" below.
          </div>
        ) : (
          contacts.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: 720, marginTop: 6 }}>
              <input
                type="text"
                value={c.name ?? ''}
                onChange={e => update(i, { name: e.target.value })}
                placeholder="Contact name"
              />
              <select
                value={c.title ?? ''}
                onChange={e => update(i, { title: e.target.value })}
              >
                <option value="">Title…</option>
                {CONTACT_TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <PhoneInput
                value={rawDigits(c.phone || '')}
                onChange={(raw) => update(i, { phone: raw })}
                placeholder="555-123-4567"
              />
              <input
                type="email"
                value={c.email ?? ''}
                onChange={e => update(i, { email: e.target.value })}
                placeholder="contact@example.com"
              />
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox
                  checked={!!c.send_documents}
                  onChange={(next) => update(i, { send_documents: next })}
                  size={18}
                />
              </div>
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
      </div>
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
function Modal({ store, trunkReps, orgs, memberOrgIds, onToggleOrg, onClose, onSaved, onDelete }: {
  store: TrunkShowStore
  trunkReps: TrunkRep[]
  orgs: TradeOrganization[]
  memberOrgIds: Set<string>
  onToggleOrg: (orgId: string, on: boolean) => void
  onClose: () => void
  onSaved: (s: TrunkShowStore) => void
  onDelete: () => void | Promise<void>
}) {
  const [details, setDetails] = useState<TrunkShowStore>({ ...store })
  const imgRef = useRef<HTMLInputElement>(null)
  const [imageOpen, setImageOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyMatches, setCopyMatches] = useState<Array<{ id: string; name: string; city: string | null; state: string | null; store_image_url: string }> | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)

  // Keep local copy in sync if parent swaps the selected store
  useEffect(() => { setDetails({ ...store }) }, [store.id])

  // Logo upload — base-64 data URL, mirrors the buying-event side.
  const uploadLogo = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      const { data, error } = await supabase
        .from('trunk_show_stores').update({ store_image_url: dataUrl }).eq('id', store.id)
        .select(COLS).single()
      if (error) { alert('Upload failed: ' + error.message); return }
      onSaved(data as TrunkShowStore)
      setDetails(p => ({ ...p, store_image_url: dataUrl }))
    }
    reader.readAsDataURL(file)
  }

  const removeLogo = async () => {
    if (!confirm('Remove store logo?')) return
    const { data, error } = await supabase
      .from('trunk_show_stores').update({ store_image_url: null }).eq('id', store.id)
      .select(COLS).single()
    if (error) { alert('Remove failed: ' + error.message); return }
    onSaved(data as TrunkShowStore)
    setDetails(p => ({ ...p, store_image_url: null }))
  }

  // "Copy from buying stores" — looks for a public.stores row with the
  // same (name, state) that has a logo. Multiple matches → user picks.
  const findBuyingLogos = async () => {
    setCopyBusy(true)
    setCopyMatches(null)
    setCopyOpen(true)
    try {
      let q = supabase.from('stores')
        .select('id, name, city, state, store_image_url')
        .ilike('name', store.name)
        .not('store_image_url', 'is', null)
      if (store.state) q = q.eq('state', store.state.toUpperCase())
      const { data } = await q
      const rows = ((data || []) as any[]).filter(r => !!r.store_image_url) as Array<{ id: string; name: string; city: string | null; state: string | null; store_image_url: string }>
      setCopyMatches(rows)
    } finally {
      setCopyBusy(false)
    }
  }

  const copyLogoFrom = async (dataUrl: string) => {
    const { data, error } = await supabase
      .from('trunk_show_stores').update({ store_image_url: dataUrl }).eq('id', store.id)
      .select(COLS).single()
    if (error) { alert('Copy failed: ' + error.message); return }
    onSaved(data as TrunkShowStore)
    setDetails(p => ({ ...p, store_image_url: dataUrl }))
    setCopyOpen(false)
    setCopyMatches(null)
  }

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

          {/* Captured lead profile (renders nothing if not lead-sourced) */}
          <LeadProfileCard storeKind="trunk_show_store" targetId={store.id} />

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
              {/* Trade organization memberships. Toggles persist
                  immediately (separate join table — bypasses the
                  modal's main autosave hook). New orgs get created
                  via the top-of-page filter dropdown. */}
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label className="fl">Trade Organizations</label>
                {orgs.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                    No organizations defined yet. Add one from the org dropdown above the list.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {orgs.map(o => (
                      <Checkbox key={o.id}
                        checked={memberOrgIds.has(o.id)}
                        onChange={(next) => onToggleOrg(o.id, next)}
                        size={18}
                        label={<span style={{ fontSize: 13 }}>{o.name}</span>}
                      />
                    ))}
                  </div>
                )}
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

          {/* Store logo — collapsed by default. Upload a base-64
              image, or copy a matching logo from the buying-event
              side via the "Copy from buying stores" shortcut. */}
          <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setImageOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, color: 'var(--ash)', fontFamily: 'inherit',
              }}>
              <span style={{
                display: 'inline-block', width: 10, transition: 'transform .15s ease',
                transform: imageOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▶</span>
              Store logo{details.store_image_url ? '' : ' (none)'}
            </button>
            {imageOpen && (
              <div style={{ marginTop: 10 }}>
                {details.store_image_url ? (
                  <>
                    <img src={details.store_image_url} alt="Store logo"
                      style={{ maxWidth: 200, borderRadius: 'var(--r)', border: '1px solid var(--pearl)', display: 'block', marginBottom: 10 }} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn-primary btn-sm" onClick={() => imgRef.current?.click()}>Replace</button>
                      <button className="btn-outline btn-sm" onClick={findBuyingLogos}>📥 Copy from buying stores</button>
                      <button className="btn-danger btn-sm" onClick={removeLogo}>Remove</button>
                    </div>
                  </>
                ) : (
                  <div>
                    <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 10 }}>No logo uploaded yet.</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn-primary btn-sm" onClick={() => imgRef.current?.click()}>Upload Image</button>
                      <button className="btn-outline btn-sm" onClick={findBuyingLogos}>📥 Copy from buying stores</button>
                    </div>
                  </div>
                )}
                <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]) }} />
              </div>
            )}
          </div>

          {copyOpen && (
            <div onClick={() => !copyBusy && setCopyOpen(false)} style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
            }}>
              <div onClick={e => e.stopPropagation()} style={{
                background: '#fff', borderRadius: 12, width: 'min(440px, 100%)', padding: 20,
                boxShadow: '0 20px 60px rgba(0,0,0,.30)',
              }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px' }}>📥 Copy logo from buying stores</h3>
                {copyBusy ? (
                  <div style={{ fontSize: 13, color: 'var(--mist)' }}>Searching…</div>
                ) : !copyMatches || copyMatches.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--mist)' }}>
                    No buying-event store with a logo matched <strong>{store.name}</strong>
                    {store.state ? ` (${store.state})` : ''}. Upload one manually instead.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {copyMatches.map(m => (
                      <button key={m.id} onClick={() => copyLogoFrom(m.store_image_url)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: 10,
                          background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8,
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        }}>
                        <img src={m.store_image_url} alt=""
                          style={{ width: 44, height: 44, borderRadius: 4, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--pearl)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{m.name}</div>
                          {(m.city || m.state) && (
                            <div style={{ fontSize: 11, color: 'var(--mist)' }}>{[m.city, m.state].filter(Boolean).join(', ')}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 700 }}>Use →</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button className="btn-outline btn-sm" onClick={() => setCopyOpen(false)} disabled={copyBusy}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Inactive flag — kept at the bottom near the Delete row
              since it's a "lifecycle" action, not part of the daily
              edit flow. */}
          <div style={{
            padding: '12px 14px', borderRadius: 8,
            background: details.active === false ? '#FFFBEB' : 'var(--cream2)',
            border: '1px solid ' + (details.active === false ? '#FCD34D' : 'var(--pearl)'),
          }}>
            <Checkbox
              checked={details.active === false}
              onChange={async (checked) => {
                const next = !checked
                set('active', next)
                const { data, error } = await supabase
                  .from('trunk_show_stores').update({ active: next }).eq('id', store.id)
                  .select(COLS).single()
                if (error) { alert('Save failed: ' + error.message); return }
                onSaved(data as TrunkShowStore)
              }}
              label={
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: details.active === false ? '#92400E' : 'var(--ash)',
                }}>
                  {details.active === false ? '⚠ Inactive — hidden from list' : 'Mark store inactive (dormant)'}
                </span>
              }
            />
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
