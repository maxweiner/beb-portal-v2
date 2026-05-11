'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { WholesaleVendor, InventoryItem } from '@/types/wholesale'
import { fmtDate, fmtMoneyCents } from '@/lib/wholesale/format'
import { logAudit, diffFields } from '@/lib/wholesale/audit'
import { Modal, Section, Row, Field, Select } from './InventoryView'
import AddressAutocompleteInput from '@/components/ui/AddressAutocompleteInput'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'
import { formatPhoneDisplay } from '@/lib/phone'

export default function VendorsView() {
  const { user, brand } = useApp()
  const [vendors, setVendors] = useState<WholesaleVendor[] | null>(null)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    if (!brand) return
    setErr(null)
    try {
      const { data, error } = await supabase.from('wholesale_vendors').select('*')
        .eq('brand', brand).is('archived_at', null).order('company_name')
      if (error) throw new Error(error.message)
      setVendors((data || []) as WholesaleVendor[])
    } catch (e: any) { setErr(e?.message || 'Failed to load'); setVendors([]) }
  }
  useEffect(() => { void reload() }, [brand])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vendors || []
    return (vendors || []).filter(v => (
      [v.company_name, v.contact_name, v.email, v.phone].filter(Boolean).join(' ').toLowerCase().includes(q)
    ))
  }, [vendors, search])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search vendor name, contact, email…"
          style={{ flex: '1 1 240px', maxWidth: 360, fontSize: 12, padding: '6px 10px' }} />
        <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New Vendor</button>
      </div>
      {err && <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{err}</div>}
      {vendors === null ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        : filtered.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No vendors yet.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--cream2)' }}>
                {['Company','Contact','Phone','Email','Created',''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} onClick={() => setOpenId(v.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{v.company_name}</td>
                    <td style={{ padding: '8px 10px' }}>{v.contact_name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{v.phone ? formatPhoneDisplay(v.phone) : '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{v.email || '—'}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--mist)' }}>{fmtDate(v.created_at)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showNew && <VendorModal mode="new" brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); void reload() }} />}
      {openId && <VendorModal mode="edit" id={openId} brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void reload() }} />}
    </div>
  )
}

function VendorModal({
  mode, id, brand, actorId, actorEmail, onClose, onSaved,
}: {
  mode: 'new' | 'edit'
  id?: string
  brand: string
  actorId: string | null
  actorEmail: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [vendor, setVendor] = useState<WholesaleVendor | null>(mode === 'new' ? ({} as WholesaleVendor) : null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [company_name, setCompanyName] = useState('')
  const [contact_name, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [mobile_phone, setMobilePhone] = useState('')
  const [email, setEmail] = useState('')
  // Address: bill-to and ship-to held separately. `sameAsBilling`
  // hides the ship-to input + mirrors billing into shipping on save —
  // most vendors really do share one address, so the default
  // collapsed state keeps the form light.
  const [billing_address, setBillingAddress] = useState('')
  const [shipping_address, setShippingAddress] = useState('')
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (mode === 'new') return
    let cancelled = false
    void (async () => {
      const { data } = await supabase.from('wholesale_vendors').select('*').eq('id', id!).maybeSingle()
      if (cancelled) return
      const v = data as WholesaleVendor | null
      setVendor(v); if (v) {
        setCompanyName(v.company_name); setContactName(v.contact_name || '')
        setPhone(v.phone || ''); setMobilePhone(v.mobile_phone || '')
        setEmail(v.email || '')
        // Prefer the new columns; fall back to legacy `address` for
        // rows the user hasn't re-saved since the split migration.
        const billing  = v.billing_address  ?? v.address ?? ''
        const shipping = v.shipping_address ?? v.address ?? ''
        setBillingAddress(billing)
        setShippingAddress(shipping)
        setShippingSameAsBilling(!shipping || shipping === billing)
        setNotes(v.notes || '')
      }
      const { data: itemsRes } = await supabase.from('inventory_items').select('*')
        .eq('vendor_id', id!).is('archived_at', null).order('created_at', { ascending: false }).limit(50)
      if (!cancelled) setItems((itemsRes || []) as InventoryItem[])
    })()
    return () => { cancelled = true }
  }, [id, mode])

  async function save() {
    if (!company_name.trim()) { setErr('Company name is required'); return }
    setBusy(true); setErr(null)
    try {
      const billing  = billing_address.trim() || null
      const shipping = shippingSameAsBilling ? billing : (shipping_address.trim() || null)
      const payload = {
        brand, company_name: company_name.trim(),
        contact_name: contact_name.trim() || null,
        phone: phone.trim() || null,
        mobile_phone: mobile_phone.trim() || null,
        email: email.trim() || null,
        // Keep legacy `address` synced to billing so older readers
        // (auto-vendor spawn, etc.) keep working.
        address: billing,
        billing_address: billing,
        shipping_address: shipping,
        notes: notes.trim() || null,
      }
      if (mode === 'new') {
        const { data, error } = await supabase.from('wholesale_vendors').insert({ ...payload, created_by: actorId, updated_by: actorId }).select('*').single()
        if (error) throw new Error(error.message)
        await logAudit({ brand, entity_type: 'wholesale_vendor', entity_id: (data as any).id, action: 'created', after: payload, actor_id: actorId, actor_email: actorEmail })
      } else {
        const { error } = await supabase.from('wholesale_vendors').update({ ...payload, updated_by: actorId }).eq('id', id!)
        if (error) throw new Error(error.message)
        if (vendor) {
          const diff = diffFields(vendor as any, payload, ['company_name','contact_name','phone','mobile_phone','email','address','billing_address','shipping_address','notes'])
          if (diff) await logAudit({
            brand, entity_type: 'wholesale_vendor', entity_id: id!, action: 'updated',
            before: diff.before, after: diff.after, actor_id: actorId, actor_email: actorEmail,
          })
        }
      }
      onSaved()
    } catch (e: any) { setErr(e?.message || 'Save failed') }
    setBusy(false)
  }
  async function archive() {
    if (!id || !confirm(`Archive ${company_name}? Their existing inventory links stay intact.`)) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('wholesale_vendors').update({ archived_at: new Date().toISOString(), updated_by: actorId }).eq('id', id)
      if (error) throw new Error(error.message)
      await logAudit({ brand, entity_type: 'wholesale_vendor', entity_id: id, action: 'archived', actor_id: actorId, actor_email: actorEmail })
      onSaved()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  return (
    <Modal onClose={onClose} title={mode === 'new' ? 'New Vendor' : (vendor?.company_name || 'Vendor')}>
      <Section title="Vendor info">
        <Row>
          <Field label="Company name *"><input type="text" value={company_name} onChange={e => setCompanyName(e.target.value)} /></Field>
          <Field label="Contact name"><input type="text" value={contact_name} onChange={e => setContactName(e.target.value)} /></Field>
          <Field label="Phone"><PhoneInput value={phone} onChange={setPhone} /></Field>
          <Field label="Mobile"><PhoneInput value={mobile_phone} onChange={setMobilePhone} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        </Row>
        <Field label="Billing address">
          <AddressAutocompleteInput value={billing_address} onChange={setBillingAddress} placeholder="Start typing the bill-to address…" />
        </Field>
        <div style={{ marginTop: -2, marginBottom: 4 }}>
          <Checkbox
            checked={shippingSameAsBilling}
            onChange={(next) => {
              setShippingSameAsBilling(next)
              if (next) setShippingAddress(billing_address)
            }}
            label="Shipping address same as billing"
          />
        </div>
        {!shippingSameAsBilling && (
          <Field label="Shipping address">
            <AddressAutocompleteInput value={shipping_address} onChange={setShippingAddress} placeholder="Start typing the ship-to address…" />
          </Field>
        )}
        <Field label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
      </Section>

      {mode === 'edit' && items.length > 0 && (
        <Section title={`Purchase history (${items.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                  <td style={{ padding: 6, fontWeight: 700 }}>{it.item_number}</td>
                  <td style={{ padding: 6, color: 'var(--mist)' }}>{it.category}</td>
                  <td style={{ padding: 6 }}>{it.public_notes || '—'}</td>
                  <td style={{ padding: 6 }}>{fmtMoneyCents(it.cost_cents)}</td>
                  <td style={{ padding: 6, color: 'var(--mist)' }}>{fmtDate(it.date_acquired || it.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
        {mode === 'edit' ? <button onClick={archive} disabled={busy} className="btn-outline btn-sm">Archive</button> : <span />}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary btn-sm">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}
