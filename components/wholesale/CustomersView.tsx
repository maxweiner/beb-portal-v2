'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { WholesaleCustomer, WholesaleInvoice, WholesaleMemo } from '@/types/wholesale'
import { fmtDate, fmtMoneyCents, dollarsToCents, centsToDollarsString } from '@/lib/wholesale/format'
import { logAudit, diffFields } from '@/lib/wholesale/audit'
import { loadAdminList } from '@/lib/wholesale/lists'
import { Modal, Section, Row, Field, Select } from './InventoryView'
import AddressAutocompleteInput from '@/components/ui/AddressAutocompleteInput'
import BusinessAutocompleteInput, { type BusinessPickResult } from '@/components/ui/BusinessAutocompleteInput'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'
import { formatPhoneDisplay } from '@/lib/phone'

export default function CustomersView() {
  const { user, brand } = useApp()
  const [customers, setCustomers] = useState<WholesaleCustomer[] | null>(null)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    if (!brand) return
    setErr(null)
    try {
      const { data, error } = await supabase.from('wholesale_customers').select('*')
        .eq('brand', brand).is('archived_at', null).order('company_name')
      if (error) throw new Error(error.message)
      setCustomers((data || []) as WholesaleCustomer[])
    } catch (e: any) { setErr(e?.message || 'Failed to load'); setCustomers([]) }
  }
  useEffect(() => { void reload() }, [brand])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers || []
    return (customers || []).filter(c => (
      [c.company_name, c.contact_name, c.email, c.phone, c.resale_certificate_number].filter(Boolean).join(' ').toLowerCase().includes(q)
    ))
  }, [customers, search])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customer name, contact, resale cert…"
          style={{ flex: '1 1 240px', maxWidth: 360, fontSize: 12, padding: '6px 10px' }} />
        <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New Customer</button>
      </div>
      {err && <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{err}</div>}
      {customers === null ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        : filtered.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No customers yet.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--cream2)' }}>
                {['Company','Contact','Phone','Email','Terms','Credit',''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{c.company_name}</td>
                    <td style={{ padding: '8px 10px' }}>{c.contact_name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{c.phone ? formatPhoneDisplay(c.phone) : '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{c.email || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{c.default_payment_terms || '—'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{c.credit_balance_cents > 0 ? fmtMoneyCents(c.credit_balance_cents) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showNew && <CustomerModal mode="new" brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); void reload() }} />}
      {openId && <CustomerModal mode="edit" id={openId} brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void reload() }} />}
    </div>
  )
}

function CustomerModal({
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
  const [customer, setCustomer] = useState<WholesaleCustomer | null>(null)
  const [memos, setMemos] = useState<WholesaleMemo[]>([])
  const [invoices, setInvoices] = useState<WholesaleInvoice[]>([])
  const [paymentTerms, setPaymentTerms] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [company_name, setCompanyName] = useState('')
  const [contact_name, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [mobile_phone, setMobilePhone] = useState('')
  const [email, setEmail] = useState('')
  // Address: bill-to and ship-to held separately. `sameAsBilling`
  // hides the ship-to input + mirrors billing into shipping on save —
  // most B2B customers really do share one address, so the default
  // collapsed state keeps the form light.
  const [billing_address, setBillingAddress] = useState('')
  const [shipping_address, setShippingAddress] = useState('')
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true)
  const [resale_cert, setResaleCert] = useState('')
  // New customers default to Net 30 if no payment_terms list pick;
  // edit modal preserves whatever the customer already has.
  const [default_terms, setDefaultTerms] = useState(mode === 'new' ? 'Net 30' : '')
  const [notes, setNotes] = useState('')
  const [credit, setCredit] = useState('')

  useEffect(() => {
    void loadAdminList(brand, 'payment_terms').then(setPaymentTerms)
  }, [brand])

  useEffect(() => {
    if (mode === 'new') return
    let cancelled = false
    void (async () => {
      const { data } = await supabase.from('wholesale_customers').select('*').eq('id', id!).maybeSingle()
      if (cancelled) return
      const c = data as WholesaleCustomer | null
      setCustomer(c); if (c) {
        setCompanyName(c.company_name); setContactName(c.contact_name || '')
        setPhone(c.phone || ''); setMobilePhone(c.mobile_phone || '')
        setEmail(c.email || '')
        // Prefer the new columns; fall back to legacy `address` for
        // rows the user hasn't re-saved since the split migration.
        const billing  = c.billing_address  ?? c.address ?? ''
        const shipping = c.shipping_address ?? c.address ?? ''
        setBillingAddress(billing)
        setShippingAddress(shipping)
        // If shipping is empty or matches billing, default to the
        // collapsed "same as billing" view. Anything else = explicit
        // separate address, leave it expanded.
        setShippingSameAsBilling(!shipping || shipping === billing)
        setResaleCert(c.resale_certificate_number || ''); setDefaultTerms(c.default_payment_terms || '')
        setNotes(c.notes || '')
        setCredit(centsToDollarsString(c.credit_balance_cents))
      }
      const [memosRes, invRes] = await Promise.all([
        supabase.from('wholesale_memos').select('*').eq('customer_id', id!).order('date_created', { ascending: false }).limit(20),
        supabase.from('wholesale_invoices').select('*').eq('customer_id', id!).order('invoice_date', { ascending: false }).limit(20),
      ])
      if (!cancelled) {
        setMemos((memosRes.data || []) as WholesaleMemo[])
        setInvoices((invRes.data || []) as WholesaleInvoice[])
      }
    })()
    return () => { cancelled = true }
  }, [id, mode])

  async function save() {
    if (!company_name.trim()) { setErr('Company name is required'); return }
    setBusy(true); setErr(null)
    try {
      const creditCents = dollarsToCents(credit) ?? 0
      const billing  = billing_address.trim() || null
      const shipping = shippingSameAsBilling ? billing : (shipping_address.trim() || null)
      const payload = {
        brand, company_name: company_name.trim(),
        contact_name: contact_name.trim() || null,
        phone: phone.trim() || null,
        mobile_phone: mobile_phone.trim() || null,
        email: email.trim() || null,
        // Keep legacy `address` synced to billing so older PDF /
        // auto-customer-spawn paths that still read it keep working.
        address: billing,
        billing_address: billing,
        shipping_address: shipping,
        resale_certificate_number: resale_cert.trim() || null,
        default_payment_terms: default_terms || 'Net 30',
        credit_balance_cents: creditCents,
        notes: notes.trim() || null,
      }
      if (mode === 'new') {
        const { data, error } = await supabase.from('wholesale_customers').insert({ ...payload, created_by: actorId, updated_by: actorId }).select('*').single()
        if (error) throw new Error(error.message)
        await logAudit({ brand, entity_type: 'wholesale_customer', entity_id: (data as any).id, action: 'created', after: payload, actor_id: actorId, actor_email: actorEmail })
      } else {
        const { error } = await supabase.from('wholesale_customers').update({ ...payload, updated_by: actorId }).eq('id', id!)
        if (error) throw new Error(error.message)
        if (customer) {
          const diff = diffFields(customer as any, payload, ['company_name','contact_name','phone','mobile_phone','email','address','billing_address','shipping_address','resale_certificate_number','default_payment_terms','credit_balance_cents','notes'])
          if (diff) await logAudit({
            brand, entity_type: 'wholesale_customer', entity_id: id!, action: 'updated',
            before: diff.before, after: diff.after, actor_id: actorId, actor_email: actorEmail,
          })
        }
      }
      onSaved()
    } catch (e: any) { setErr(e?.message || 'Save failed') }
    setBusy(false)
  }
  async function archive() {
    if (!id || !confirm(`Archive ${company_name}?`)) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('wholesale_customers').update({ archived_at: new Date().toISOString(), updated_by: actorId }).eq('id', id)
      if (error) throw new Error(error.message)
      await logAudit({ brand, entity_type: 'wholesale_customer', entity_id: id, action: 'archived', actor_id: actorId, actor_email: actorEmail })
      onSaved()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  return (
    <Modal onClose={onClose} title={mode === 'new' ? 'New Customer' : (customer?.company_name || 'Customer')} wide>
      <Section title="Customer info">
        <Row>
          <Field label="Company name *">
            <BusinessAutocompleteInput
              value={company_name}
              onChange={setCompanyName}
              onPick={(pick: BusinessPickResult) => {
                // Fill-if-empty: never overwrite manually-typed data.
                // Picking the same business twice on a partially-filled
                // form leaves the user's edits alone.
                if (pick.phone && !phone.trim()) setPhone(pick.phone)
                if (pick.address && !billing_address.trim()) {
                  setBillingAddress(pick.address)
                  if (shippingSameAsBilling) setShippingAddress(pick.address)
                }
              }}
              placeholder="Search Google for the business name…"
            />
          </Field>
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
              // When the user collapses the ship-to field, mirror
              // billing into the state so the value the form will
              // save matches what's visible. Avoids a stale ship-to
              // sticking around hidden.
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
        <Row>
          <Field label="Resale cert #"><input type="text" value={resale_cert} onChange={e => setResaleCert(e.target.value)} /></Field>
          <Field label="Default payment terms">
            <Select value={default_terms} onChange={setDefaultTerms}>
              <option value="">—</option>
              {paymentTerms.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Credit balance ($)">
            <input
              type="text"
              inputMode="decimal"
              value={credit}
              onChange={e => setCredit(e.target.value)}
              onBlur={e => {
                // Format to "1,234.56" on blur. dollarsToCents already strips
                // commas / $ on save so this is a display-only refinement.
                const n = Number.parseFloat(e.target.value.replace(/[$,\s]/g, ''))
                if (Number.isFinite(n)) {
                  setCredit(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                }
              }}
              placeholder="0.00"
            />
          </Field>
        </Row>
        <Field label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
      </Section>

      {mode === 'edit' && (memos.length > 0 || invoices.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Section title={`Recent memos (${memos.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {memos.map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: 6, fontWeight: 700 }}>{m.memo_number}</td>
                    <td style={{ padding: 6, color: 'var(--mist)' }}>{m.status}</td>
                    <td style={{ padding: 6, color: 'var(--mist)' }}>{fmtDate(m.date_created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title={`Recent invoices (${invoices.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: 6, fontWeight: 700 }}>{inv.invoice_number}</td>
                    <td style={{ padding: 6 }}>{fmtMoneyCents(inv.total_due_cents)}</td>
                    <td style={{ padding: 6, color: 'var(--mist)' }}>{inv.payment_status}</td>
                    <td style={{ padding: 6, color: 'var(--mist)' }}>{fmtDate(inv.invoice_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
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
