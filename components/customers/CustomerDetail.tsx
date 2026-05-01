'use client'

// Customer detail modal — full editable record, tag toggle, soft
// delete. Phase 5 will add the timeline (appointments + mailings +
// audit log). Phase 7 layers in buyer-can-append-notes via a
// narrower API path; admin always sees full edit here.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerTagDefinition, HowDidYouHear } from '@/lib/customers/types'
import { HOW_DID_YOU_HEAR_LABELS, ENGAGEMENT_TIER_LABELS, ENGAGEMENT_TIER_COLORS } from '@/lib/customers/types'
import { fmtPhone, fmtDateLong } from '@/lib/customers/format'

const HOW_DID_YOU_HEAR_OPTIONS: HowDidYouHear[] = [
  'postcard', 'newspaper', 'word_of_mouth', 'walk_in',
  'online', 'referral', 'other',
]

export default function CustomerDetail({ customer, tagDefs, storeName, onClose, onChanged }: {
  customer: Customer
  tagDefs: CustomerTagDefinition[]
  storeName: string
  onClose: () => void
  onChanged: () => void
}) {
  // Local edit copy; saved on Save click.
  const [draft, setDraft] = useState<Customer>(customer)
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [busyTag, setBusyTag] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('customer_tags').select('tag').eq('customer_id', customer.id)
      .then(({ data }) => {
        if (cancelled) return
        setTags(((data ?? []) as { tag: string }[]).map(r => r.tag))
      })
    return () => { cancelled = true }
  }, [customer.id])

  function patch<K extends keyof Customer>(key: K, value: Customer[K]) {
    setDraft(p => ({ ...p, [key]: value }))
  }

  async function save() {
    setBusy(true); setError(null)
    const payload: Partial<Customer> = {
      first_name: draft.first_name?.trim() || customer.first_name,
      last_name: draft.last_name?.trim() || customer.last_name,
      address_line_1: draft.address_line_1?.trim() || null,
      address_line_2: draft.address_line_2?.trim() || null,
      city: draft.city?.trim() || null,
      state: draft.state?.trim().toUpperCase() || null,
      zip: draft.zip?.trim() || null,
      phone: draft.phone?.trim() || null,
      email: draft.email?.trim() || null,
      date_of_birth: draft.date_of_birth || null,
      how_did_you_hear: draft.how_did_you_hear,
      how_did_you_hear_other_text: draft.how_did_you_hear === 'other'
        ? (draft.how_did_you_hear_other_text?.trim() || null)
        : null,
      notes: draft.notes?.trim() || null,
      do_not_contact: draft.do_not_contact,
      vip_override: draft.vip_override,
    }
    const { error: err } = await supabase.from('customers').update(payload).eq('id', customer.id)
    setBusy(false)
    if (err) { setError(err.message); return }
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(null), 1800)
  }

  async function softDelete() {
    if (!confirm(`Delete ${draft.first_name} ${draft.last_name}? This is reversible from the Trash tab for 30 days.`)) return
    setBusy(true); setError(null)
    const { error: err } = await supabase.from('customers')
      .update({ deleted_at: new Date().toISOString() }).eq('id', customer.id)
    setBusy(false)
    if (err) { setError(err.message); return }
    onChanged()
  }

  async function toggleTag(tag: string) {
    setBusyTag(tag); setError(null)
    const has = tags.includes(tag)
    // Optimistic
    setTags(prev => has ? prev.filter(t => t !== tag) : [...prev, tag])
    const { error: err } = has
      ? await supabase.from('customer_tags').delete().eq('customer_id', customer.id).eq('tag', tag)
      : await supabase.from('customer_tags').insert({ customer_id: customer.id, tag })
    setBusyTag(null)
    if (err) {
      setError(`Tag ${has ? 'remove' : 'add'} failed: ${err.message}`)
      // Rollback
      setTags(prev => has ? [...prev, tag] : prev.filter(t => t !== tag))
    }
  }

  const tier = customer.engagement_tier
  const tierColor = tier ? ENGAGEMENT_TIER_COLORS[tier] : null

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
          maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-lg)',
        }}>

        {/* Dark header */}
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              👥 Customer · {storeName}
            </div>
            <div style={{ color: '#fff', fontSize: 20, fontWeight: 900, marginTop: 2 }}>
              {draft.first_name} {draft.last_name}
            </div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, marginTop: 2 }}>
              {draft.do_not_contact && <span style={{ color: '#fca5a5', fontWeight: 700, marginRight: 8 }}>● DNC</span>}
              {tier && tierColor && (
                <span style={{
                  display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px',
                  borderRadius: 99, background: tierColor.bg, color: tierColor.fg,
                  textTransform: 'uppercase', letterSpacing: '.05em',
                }}>{ENGAGEMENT_TIER_LABELS[tier]}</span>
              )}
              <span style={{ marginLeft: 10 }}>
                {customer.lifetime_appointment_count} appt{customer.lifetime_appointment_count === 1 ? '' : 's'}
                {customer.last_appointment_date && ` · last ${fmtDateLong(customer.last_appointment_date)}`}
              </span>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{
              background: 'var(--red-pale)', color: '#7f1d1d',
              border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', fontSize: 13,
            }}>{error}</div>
          )}

          {/* Editable core fields */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Profile</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="First name"><input value={draft.first_name} onChange={e => patch('first_name', e.target.value)} /></Field>
              <Field label="Last name"><input value={draft.last_name} onChange={e => patch('last_name', e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 8 }}>
              <Field label="Address line 1"><input value={draft.address_line_1 || ''} onChange={e => patch('address_line_1', e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 8 }}>
              <Field label="Address line 2"><input value={draft.address_line_2 || ''} onChange={e => patch('address_line_2', e.target.value)} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginTop: 8 }}>
              <Field label="City"><input value={draft.city || ''} onChange={e => patch('city', e.target.value)} /></Field>
              <Field label="State"><input value={draft.state || ''} maxLength={2} onChange={e => patch('state', e.target.value)} /></Field>
              <Field label="Zip"><input value={draft.zip || ''} onChange={e => patch('zip', e.target.value)} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              <Field label="Phone"><input value={draft.phone || ''} onChange={e => patch('phone', e.target.value)} placeholder="(602) 555-1234" /></Field>
              <Field label="Email"><input type="email" value={draft.email || ''} onChange={e => patch('email', e.target.value)} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              <Field label="Date of birth"><input type="date" value={draft.date_of_birth || ''} onChange={e => patch('date_of_birth', e.target.value)} /></Field>
              <Field label="How did you hear?">
                <select value={draft.how_did_you_hear || ''} onChange={e => patch('how_did_you_hear', (e.target.value || null) as HowDidYouHear | null)}>
                  <option value="">— none —</option>
                  {HOW_DID_YOU_HEAR_OPTIONS.map(v => (
                    <option key={v} value={v}>{HOW_DID_YOU_HEAR_LABELS[v]}</option>
                  ))}
                </select>
              </Field>
            </div>
            {draft.how_did_you_hear === 'other' && (
              <div style={{ marginTop: 8 }}>
                <Field label='Specify "other"'>
                  <input value={draft.how_did_you_hear_other_text || ''}
                    onChange={e => patch('how_did_you_hear_other_text', e.target.value)} />
                </Field>
              </div>
            )}
            {customer.how_did_you_hear_legacy && (
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: 'var(--cream2)', borderRadius: 6,
                fontSize: 11, color: 'var(--ash)',
              }}>
                <strong>Imported source (read-only):</strong> {customer.how_did_you_hear_legacy}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <Field label="Notes"><textarea rows={3} value={draft.notes || ''} onChange={e => patch('notes', e.target.value)} /></Field>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.do_not_contact} onChange={e => patch('do_not_contact', e.target.checked)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
              <span aria-hidden style={{
                width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                border: `2px solid ${draft.do_not_contact ? 'var(--red)' : 'var(--pearl)'}`,
                background: draft.do_not_contact ? 'var(--red)' : '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
              }}>{draft.do_not_contact ? '✓' : ''}</span>
              Do not contact (DNC)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.vip_override} onChange={e => patch('vip_override', e.target.checked)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
              <span aria-hidden style={{
                width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                border: `2px solid ${draft.vip_override ? '#C9A84C' : 'var(--pearl)'}`,
                background: draft.vip_override ? '#C9A84C' : '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
              }}>{draft.vip_override ? '✓' : ''}</span>
              VIP — overrides the engagement tier
            </label>
          </div>

          {/* Tags */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tagDefs.map(def => {
                const has = tags.includes(def.tag)
                const busy = busyTag === def.tag
                return (
                  <button key={def.id} type="button" onClick={() => toggleTag(def.tag)} disabled={busy}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '4px 10px',
                      borderRadius: 99,
                      border: `1.5px solid ${has ? def.color : 'var(--pearl)'}`,
                      background: has ? def.color + '22' : '#fff',
                      color: has ? def.color : 'var(--mist)',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}>
                    {has ? '✓ ' : ''}{def.tag}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Mailing history placeholder */}
          <div className="card" style={{ padding: 14, color: 'var(--mist)', fontSize: 12, fontStyle: 'italic' }}>
            Mailing history + appointment timeline appear here in Phase 5.
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 8, borderTop: '1px solid var(--pearl)' }}>
            <button className="btn-danger btn-sm" onClick={softDelete} disabled={busy}>
              Delete (move to trash)
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {savedAt && (
                <span style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 700 }}>✓ Saved</span>
              )}
              <button className="btn-outline btn-sm" onClick={onClose}>Close</button>
              <button className="btn-primary btn-sm" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ margin: 0 }}>
      <label className="fl">{label}</label>
      {children}
    </div>
  )
}
