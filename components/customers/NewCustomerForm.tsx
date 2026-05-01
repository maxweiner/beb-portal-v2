'use client'

// Modal form to manually create a new customer at a specific store.
// All fields except first/last name are optional — keeps the form
// fast for walk-ins captured at the buyer table.
//
// Phase 3 will wire the dedup matcher into this submit path so a
// candidate match either auto-merges or pushes to the review queue.
// Phase 2 just inserts; admin RLS gates write access.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HowDidYouHear } from '@/lib/customers/types'
import { HOW_DID_YOU_HEAR_LABELS } from '@/lib/customers/types'

const HOW_DID_YOU_HEAR_OPTIONS: HowDidYouHear[] = [
  'postcard', 'newspaper', 'word_of_mouth', 'walk_in',
  'online', 'referral', 'other',
]

export default function NewCustomerForm({ storeId, storeName, onClose, onCreated }: {
  storeId: string
  storeName: string
  onClose: () => void
  onCreated: () => void
}) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [addr1, setAddr1] = useState('')
  const [addr2, setAddr2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [dob, setDob] = useState('')
  const [howHeard, setHowHeard] = useState<HowDidYouHear | ''>('')
  const [howHeardOther, setHowHeardOther] = useState('')
  const [notes, setNotes] = useState('')
  const [dnc, setDnc] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!first.trim() || !last.trim()) {
      setError('First and last name are required.')
      return
    }
    setBusy(true); setError(null)
    const payload = {
      store_id: storeId,
      first_name: first.trim(),
      last_name: last.trim(),
      address_line_1: addr1.trim() || null,
      address_line_2: addr2.trim() || null,
      city: city.trim() || null,
      state: state.trim().toUpperCase() || null,
      zip: zip.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      date_of_birth: dob || null,
      how_did_you_hear: howHeard || null,
      how_did_you_hear_other_text: howHeard === 'other' ? howHeardOther.trim() || null : null,
      notes: notes.trim() || null,
      do_not_contact: dnc,
    }
    const { error: err } = await supabase.from('customers').insert(payload)
    setBusy(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        zIndex: 1000, overflowY: 'auto',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--cream)', borderRadius: 'var(--r2)',
          maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-lg)',
        }}>
        {/* Dark header */}
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>New customer</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{storeName}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{
              background: 'var(--red-pale)', color: '#7f1d1d',
              border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">First name *</label>
              <input value={first} onChange={e => setFirst(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Last name *</label>
              <input value={last} onChange={e => setLast(e.target.value)} />
            </div>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Address line 1</label>
            <input value={addr1} onChange={e => setAddr1(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Address line 2</label>
            <input value={addr2} onChange={e => setAddr2(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">City</label>
              <input value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">State</label>
              <input value={state} onChange={e => setState(e.target.value)} maxLength={2} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Zip</label>
              <input value={zip} onChange={e => setZip(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(602) 555-1234" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Date of birth</label>
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">How did you hear?</label>
              <select value={howHeard} onChange={e => setHowHeard(e.target.value as HowDidYouHear | '')}>
                <option value="">— choose —</option>
                {HOW_DID_YOU_HEAR_OPTIONS.map(v => (
                  <option key={v} value={v}>{HOW_DID_YOU_HEAR_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>

          {howHeard === 'other' && (
            <div className="field" style={{ margin: 0 }}>
              <label className="fl">Specify "other"</label>
              <input value={howHeardOther} onChange={e => setHowHeardOther(e.target.value)} />
            </div>
          )}

          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Notes</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
            <input type="checkbox" checked={dnc} onChange={e => setDnc(e.target.checked)}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
            <span aria-hidden style={{
              width: 18, height: 18, flexShrink: 0, borderRadius: 4,
              border: `2px solid ${dnc ? 'var(--red)' : 'var(--pearl)'}`,
              background: dnc ? 'var(--red)' : '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
            }}>{dnc ? '✓' : ''}</span>
            Do not contact (DNC) — this customer is excluded from every mailing
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={submit} disabled={busy || !first.trim() || !last.trim()}>
              {busy ? 'Saving…' : 'Create customer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
