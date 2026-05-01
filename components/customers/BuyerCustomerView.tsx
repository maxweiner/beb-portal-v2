'use client'

// Read-only customer list scoped to a single store, designed for
// buyer access during their event window. Pulled from the customer
// database via supabase RLS — Phase 1's customers_buyer_has_event_
// access policy returns rows only when today is in an event window
// the buyer is assigned to.
//
// Buyers can:
//   - Browse + search the list
//   - Open a customer detail panel (read-only core fields + notes)
//   - APPEND a new note via /api/customers/[id]/note (timestamped,
//     attributed). The existing notes column stays admin-only.
//
// Buyers cannot edit, delete, change tags, or export.
//
// Admins also see this view when embedded in the event detail tab —
// useful for spot-checking from the same surface buyers use.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerTagDefinition } from '@/lib/customers/types'
import { ENGAGEMENT_TIER_LABELS, ENGAGEMENT_TIER_COLORS } from '@/lib/customers/types'
import { fmtPhone, fmtAddress, fmtDateLong, fmtDateRel } from '@/lib/customers/format'

interface NoteEvent {
  id: string
  description: string | null
  actor_id: string | null
  created_at: string
}

export default function BuyerCustomerView({ storeId, storeName }: {
  storeId: string
  storeName: string
}) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tagDefs, setTagDefs] = useState<CustomerTagDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Customer | null>(null)

  async function reload() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase.from('customers')
      .select('*')
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .order('last_name').order('first_name')
    if (err) { setError(err.message); setCustomers([]) }
    else setCustomers((data ?? []) as Customer[])
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [storeId])

  useEffect(() => {
    let cancelled = false
    supabase.from('customer_tag_definitions').select('*').eq('is_archived', false)
      .then(({ data }) => { if (!cancelled) setTagDefs((data ?? []) as CustomerTagDefinition[]) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c => {
      const hay = [c.first_name, c.last_name, c.email, c.phone, c.city, c.zip]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [customers, search])

  if (loading) return <div style={{ padding: 16, color: 'var(--mist)', fontSize: 13 }}>Loading customers…</div>

  if (error) {
    return (
      <div style={{
        padding: 14, fontSize: 13,
        background: 'var(--red-pale)', color: '#7f1d1d',
        border: '1px solid #fecaca', borderRadius: 8,
      }}>{error}</div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, email, city, zip…"
          style={{ flex: 1, minWidth: 200, fontSize: 13 }} />
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          {filtered.length} of {customers.length}
        </span>
      </div>

      {customers.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--mist)', fontSize: 13, textAlign: 'center' }}>
          No customer records yet for {storeName}.
        </div>
      ) : (
        <div style={{
          maxHeight: 380, overflowY: 'auto',
          border: '1px solid var(--pearl)', borderRadius: 8,
        }}>
          {filtered.map((c, i) => {
            const tier = c.engagement_tier
            const tierColor = tier ? ENGAGEMENT_TIER_COLORS[tier] : null
            return (
              <button key={c.id} type="button" onClick={() => setPicked(c)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: '#fff', border: 'none',
                  padding: '10px 12px', cursor: 'pointer',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--cream2)' : 'none',
                  fontFamily: 'inherit',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      {c.last_name}, {c.first_name}
                      {c.do_not_contact && (
                        <span style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
                          background: 'var(--red-pale)', color: '#7f1d1d',
                          textTransform: 'uppercase', letterSpacing: '.05em',
                        }}>DNC</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 1 }}>
                      {[c.phone ? fmtPhone(c.phone) : null, c.email].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {tier && tierColor && (
                    <span style={{
                      flexShrink: 0, alignSelf: 'flex-start',
                      fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99,
                      background: tierColor.bg, color: tierColor.fg,
                      textTransform: 'uppercase', letterSpacing: '.05em',
                    }}>{ENGAGEMENT_TIER_LABELS[tier]}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {picked && (
        <CustomerReadOnlyDetail
          customer={picked}
          tagDefs={tagDefs}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}

function CustomerReadOnlyDetail({ customer, tagDefs, onClose }: {
  customer: Customer
  tagDefs: CustomerTagDefinition[]
  onClose: () => void
}) {
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState<NoteEvent[]>([])
  const [newNote, setNewNote] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('customer_tags').select('tag').eq('customer_id', customer.id),
      supabase.from('customer_events').select('id, description, actor_id, created_at')
        .eq('customer_id', customer.id).eq('event_type', 'note_added')
        .order('created_at', { ascending: false }).limit(20),
    ]).then(([t, n]) => {
      if (cancelled) return
      setTags(((t.data ?? []) as { tag: string }[]).map(r => r.tag))
      setNotes((n.data ?? []) as NoteEvent[])
    })
    return () => { cancelled = true }
  }, [customer.id])

  async function postNote() {
    const content = newNote.trim()
    if (!content) return
    setPosting(true); setError(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    try {
      const res = await fetch(`/api/customers/${customer.id}/note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setPosting(false); return }
      setNewNote('')
      // Refetch notes
      const { data: n } = await supabase.from('customer_events')
        .select('id, description, actor_id, created_at')
        .eq('customer_id', customer.id).eq('event_type', 'note_added')
        .order('created_at', { ascending: false }).limit(20)
      setNotes((n ?? []) as NoteEvent[])
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setPosting(false)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px', overflowY: 'auto',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 560, width: '100%', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ background: 'var(--sidebar-bg)', padding: '18px 22px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>Customer (read-only)</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>
              {customer.first_name} {customer.last_name}
              {customer.do_not_contact && (
                <span style={{ marginLeft: 8, fontSize: 11, color: '#fca5a5', fontWeight: 700 }}>● DNC</span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 30, height: 30, borderRadius: '50%', fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 12 }}>
            <ReadField label="Phone" value={customer.phone ? fmtPhone(customer.phone) : '—'} />
            <ReadField label="Email" value={customer.email || '—'} />
            <ReadField label="Address" value={fmtAddress(customer) || '—'} />
            <ReadField label="Last appt" value={customer.last_appointment_date ? fmtDateLong(customer.last_appointment_date) : '—'} />
            <ReadField label="Lifetime appts" value={String(customer.lifetime_appointment_count)} />
            {customer.notes && (
              <div style={{
                marginTop: 8, padding: '8px 10px',
                background: 'var(--cream2)', borderRadius: 6,
                fontSize: 12, color: 'var(--ink)', whiteSpace: 'pre-wrap',
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                  Buyer notes (admin)
                </div>
                {customer.notes}
              </div>
            )}
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {tags.map(t => {
                  const def = tagDefs.find(d => d.tag === t)
                  return (
                    <span key={t} style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: (def?.color || 'var(--green)') + '22',
                      color: def?.color || 'var(--green-dark)',
                    }}>{t}</span>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
              Add a note
            </div>
            {error && (
              <div style={{
                background: 'var(--red-pale)', color: '#7f1d1d',
                border: '1px solid #fecaca', borderRadius: 6,
                padding: '6px 10px', fontSize: 12, marginBottom: 8,
              }}>{error}</div>
            )}
            <textarea rows={3} value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="Anything worth recording about this customer…"
              style={{ width: '100%', fontSize: 13, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn-primary btn-sm" onClick={postNote}
                disabled={posting || !newNote.trim()}>
                {posting ? 'Saving…' : '+ Add note'}
              </button>
            </div>
            {notes.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--cream2)', paddingTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                  Recent notes
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {notes.map(n => (
                    <div key={n.id} style={{
                      padding: '6px 10px', background: 'var(--cream2)', borderRadius: 6,
                      fontSize: 12, color: 'var(--ink)',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--mist)', marginBottom: 2 }}>
                        {fmtDateRel(n.created_at)}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{n.description || ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
      <span style={{ color: 'var(--mist)', fontWeight: 600 }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{value}</span>
    </div>
  )
}
