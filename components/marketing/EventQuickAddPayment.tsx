'use client'

// Quick add a marketing_payments row from the event row's toolbar.
// Slimmer than PaymentForm in PaymentsTab: event_id is fixed, no
// edit / delete, and we close on save.
//
// Cost is required; "Mark as paid now" is an opt-in toggle so you
// can record an invoice you haven't paid yet.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import Checkbox from '@/components/ui/Checkbox'

interface LookupRow { id: string; label: string }

export default function EventQuickAddPayment({
  eventId,
  storeId,
  onClose,
  onSaved,
}: {
  eventId: string
  storeId: string
  onClose: () => void
  onSaved?: () => void
}) {
  const { user } = useApp()
  const [types, setTypes] = useState<LookupRow[]>([])
  const [methods, setMethods] = useState<LookupRow[]>([])
  const [qrOptions, setQrOptions] = useState<LookupRow[]>([])

  const [typeId, setTypeId] = useState('')
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [markPaid, setMarkPaid] = useState(false)
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [methodId, setMethodId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [invoice, setInvoice] = useState('')
  const [qrCodeId, setQrCodeId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('marketing_payment_types').select('id, label').eq('active', true).order('sort_order'),
      supabase.from('marketing_payment_methods').select('id, label').eq('active', true).order('sort_order'),
      supabase.from('qr_codes').select('id, label').eq('store_id', storeId).is('deleted_at', null).eq('active', true).order('label'),
    ]).then(([t, m, q]) => {
      if (cancelled) return
      const ts = (t.data || []) as LookupRow[]
      const ms = (m.data || []) as LookupRow[]
      setTypes(ts)
      setMethods(ms)
      setQrOptions((q.data || []) as LookupRow[])
      setTypeId(prev => prev || ts[0]?.id || '')
      setMethodId(prev => prev || ms.find(x => x.label !== 'Legacy / Unknown')?.id || ms[0]?.id || '')
    })
    return () => { cancelled = true }
  }, [storeId])

  const amountNum = Number(amount) || 0
  const qtyNum = quantity ? Number(quantity) : null
  const cpp = qtyNum && qtyNum > 0 ? amountNum / qtyNum : null
  const canSave = !!typeId && !!vendor.trim() && amountNum > 0 && !!incurredAt && !saving
    && (!markPaid || (!!paidAt && !!methodId))

  async function save() {
    if (!canSave) return
    setSaving(true)
    const { error } = await supabase.from('marketing_payments').insert({
      event_id: eventId,
      store_id: storeId,
      type_id: typeId,
      vendor: vendor.trim(),
      amount: amountNum,
      incurred_at: incurredAt,
      paid_at: markPaid ? paidAt : null,
      payment_method_id: markPaid ? methodId : null,
      quantity: qtyNum,
      invoice_number: invoice.trim() || null,
      notes: notes.trim() || null,
      qr_code_id: qrCodeId || null,
      created_by: user?.id,
    })
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    onSaved?.()
    onClose()
  }

  return (
    <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="fl" style={{ margin: 0 }}>Add ad-spend cost</div>
        <button className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Type *</label>
        <select value={typeId} onChange={e => setTypeId(e.target.value)} style={inp}>
          {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Vendor *</label>
        <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. PrintCo, Philadelphia Inquirer" style={inp} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 4 }}>
        <div>
          <label style={lbl}>Amount *</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
            <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 18 }} />
          </div>
        </div>
        <div>
          <label style={lbl}>Date incurred *</label>
          <input type="date" value={incurredAt} onChange={e => setIncurredAt(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Quantity</label>
          <input type="number" min={0} value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="—" style={inp} />
        </div>
      </div>
      {cpp != null && (
        <div style={{ fontSize: 12, color: 'var(--mist)', margin: '0 0 10px' }}>
          Cost per piece: <strong style={{ color: 'var(--green-dark)' }}>${cpp.toFixed(2)}</strong>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={lbl}>Invoice #</label>
          <input value={invoice} onChange={e => setInvoice(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Linked QR (optional)</label>
          <select value={qrCodeId} onChange={e => setQrCodeId(e.target.value)} style={inp}>
            <option value="">— none —</option>
            {qrOptions.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Notes</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, resize: 'vertical' }} />
      </div>

      {/* Mark-as-paid toggle + fields */}
      <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginBottom: 12 }}>
        <Checkbox
          checked={markPaid}
          onChange={setMarkPaid}
          label={<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Mark as paid now</span>}
        />
        {markPaid && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label style={lbl}>Date paid *</label>
              <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Payment method *</label>
              <select value={methodId} onChange={e => setMethodId(e.target.value)} style={inp}>
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
        )}
        {!markPaid && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
            Leave unchecked to record this cost as unpaid. You can mark it paid later from the Marketing → Payments tab.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn-primary btn-sm" disabled={!canSave} onClick={save}>
          {saving ? 'Saving…' : 'Add cost'}
        </button>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', fontSize: 14 }
