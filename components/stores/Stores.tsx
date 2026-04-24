'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import type { Store } from '@/types'
import BookingConfigCard from './BookingConfigCard'
import QrCodesSection from './QrCodesSection'
import PhoneInput from '@/components/ui/PhoneInput'
import { formatPhoneDisplay, rawDigits } from '@/lib/phone'

interface Employee { id: string; store_id: string; name: string; phone: string; email: string }

// ── Timeout wrapper: prevents permanent UI hangs from supabase deadlocks ──
// Accepts Supabase query builders (PromiseLike) as well as native Promises
const withTimeout = (promise: PromiseLike<any>, ms = 10000): Promise<any> => {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ])
}

/** Extract address components from a Google Places result */
function parsePlaceAddress(place: any) {
  const comps = place.address_components || []
  const get = (type: string) => comps.find((c: any) => c.types.includes(type))?.long_name || ''
  const getShort = (type: string) => comps.find((c: any) => c.types.includes(type))?.short_name || ''
  return {
    address: `${get('street_number')} ${get('route')}`.trim(),
    city: get('locality') || get('sublocality') || get('neighborhood'),
    state: getShort('administrative_area_level_1'),
    zip: get('postal_code'),
    lat: place.geometry?.location?.lat() || 0,
    lng: place.geometry?.location?.lng() || 0,
  }
}

// Load Google Maps script once
function useGoogleMaps() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).google?.maps?.places) { setLoaded(true); return }
    const existing = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existing) { existing.addEventListener('load', () => setLoaded(true)); return }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}&libraries=places`
    script.async = true
    script.onload = () => setLoaded(true)
    document.head.appendChild(script)
  }, [])
  return loaded
}

// Store name search with Google Places
function StoreSearch({ onSelect }: {
  onSelect: (data: {
    name: string; address: string; city: string; state: string; zip: string;
    lat: number; lng: number; website?: string; phone?: string
  }) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mapsLoaded = useGoogleMaps()

  useEffect(() => {
    if (!mapsLoaded || !inputRef.current) return
    const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'us' },
      fields: ['name', 'address_components', 'formatted_address', 'geometry', 'website', 'formatted_phone_number'],
    })
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.address_components) return
      const addr = parsePlaceAddress(place)
      onSelect({
        ...addr,
        name: place.name || '',
        website: place.website || '',
        phone: place.formatted_phone_number || '',
      })
    })
  }, [mapsLoaded])

  return (
    <input ref={inputRef} type="text" placeholder="Search for a jewelry store by name…" />
  )
}

export default function Stores() {
  const { events, brand, setStores: setContextStores } = useApp()

  const [stores, setStores] = useState<Store[]>([])
  const [storesLoaded, setStoresLoaded] = useState(false)
  const [selected, setSelected] = useState<Store | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [newStore, setNewStore] = useState({
    name: '', address: '', city: '', state: '', zip: '', lat: 0, lng: 0, website: '', owner_phone: ''
  })
  const [placePicked, setPlacePicked] = useState(false)
  const [sort, setSort] = useState<'name' | 'state' | 'spent'>('name')

  // ── Direct fetch — fresh query builder each time ──
  const fetchStores = useCallback(async () => {
    try {
      const { data } = await withTimeout(
        supabase.from('stores').select('*').eq('brand', brand).order('name')
      )
      if (data) {
        setStores(data)
        setContextStores(data)
      }
    } catch (err) {
      console.error('fetchStores error:', err)
    }
    setStoresLoaded(true)
  }, [brand, setContextStores])

  useEffect(() => {
    fetchStores()
  }, [fetchStores])

  const storeSpend = (storeId: string) => {
    return events
      .filter(ev => ev.store_id === storeId && new Date(ev.start_date).getFullYear() === new Date().getFullYear())
      .reduce((total, ev) => total + ev.days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0), 0)
  }

  const filtered = stores.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.state || '').toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'state') return (a.state || '').localeCompare(b.state || '') || a.name.localeCompare(b.name)
    if (sort === 'spent') return storeSpend(b.id) - storeSpend(a.id)
    return 0
  })

  const handlePlaceSelect = (data: any) => {
    setNewStore(p => ({
      ...p,
      name: data.name || p.name,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      lat: data.lat,
      lng: data.lng,
      website: data.website || '',
      owner_phone: rawDigits(data.phone || ''),
    }))
    setPlacePicked(true)
  }

  // ── CRITICAL: fresh insert + direct re-fetch, no reload() ──
  const createStore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStore.name) { alert('Store name is required.'); return }
    if (!newStore.address && !newStore.city && !newStore.state) {
      if (!confirm('No address entered. Create store with just a name?')) return
    }
    setSaving(true)
    try {
      const { data, error } = await withTimeout(
        supabase.from('stores').insert({ ...newStore, brand }).select().single()
      )
      if (error) { alert('Failed to create store: ' + error.message); return }

      // Reset form
      setShowForm(false)
      setNewStore({ name: '', address: '', city: '', state: '', zip: '', lat: 0, lng: 0, website: '', owner_phone: '' })
      setPlacePicked(false)

      // Re-fetch stores directly with a fresh query
      const { data: freshStores } = await withTimeout(
        supabase.from('stores').select('*').eq('brand', brand).order('name')
      )
      if (freshStores) {
        setStores(freshStores)
        setContextStores(freshStores)
      }
    } catch (err: any) {
      alert('Error creating store: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  // ── Optimistic delete ──
  const deleteStore = async (id: string) => {
    if (!confirm('Delete this store? This cannot be undone.')) return

    // Optimistic: remove from UI immediately
    const prev = stores
    setStores(s => s.filter(x => x.id !== id))
    setContextStores(prev.filter(x => x.id !== id))
    if (selected?.id === id) setSelected(null)

    try {
      const { error } = await withTimeout(
        supabase.from('stores').delete().eq('id', id)
      )
      if (error) {
        // Revert on failure
        setStores(prev)
        setContextStores(prev)
        alert('Delete failed: ' + error.message)
      }
    } catch (err: any) {
      setStores(prev)
      setContextStores(prev)
      alert('Delete failed: ' + (err?.message || 'timeout'))
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Jewelry Stores</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search stores…" style={{ width: 180 }} />
          <select value={sort} onChange={e => setSort(e.target.value as any)} style={{ width: 'auto' }}>
            <option value="name">Sort: A–Z</option>
            <option value="state">Sort: By State</option>
            <option value="spent">Sort: Amount Spent ({new Date().getFullYear()})</option>
          </select>
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add Store</button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-5" style={{ border: '2px solid var(--green3)', marginBottom: 20 }}>
          <div className="card-title">New Jewelry Store</div>
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
                <div style={{ fontSize: 13 }}>{newStore.address}, {newStore.city}, {newStore.state} {newStore.zip}</div>
                {newStore.website && <div style={{ fontSize: 12, marginTop: 2 }}>🌐 {newStore.website}</div>}
                {newStore.owner_phone && <div style={{ fontSize: 12 }}>📞 {formatPhoneDisplay(newStore.owner_phone)}</div>}
              </div>
            )}

            <div className="field">
              <label className="fl">Store Name *</label>
              <input value={newStore.name} onChange={e => setNewStore(p => ({ ...p, name: e.target.value }))}
                placeholder="Edit name if needed" required />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary btn-sm" disabled={saving}>
                {saving ? 'Adding…' : 'Add Store'}
              </button>
              <button type="button" className="btn-outline btn-sm" onClick={() => { setShowForm(false); setPlacePicked(false) }}>
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
                <th>Events</th>
                <th>💰 Amount Spent ({new Date().getFullYear()})</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>No stores yet.</td></tr>
              )}
              {filtered.map(s => {
                const ec = events.filter(e => e.store_id === s.id).length
                const spent = storeSpend(s.id)
                return (
                  <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}
                    onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream2)'}
                    onMouseOut={e => (e.currentTarget as HTMLElement).style.background = ''}>
                    <td><span style={{ color: 'var(--green-dark)', fontWeight: 700 }}>◆ {s.name}</span></td>
                    <td>{s.city || '—'}</td>
                    <td>{s.state || '—'}</td>
                    <td>{ec}</td>
                    <td>
                      {spent > 0
                        ? <span style={{ fontWeight: 700, color: 'var(--green)' }}>${Math.round(spent).toLocaleString()}</span>
                        : <span style={{ color: 'var(--silver)' }}>—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="btn-danger btn-xs" onClick={() => deleteStore(s.id)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <StoreModal store={selected} onClose={() => setSelected(null)} refetchStores={fetchStores} />}
    </div>
  )
}

/* ── STORE DETAIL MODAL ── */
function StoreModal({ store, onClose, refetchStores }: { store: Store; onClose: () => void; refetchStores: () => Promise<void> }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [details, setDetails] = useState({ ...store })
  const [feedUrl, setFeedUrl] = useState(store.calendar_feed_url || '')
  const [calendarOffset, setCalendarOffset] = useState<number>(store.calendar_offset_hours ?? 0)
  const imgRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('store_employees').select('*').eq('store_id', store.id).order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [store.id])

  const infoStatus = useAutosave(
    {
      name: details.name,
      website: details.website,
      address: details.address,
      city: details.city,
      state: details.state,
      zip: details.zip,
      notes: details.notes,
    },
    async (d) => {
      const { error } = await withTimeout(
        supabase.from('stores').update({
          name: d.name, website: d.website,
          address: d.address, city: d.city,
          state: d.state?.toUpperCase(), zip: d.zip, notes: d.notes,
        }).eq('id', store.id)
      )
      if (error) throw error
      await refetchStores()
    },
    { delay: 1000 }
  )

  const feedStatus = useAutosave(
    { feedUrl, calendarOffset },
    async ({ feedUrl, calendarOffset }) => {
      const { error } = await withTimeout(
        supabase.from('stores').update({
          calendar_feed_url: feedUrl,
          calendar_offset_hours: calendarOffset,
        }).eq('id', store.id)
      )
      if (error) throw error
      await refetchStores()
    },
    { delay: 1000 }
  )

  const deleteEmployee = async (id: string) => {
    if (!confirm('Remove this employee?')) return
    await withTimeout(supabase.from('store_employees').delete().eq('id', id))
    setEmployees(p => p.filter(e => e.id !== id))
  }

  const uploadStoreImage = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      await withTimeout(supabase.from('stores').update({ store_image_url: dataUrl }).eq('id', store.id))
      alert('Image uploaded!')
      await refetchStores()
    }
    reader.readAsDataURL(file)
  }

  const fullAddress = [details.address, details.city, details.state, details.zip].filter(Boolean).join(', ')
  const mapUrl = fullAddress
    ? `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}&q=${encodeURIComponent(fullAddress)}`
    : null

  const field = (label: string, key: keyof typeof details, type = 'text', placeholder = '') => (
    <div className="field" key={key}>
      <label className="fl">{label}</label>
      <input type={type} value={(details as any)[key] || ''} placeholder={placeholder}
        onChange={e => setDetails((p: any) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-lg)' }}>

        {/* Dark header */}
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 14 }}>◆ Store Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{store.name}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Google Map */}
          {mapUrl && (
            <div style={{ borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--pearl)' }}>
              <iframe src={mapUrl} width="100%" height="200" style={{ border: 0, display: 'block' }} allowFullScreen loading="lazy" />
            </div>
          )}

          {/* Store Information */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
                Store Information
                <AutosaveIndicator status={infoStatus} />
              </div>
              <AddressUpdateButton onSelect={(data) => {
                setDetails((p: any) => ({
                  ...p,
                  address: data.address,
                  city: data.city,
                  state: data.state,
                  zip: data.zip,
                  website: data.website || p.website,
                }))
              }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field('Store Name', 'name', 'text', 'Premier Fine Jewelry')}
              {field('Website', 'website', 'url', 'https://')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: 12 }}>
              {field('Street Address', 'address', 'text', '123 Main St')}
              {field('City', 'city')}
              {field('State', 'state')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field('Zip Code', 'zip', 'text', '12345')}
              <div />
            </div>
            <div className="field">
              <label className="fl">Notes</label>
              <textarea rows={3} value={details.notes || ''} placeholder="Any notes about this store…"
                onChange={e => setDetails((p: any) => ({ ...p, notes: e.target.value }))}
                style={{ resize: 'none' }} />
            </div>
          </div>

          {/* Store Contacts */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Owners / Contacts</div>
            <StoreContacts storeId={store.id} />
          </div>

          {/* Store Image */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Image</div>
            {store.store_image_url ? (
              <div style={{ marginBottom: 14 }}>
                <img src={store.store_image_url} alt="Store" style={{ maxWidth: 200, borderRadius: 'var(--r)', border: '1px solid var(--pearl)', display: 'block', marginBottom: 10 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" onClick={() => imgRef.current?.click()}>Replace Image</button>
                  <button className="btn-danger btn-sm" onClick={async () => {
                    if (!confirm('Remove store image?')) return
                    await withTimeout(supabase.from('stores').update({ store_image_url: '' }).eq('id', store.id))
                    await refetchStores()
                  }}>Remove</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>No store image uploaded yet.</p>
                <button className="btn-primary btn-sm" onClick={() => imgRef.current?.click()}>Upload Image</button>
              </div>
            )}
            <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) uploadStoreImage(e.target.files[0]) }} />
          </div>

          {/* Customer Booking Configuration */}
          <BookingConfigCard
            storeId={store.id}
            initialSlug={store.slug ?? null}
            initialPrimary={store.color_primary ?? null}
            initialSecondary={store.color_secondary ?? null}
            initialTimezone={store.timezone ?? null}
            refetchStores={refetchStores}
          />

          {/* QR Codes (channel / custom / employee) */}
          <QrCodesSection storeId={store.id} storeName={store.name} />

          {/* Employees */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Employees</div>
            {employees.length === 0 && (
              <p style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 14 }}>No employees added yet.</p>
            )}
            {employees.map(emp => (
              <EmpRow key={emp.id} emp={emp}
                onSave={async (updated) => {
                  const { error } = await withTimeout(supabase.from('store_employees').update(updated).eq('id', emp.id))
                  if (error) { alert('Error: ' + error.message); return }
                  setEmployees(p => p.map(e => e.id === emp.id ? { ...e, ...updated } : e))
                }}
                onDelete={() => deleteEmployee(emp.id)}
              />
            ))}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--pearl)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 10 }}>Add Employees</div>
              <NewEmpRows onAdd={(emp) => {
                withTimeout(
                  supabase.from('store_employees').insert({ ...emp, store_id: store.id }).select().single()
                ).then(({ data, error }) => {
                  if (error) { alert('Error: ' + error.message); return }
                  if (data) setEmployees(p => [...p, data])
                }).catch(err => alert('Error: ' + err.message))
              }} />
            </div>
          </div>

          {/* Google Calendar Feed */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
              Google Calendar Feed
              <AutosaveIndicator status={feedStatus} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>
              Paste the <strong>Secret address in iCal format</strong> from Google Calendar Settings → Integrate calendar.
            </p>
            {store.calendar_feed_url && (
              <div className="notice notice-jade" style={{ marginBottom: 12, fontSize: 12, wordBreak: 'break-all' }}>
                ✓ Current: {store.calendar_feed_url}
              </div>
            )}
            <div className="field">
              <label className="fl">iCal Feed URL</label>
              <input value={feedUrl} onChange={e => setFeedUrl(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/.../.ics" style={{ fontSize: 12 }} />
            </div>

            <div className="field">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="fl" style={{ margin: 0 }}>Time Offset</label>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: calendarOffset === 0 ? 'var(--mist)' : 'var(--green-dark)',
                }}>
                  {calendarOffset === 0 ? 'No offset' : `${calendarOffset > 0 ? '+' : ''}${calendarOffset} hr${Math.abs(calendarOffset) === 1 ? '' : 's'}`}
                </span>
              </div>
              <input
                type="range" min={-4} max={4} step={1}
                value={calendarOffset}
                onChange={e => setCalendarOffset(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--green)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fog)', marginTop: 2, fontWeight: 700 }}>
                <span>-4h</span><span>-2h</span><span>0</span><span>+2h</span><span>+4h</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6, lineHeight: 1.4 }}>
                Shifts displayed appointment times. Use if the feed's times don't match the store's local time.
              </div>
            </div>

            {store.calendar_feed_url && (
              <button className="btn-danger btn-sm" onClick={async () => {
                if (!confirm('Remove calendar feed URL?')) return
                try {
                  await withTimeout(supabase.from('stores').update({ calendar_feed_url: '' }).eq('id', store.id))
                  setFeedUrl('')
                  await refetchStores()
                } catch (e: any) {
                  alert('Failed: ' + (e?.message || 'unknown error'))
                }
              }}>Remove</button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

/* ── EMPLOYEE ROW (edit inline) ── */
function EmpRow({ emp, onSave, onDelete }: {
  emp: Employee
  onSave: (updated: Partial<Employee>) => Promise<void>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [vals, setVals] = useState({ name: emp.name, phone: emp.phone, email: emp.email })

  const status = useAutosave(
    vals,
    async (v) => {
      if (!v.name.trim()) return
      await onSave(v)
    },
    { enabled: editing, delay: 1000 }
  )

  if (editing) return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input value={vals.name} onChange={e => setVals(p => ({ ...p, name: e.target.value }))} placeholder="Name" required style={{ fontSize: 13 }} />
        <PhoneInput value={vals.phone} onChange={v => setVals(p => ({ ...p, phone: v }))} style={{ fontSize: 13 }} />
        <input type="email" value={vals.email} onChange={e => setVals(p => ({ ...p, email: e.target.value }))} placeholder="Email" style={{ fontSize: 13 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-outline btn-xs" onClick={() => setEditing(false)}>Done</button>
        <AutosaveIndicator status={status} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{emp.name}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>{formatPhoneDisplay(emp.phone)}{emp.phone && emp.email ? ' · ' : ''}{emp.email}</div>
      </div>
      <button className="btn-outline btn-xs" onClick={() => setEditing(true)}>✎ Edit</button>
      <button className="btn-danger btn-xs" onClick={onDelete}>Remove</button>
    </div>
  )
}

/* ── NEW EMPLOYEE ROWS (add multiple at once) ── */
function NewEmpRows({ onAdd }: { onAdd: (emp: { name: string; phone: string; email: string }) => void }) {
  const blank = () => ({ id: Math.random().toString(), name: '', phone: '', email: '' })
  const [rows, setRows] = useState([blank()])

  const update = (id: string, key: string, val: string) =>
    setRows(p => p.map(r => r.id === id ? { ...r, [key]: val } : r))

  const addRow = () => setRows(p => [...p, blank()])
  const removeRow = (id: string) => setRows(p => p.filter(r => r.id !== id))

  const saveAll = () => {
    const valid = rows.filter(r => r.name.trim())
    if (valid.length === 0) return
    valid.forEach(r => onAdd({ name: r.name.trim(), phone: r.phone.trim(), email: r.email.trim() }))
    setRows([blank()])
  }

  return (
    <div>
      {rows.map((row) => (
        <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input value={row.name} onChange={e => update(row.id, 'name', e.target.value)}
            placeholder="Name *" style={{ fontSize: 13 }} />
          <PhoneInput value={row.phone} onChange={v => update(row.id, 'phone', v)}
            style={{ fontSize: 13 }} />
          <input type="email" value={row.email} onChange={e => update(row.id, 'email', e.target.value)}
            placeholder="Email" style={{ fontSize: 13 }} />
          {rows.length > 1
            ? <button className="btn-danger btn-xs" onClick={() => removeRow(row.id)}>✕</button>
            : <div />
          }
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-primary btn-sm" onClick={saveAll}>Save Employees</button>
        <button className="btn-outline btn-sm" onClick={addRow}>+ Add Row</button>
      </div>
    </div>
  )
}

/* ── STORE CONTACTS ── */
interface Contact { id: string; store_id: string; name: string; phone: string; email: string; title: string }

function StoreContacts({ storeId }: { storeId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('store_contacts').select('*').eq('store_id', storeId).order('created_at')
      .then(({ data }) => { setContacts(data || []); setLoaded(true) })
  }, [storeId])

  const addContact = async (c: { name: string; phone: string; email: string; title: string }) => {
    const { data, error } = await withTimeout(
      supabase.from('store_contacts').insert({ ...c, store_id: storeId }).select().single()
    )
    if (error) { alert('Error: ' + error.message); return }
    if (data) setContacts(p => [...p, data])
  }

  const updateContact = async (id: string, updates: Partial<Contact>) => {
    const { error } = await withTimeout(
      supabase.from('store_contacts').update(updates).eq('id', id)
    )
    if (error) { alert('Error: ' + error.message); return }
    setContacts(p => p.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  const deleteContact = async (id: string) => {
    if (!confirm('Remove this contact?')) return
    await withTimeout(supabase.from('store_contacts').delete().eq('id', id))
    setContacts(p => p.filter(c => c.id !== id))
  }

  if (!loaded) return <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>

  return (
    <div>
      {contacts.length === 0 && (
        <p style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 14 }}>No contacts added yet.</p>
      )}
      {contacts.map(c => (
        <ContactRow key={c.id} contact={c}
          onSave={(updates) => updateContact(c.id, updates)}
          onDelete={() => deleteContact(c.id)}
        />
      ))}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--pearl)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 10 }}>Add Contacts</div>
        <NewContactRows onAdd={addContact} />
      </div>
    </div>
  )
}

function ContactRow({ contact, onSave, onDelete }: {
  contact: Contact
  onSave: (updates: Partial<Contact>) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [vals, setVals] = useState({ name: contact.name, phone: contact.phone, email: contact.email, title: contact.title })

  const status = useAutosave(
    vals,
    async (v) => {
      if (!v.name.trim()) return
      await onSave(v)
    },
    { enabled: editing, delay: 1000 }
  )

  if (editing) return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input value={vals.name} onChange={e => setVals(p => ({ ...p, name: e.target.value }))} placeholder="Name *" style={{ fontSize: 13 }} />
        <input value={vals.title} onChange={e => setVals(p => ({ ...p, title: e.target.value }))} placeholder="Title (e.g. Owner)" style={{ fontSize: 13 }} />
        <PhoneInput value={vals.phone} onChange={v => setVals(p => ({ ...p, phone: v }))} style={{ fontSize: 13 }} />
        <input type="email" value={vals.email} onChange={e => setVals(p => ({ ...p, email: e.target.value }))} placeholder="Email" style={{ fontSize: 13 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-outline btn-xs" onClick={() => setEditing(false)}>Done</button>
        <AutosaveIndicator status={status} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{contact.name} {contact.title && <span style={{ fontSize: 12, color: 'var(--mist)', fontWeight: 400 }}>· {contact.title}</span>}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>{contact.phone}{contact.phone && contact.email ? ' · ' : ''}{contact.email}</div>
      </div>
      <button className="btn-outline btn-xs" onClick={() => setEditing(true)}>✎ Edit</button>
      <button className="btn-danger btn-xs" onClick={onDelete}>Remove</button>
    </div>
  )
}

function NewContactRows({ onAdd }: { onAdd: (c: { name: string; phone: string; email: string; title: string }) => void }) {
  const blank = () => ({ id: Math.random().toString(), name: '', phone: '', email: '', title: '' })
  const [rows, setRows] = useState([blank()])

  const update = (id: string, key: string, val: string) =>
    setRows(p => p.map(r => r.id === id ? { ...r, [key]: val } : r))

  const saveAll = () => {
    const valid = rows.filter(r => r.name.trim())
    if (valid.length === 0) { alert('Enter at least one name.'); return }
    valid.forEach(r => onAdd({ name: r.name.trim(), phone: r.phone.trim(), email: r.email.trim(), title: r.title.trim() }))
    setRows([blank()])
  }

  return (
    <div>
      {rows.map(row => (
        <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input value={row.name} onChange={e => update(row.id, 'name', e.target.value)} placeholder="Name *" style={{ fontSize: 13 }} />
          <input value={row.title} onChange={e => update(row.id, 'title', e.target.value)} placeholder="Title" style={{ fontSize: 13 }} />
          <PhoneInput value={row.phone} onChange={v => update(row.id, 'phone', v)} style={{ fontSize: 13 }} />
          <input type="email" value={row.email} onChange={e => update(row.id, 'email', e.target.value)} placeholder="Email" style={{ fontSize: 13 }} />
          {rows.length > 1
            ? <button className="btn-danger btn-xs" onClick={() => setRows(p => p.filter(r => r.id !== row.id))}>✕</button>
            : <div />}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-primary btn-sm" onClick={saveAll}>Save Contacts</button>
        <button className="btn-outline btn-sm" onClick={() => setRows(p => [...p, blank()])}>+ Add Row</button>
      </div>
    </div>
  )
}

/* ── ADDRESS UPDATE BUTTON ── */
function AddressUpdateButton({ onSelect }: {
  onSelect: (data: { address: string; city: string; state: string; zip: string; website?: string; lat?: number; lng?: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mapsLoaded = useGoogleMaps()

  useEffect(() => {
    if (!open || !mapsLoaded || !inputRef.current) return
    const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components', 'geometry', 'website'],
    })
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.address_components) return
      const addr = parsePlaceAddress(place)
      onSelect({ ...addr, website: place.website || '' })
      setOpen(false)
    })
  }, [open, mapsLoaded])

  return (
    <div>
      {!open ? (
        <button className="btn-outline btn-sm" onClick={() => setOpen(true)}>
          📍 Update Address
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search Google Places to update address…"
            autoFocus
            style={{ fontSize: 13, minWidth: 260 }}
          />
          <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}
