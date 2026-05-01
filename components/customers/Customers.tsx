'use client'

// Customers module — entry point. Lists customers per store with
// filters, opens a detail modal on click, surfaces a trash view for
// admins to restore / hard-delete soft-deleted records, and a new-
// customer form for manual entry.
//
// Phase 2 of the Customers initiative. Phase 3 adds the import +
// dedup tooling; Phase 6 adds marketing filters / postcard export.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerTagDefinition, EngagementTier } from '@/lib/customers/types'
import { ENGAGEMENT_TIER_LABELS, ENGAGEMENT_TIER_COLORS } from '@/lib/customers/types'
import { fmtPhone, fmtDateLong, fmtDateRel } from '@/lib/customers/format'
import CustomerDetail from './CustomerDetail'
import NewCustomerForm from './NewCustomerForm'
import CustomerTrash from './CustomerTrash'
import ImportTool from './ImportTool'
import DedupReview from './DedupReview'

type Tab = 'list' | 'import' | 'dedup' | 'trash'

export default function Customers() {
  const { user, stores } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [tab, setTab] = useState<Tab>('list')
  const [storeId, setStoreId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<EngagementTier | ''>('')
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [tagDefs, setTagDefs] = useState<CustomerTagDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Default-pick the first store the moment we have any.
  useEffect(() => {
    if (!storeId && stores.length > 0) setStoreId(stores[0].id)
  }, [stores, storeId])

  // Tag definitions used everywhere — load once.
  useEffect(() => {
    let cancelled = false
    supabase.from('customer_tag_definitions')
      .select('*').eq('is_archived', false).order('tag')
      .then(({ data }) => { if (!cancelled) setTagDefs((data ?? []) as CustomerTagDefinition[]) })
    return () => { cancelled = true }
  }, [])

  // Customers list — refetched when store / tab changes.
  async function reload() {
    if (!storeId) { setCustomers([]); setLoading(false); return }
    setLoading(true); setError(null)
    let q = supabase.from('customers').select('*').eq('store_id', storeId).order('last_name').order('first_name')
    if (tab === 'trash') q = q.not('deleted_at', 'is', null)
    else q = q.is('deleted_at', null)
    const { data, error: err } = await q
    if (err) { setError(err.message); setCustomers([]) }
    else setCustomers((data ?? []) as Customer[])
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [storeId, tab])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter(c => {
      if (tierFilter && c.engagement_tier !== tierFilter) return false
      if (!q) return true
      const hay = [
        c.first_name, c.last_name, c.email, c.phone,
        c.city, c.zip,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [customers, search, tierFilter])

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Customers — admin only</div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
            Buyer access lands in Phase 7 of this initiative — gated to active event windows.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>👥 Customers</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Per-store customer database. Manage records, tags, and (Phase 6) marketing exports.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['list', 'import', 'dedup', 'trash'] as const).map(t => {
          const active = tab === t
          const label = t === 'list' ? 'All Customers'
                      : t === 'import' ? '📥 Import'
                      : t === 'dedup' ? '⚖️ Dedup Review'
                      : '🗑️ Trash'
          return (
            <button key={t} onClick={() => setTab(t)} className={active ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}>
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'list' && (
        <>
          {/* Filter bar */}
          <div className="card" style={{ padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label className="fl">Store</label>
              <select value={storeId} onChange={e => setStoreId(e.target.value)}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Search (name, email, phone, city, zip)</label>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Type to filter…" />
            </div>
            <div>
              <label className="fl">Engagement</label>
              <select value={tierFilter} onChange={e => setTierFilter(e.target.value as EngagementTier | '')}>
                <option value="">All tiers</option>
                <option value="active">Active</option>
                <option value="lapsed">Lapsed</option>
                <option value="cold">Cold</option>
                <option value="vip">VIP</option>
              </select>
            </div>
            <button className="btn-primary btn-sm" onClick={() => setShowNew(true)}>
              + New customer
            </button>
          </div>

          {error && (
            <div style={{
              background: 'var(--red-pale)', color: '#7f1d1d',
              border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', marginBottom: 14, fontSize: 13,
            }}>{error}</div>
          )}

          {loading ? (
            <div className="card" style={{ padding: 24, color: 'var(--mist)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: 24, color: 'var(--mist)', textAlign: 'center' }}>
              {customers.length === 0
                ? 'No customers yet for this store. Click "+ New customer" or use the import tool (Phase 3) to bulk-add.'
                : 'No matches.'}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--cream2)' }}>
                    <th style={th}>Name</th>
                    <th style={th}>Phone</th>
                    <th style={th}>Email</th>
                    <th style={th}>City</th>
                    <th style={th}>Last appt</th>
                    <th style={th}>Tier</th>
                    <th style={th}>Tags</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const tier = c.engagement_tier
                    const tierColor = tier ? ENGAGEMENT_TIER_COLORS[tier] : null
                    return (
                      <tr key={c.id} onClick={() => setSelected(c)}
                        style={{ cursor: 'pointer', borderTop: '1px solid var(--cream2)' }}
                        onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream)'}
                        onMouseOut={e => (e.currentTarget as HTMLElement).style.background = ''}>
                        <td style={td}>
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{c.last_name}, {c.first_name}</span>
                          {c.do_not_contact && (
                            <span title="Do not contact" style={{
                              marginLeft: 6, fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
                              background: 'var(--red-pale)', color: '#7f1d1d', textTransform: 'uppercase', letterSpacing: '.05em',
                            }}>DNC</span>
                          )}
                        </td>
                        <td style={td}>{fmtPhone(c.phone)}</td>
                        <td style={td}>{c.email || ''}</td>
                        <td style={td}>{c.city || ''}</td>
                        <td style={td}>
                          {c.last_appointment_date
                            ? <span title={fmtDateLong(c.last_appointment_date)}>{fmtDateRel(c.last_appointment_date)}</span>
                            : <span style={{ color: 'var(--mist)' }}>—</span>}
                        </td>
                        <td style={td}>
                          {tier && tierColor && (
                            <span style={{
                              display: 'inline-block', fontSize: 10, fontWeight: 800,
                              padding: '2px 8px', borderRadius: 99,
                              background: tierColor.bg, color: tierColor.fg,
                              textTransform: 'uppercase', letterSpacing: '.05em',
                            }}>{ENGAGEMENT_TIER_LABELS[tier]}</span>
                          )}
                        </td>
                        <td style={td}>
                          <CustomerTagChips customerId={c.id} tagDefs={tagDefs} />
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: 11, color: 'var(--mist)' }}>›</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)' }}>
            {filtered.length} of {customers.length} customer{customers.length === 1 ? '' : 's'} shown.
          </div>
        </>
      )}

      {tab === 'import' && (
        <ImportTool stores={stores} storeId={storeId} setStoreId={setStoreId} onImported={reload} />
      )}

      {tab === 'dedup' && (
        <DedupReview storeId={storeId} />
      )}

      {tab === 'trash' && (
        <CustomerTrash storeId={storeId} stores={stores} setStoreId={setStoreId}
          customers={customers} loading={loading} onChanged={reload} />
      )}

      {selected && (
        <CustomerDetail
          customer={selected}
          tagDefs={tagDefs}
          storeName={stores.find(s => s.id === selected.store_id)?.name || ''}
          onClose={() => setSelected(null)}
          onChanged={() => { reload(); setSelected(null) }}
        />
      )}

      {showNew && storeId && (
        <NewCustomerForm
          storeId={storeId}
          storeName={stores.find(s => s.id === storeId)?.name || ''}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); reload() }}
        />
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '10px 12px', fontSize: 11, fontWeight: 800,
  color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em',
  textAlign: 'left',
}
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: 'var(--ink)',
}

/** Inline chip strip for the list view — fetches tags lazily per row.
 *  Cheap because most customers have 0-2 tags. */
function CustomerTagChips({ customerId, tagDefs }: {
  customerId: string
  tagDefs: CustomerTagDefinition[]
}) {
  const [tags, setTags] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    supabase.from('customer_tags').select('tag').eq('customer_id', customerId)
      .then(({ data }) => { if (!cancelled) setTags(((data ?? []) as { tag: string }[]).map(r => r.tag)) })
    return () => { cancelled = true }
  }, [customerId])
  if (tags.length === 0) return <span style={{ color: 'var(--mist)' }}>—</span>
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {tags.slice(0, 3).map(t => {
        const def = tagDefs.find(d => d.tag === t)
        return (
          <span key={t} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: (def?.color || 'var(--green)') + '22',
            color: def?.color || 'var(--green-dark)',
          }}>{t}</span>
        )
      })}
      {tags.length > 3 && (
        <span style={{ fontSize: 10, color: 'var(--mist)' }}>+{tags.length - 3}</span>
      )}
    </div>
  )
}
