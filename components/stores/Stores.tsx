'use client'

import { useState, useRef, useEffect } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'

interface Employee { id: string; store_id: string; name: string; phone: string; email: string }

export default function Stores() {
  const { stores, events, reload } = useApp()
  const [selected, setSelected] = useState<Store | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [newStore, setNewStore] = useState({ name: '', city: '', state: '' })

  const filtered = stores.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.state || '').toLowerCase().includes(search.toLowerCase())
  )

  const createStore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStore.name) return
    setSaving(true)
    await supabase.from('stores').insert(newStore)
    setSaving(false)
    setShowForm(false)
    setNewStore({ name: '', city: '', state: '' })
    reload()
  }

  const deleteStore = async (id: string) => {
    if (!confirm('Delete this store? This cannot be undone.')) return
    await supabase.from('stores').delete().eq('id', id)
    reload()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="notice notice-gold" style={{ display: 'inline-block', marginBottom: 16 }}>
        Admin only — buyers cannot add or remove stores.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Jewelry Stores</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search stores…" style={{ width: 200 }} />
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add Store</button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-5" style={{ border: '2px solid var(--green3)', marginBottom: 20 }}>
          <div className="card-title">New Jewelry Store</div>
          <form onSubmit={createStore}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 12, marginBottom: 16 }}>
              <div className="field">
                <label className="fl">Store Name</label>
                <input value={newStore.name} onChange={e => setNewStore(p => ({ ...p, name: e.target.value }))} placeholder="Premier Fine Jewelry" required />
              </div>
              <div className="field">
                <label className="fl">City</label>
                <input value={newStore.city} onChange={e => setNewStore(p => ({ ...p, city: e.target.value }))} placeholder="Atlanta" />
              </div>
              <div className="field">
                <label className="fl">State</label>
                <input value={newStore.state} onChange={e => setNewStore(p => ({ ...p, state: e.target.value.toUpperCase() }))} placeholder="GA" maxLength={2} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary btn-sm" disabled={saving}>{saving ? 'Adding…' : 'Add Store'}</button>
              <button type="button" className="btn-outline btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
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
                <th>Location</th>
                <th>Events</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>No stores yet.</td></tr>
              )}
              {filtered.map(s => {
                const ec = events.filter(e => e.store_id === s.id).length
                return (
                  <tr key={s.id} onClick={() => setSelected(s)}
                    style={{ cursor: 'pointer' }}
                    onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream2)'}
                    onMouseOut={e => (e.currentTarget as HTMLElement).style.background = ''}>
                    <td>
                      <span style={{ color: 'var(--green-dark)', fontWeight: 700, fontSize: 14 }}>
                        ◆ {s.name}
                      </span>
                    </td>
                    <td>{s.city}{s.city && s.state ? ', ' : ''}{s.state}</td>
                    <td>{ec}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-danger btn-xs" onClick={() => deleteStore(s.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <StoreModal store={selected} onClose={() => setSelected(null)} reload={reload} />}
    </div>
  )
}

function StoreModal({ store, onClose, reload }: { store: Store; onClose: () => void; reload: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [details, setDetails] = useState({ ...store })
  const [newEmp, setNewEmp] = useState({ name: '', phone: '', email: '' })
  const [feedUrl, setFeedUrl] = useState(store.calendar_feed_url || '')
  const [storeImage, setStoreImage] = useState(store.qr_code_url || '')
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const showSaved = (key: string) => {
    setSaved(key)
    setTimeout(() => setSaved(null), 2000)
  }

  useEffect(() => {
    supabase.from('store_employees').select('*').eq('store_id', store.id).order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [store.id])

  const saveInfo = async () => {
    setSaving('info')
    const { error } = await supabase.from('stores').update({
      name: details.name, website: details.website,
      address: details.address, city: details.city,
      state: details.state?.toUpperCase(), zip: details.zip, notes: details.notes,
    }).eq('id', store.id)
    setSaving(null)
    if (error) { alert('Save failed: ' + error.message); return }
    showSaved('info')
    reload()
  }

  const saveOwner = async () => {
    setSaving('owner')
    const { error } = await supabase.from('stores').update({
      owner_name: details.owner_name, owner_phone: details.owner_phone, owner_email: details.owner_email,
    }).eq('id', store.id)
    setSaving(null)
    if (error) { alert('Save failed: ' + error.message); return }
    showSaved('owner')
    reload()
  }

  const saveFeed = async () => {
    setSaving('feed')
    const { error } = await supabase.from('stores').update({ calendar_feed_url: feedUrl }).eq('id', store.id)
    setSaving(null)
    if (error) { alert('Save failed: ' + error.message); return }
    setSaved('feed')
    setTimeout(() => setSaved(null), 2000)
    reload()
  }

  const addEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmp.name) return
    const { data } = await supabase.from('store_employees')
      .insert({ ...newEmp, store_id: store.id }).select().single()
    if (data) setEmployees(p => [...p, data])
    setNewEmp({ name: '', phone: '', email: '' })
  }

  const deleteEmployee = async (id: string) => {
    if (!confirm('Remove this employee?')) return
    await supabase.from('store_employees').delete().eq('id', id)
    setEmployees(p => p.filter(e => e.id !== id))
  }

  const uploadFile = async (file: File, field: 'qr_code_url' | 'store_image_url') => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      await supabase.from('stores').update({ [field]: dataUrl }).eq('id', store.id)
      if (field === 'qr_code_url') setStoreImage(dataUrl)
      alert('Image uploaded!')
      reload()
    }
    reader.readAsDataURL(file)
  }

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
        style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-lg)', position: 'relative' }}>

        {/* Dark header */}
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 14 }}>◆ Store Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{store.name}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>

        {/* Scrollable content — stacked cards like old app */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Store Information */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Information</div>
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
            <button className="btn-primary btn-sm" onClick={saveInfo} disabled={saving === 'info'}>
              {saving === 'info' ? 'Saving…' : saved === 'info' ? '✓ Saved!' : 'Save Store Info'}
            </button>
          </div>

          {/* Store Owner */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Owner</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {field('Owner Name', 'owner_name', 'text', 'John Smith')}
              {field('Owner Phone', 'owner_phone', 'tel', '(555) 000-0000')}
              {field('Owner Email', 'owner_email', 'email', 'john@store.com')}
            </div>
            <button className="btn-primary btn-sm" onClick={saveOwner} disabled={saving === 'owner'}>
              {saving === 'owner' ? 'Saving…' : saved === 'owner' ? '✓ Saved!' : 'Save Owner Info'}
            </button>
          </div>

          {/* Store Image */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Image</div>
            {store.store_image_url && (
              <div style={{ marginBottom: 14 }}>
                <img src={store.store_image_url} alt="Store" style={{ maxWidth: 200, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }} />
              </div>
            )}
            <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>Upload a photo of the store.</p>
            <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], 'store_image_url') }} />
            <button className="btn-primary btn-sm" onClick={() => imgRef.current?.click()}>
              {store.store_image_url ? 'Replace Image' : 'Upload Image'}
            </button>
          </div>

          {/* Employees */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Store Employees</div>
            <div>
              {employees.length === 0 && (
                <p style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 14 }}>No employees added yet.</p>
              )}
              {employees.map(emp => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{emp.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                      {emp.phone}{emp.phone && emp.email ? ' · ' : ''}{emp.email}
                    </div>
                  </div>
                  <button className="btn-danger btn-xs" onClick={() => deleteEmployee(emp.id)}>Remove</button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--pearl)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 8 }}>Add Employee</div>
              <form onSubmit={addEmployee}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
                  <div className="field"><label className="fl">Name</label><input value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" required /></div>
                  <div className="field"><label className="fl">Phone</label><input type="tel" value={newEmp.phone} onChange={e => setNewEmp(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 000-0000" /></div>
                  <div className="field"><label className="fl">Email</label><input type="email" value={newEmp.email} onChange={e => setNewEmp(p => ({ ...p, email: e.target.value }))} placeholder="jane@store.com" /></div>
                </div>
                <button type="submit" className="btn-primary btn-sm">Add Employee</button>
              </form>
            </div>
          </div>

          {/* Google Calendar Feed */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Google Calendar Feed</div>
            <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>
              Paste the <strong>Secret address in iCal format</strong> from Google Calendar Settings → Integrate calendar.
            </p>
            <div className="field">
              <label className="fl">iCal Feed URL</label>
              <input value={feedUrl} onChange={e => setFeedUrl(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/.../.ics"
                style={{ fontSize: 12 }} />
            </div>
            <button className="btn-primary btn-sm" onClick={saveFeed} disabled={saving === 'feed'}>
              {saving === 'feed' ? 'Saving…' : saved === 'feed' ? '✓ Saved!' : 'Save Feed URL'}
            </button>
          </div>

          {/* QR Code */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">SimplyBook QR Code</div>
            {storeImage ? (
              <div style={{ marginBottom: 14 }}>
                <img src={storeImage} alt="QR Code" style={{ maxWidth: 180, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }} />
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 14 }}>No QR code uploaded yet.</p>
            )}
            <div className="field">
              <label className="fl">Upload QR Code Image</label>
              <input ref={fileRef} type="file" accept="image/*"
                onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], 'qr_code_url') }} />
            </div>
            {storeImage && (
              <button className="btn-danger btn-sm" onClick={async () => {
                if (!confirm('Remove QR code?')) return
                await supabase.from('stores').update({ qr_code_url: '' }).eq('id', store.id)
                setStoreImage('')
                reload()
              }}>Remove QR Code</button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
