'use client'

// Marketing Export — filter UI for the postcard / VDP recipient
// list. Replaces the legacy "upload a CSV per event" flow at
// the data-source level (the existing PostcardPlanningSection
// will switch over in a follow-up phase; this tab is the
// standalone export tool).
//
// All-on suppressions enforced server-side: do_not_contact + soft-
// deleted are always excluded.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'
import type { CustomerTagDefinition, EngagementTier, HowDidYouHear } from '@/lib/customers/types'
import { ENGAGEMENT_TIER_LABELS, HOW_DID_YOU_HEAR_LABELS } from '@/lib/customers/types'
import type { ExportFilters } from '@/lib/customers/exportFilters'

const TIER_OPTIONS: EngagementTier[] = ['active', 'lapsed', 'cold', 'vip']
const HOW_HEARD_OPTIONS: HowDidYouHear[] = [
  'postcard', 'newspaper', 'word_of_mouth', 'walk_in',
  'online', 'referral', 'other',
]

export default function MarketingExport({ stores, storeId, setStoreId }: {
  stores: Store[]
  storeId: string
  setStoreId: (id: string) => void
}) {
  // Filter state
  const [tiers, setTiers] = useState<EngagementTier[]>([])
  const [howHeardEnum, setHowHeardEnum] = useState<HowDidYouHear[]>([])
  const [howHeardLegacy, setHowHeardLegacy] = useState<string[]>([])
  const [tagsSel, setTagsSel] = useState<string[]>([])
  const [tagsLogic, setTagsLogic] = useState<'and' | 'or'>('or')
  const [lifetimeMin, setLifetimeMin] = useState('')
  const [lifetimeMax, setLifetimeMax] = useState('')
  const [firstStart, setFirstStart] = useState('')
  const [firstEnd, setFirstEnd] = useState('')
  const [lastContactStart, setLastContactStart] = useState('')
  const [lastContactEnd, setLastContactEnd] = useState('')
  const [daysSinceLastMailing, setDaysSinceLastMailing] = useState('')

  // Tag definitions for the chip picker
  const [tagDefs, setTagDefs] = useState<CustomerTagDefinition[]>([])
  // Distinct legacy "how heard" values seen in this store's customers
  const [legacyValues, setLegacyValues] = useState<string[]>([])

  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastExport, setLastExport] = useState<{ count: number; at: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('customer_tag_definitions').select('*').eq('is_archived', false).order('tag')
      .then(({ data }) => { if (!cancelled) setTagDefs((data ?? []) as CustomerTagDefinition[]) })
    return () => { cancelled = true }
  }, [])

  // Pull legacy "how heard" values for this store so the operator
  // can filter on the imported free-text values too.
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    supabase.from('customers')
      .select('how_did_you_hear_legacy')
      .eq('store_id', storeId)
      .not('how_did_you_hear_legacy', 'is', null)
      .limit(2000)
      .then(({ data }) => {
        if (cancelled) return
        const set = new Set<string>()
        for (const r of (data ?? []) as { how_did_you_hear_legacy: string }[]) {
          if (r.how_did_you_hear_legacy) set.add(r.how_did_you_hear_legacy)
        }
        setLegacyValues(Array.from(set).sort())
      })
    return () => { cancelled = true }
  }, [storeId])

  // Build filter payload from local state
  const filters: ExportFilters = useMemo(() => ({
    storeId,
    tiers: tiers.length ? tiers : undefined,
    howHeardEnum: howHeardEnum.length ? howHeardEnum : undefined,
    howHeardLegacy: howHeardLegacy.length ? howHeardLegacy : undefined,
    tags: tagsSel.length ? tagsSel : undefined,
    tagsLogic: tagsSel.length ? tagsLogic : undefined,
    lifetimeApptMin: lifetimeMin === '' ? null : parseInt(lifetimeMin, 10),
    lifetimeApptMax: lifetimeMax === '' ? null : parseInt(lifetimeMax, 10),
    firstApptStart: firstStart || null,
    firstApptEnd: firstEnd || null,
    lastContactStart: lastContactStart || null,
    lastContactEnd: lastContactEnd || null,
    daysSinceLastMailing: daysSinceLastMailing === '' ? null : parseInt(daysSinceLastMailing, 10),
  }), [storeId, tiers, howHeardEnum, howHeardLegacy, tagsSel, tagsLogic, lifetimeMin, lifetimeMax, firstStart, firstEnd, lastContactStart, lastContactEnd, daysSinceLastMailing])

  // Auto-preview, debounced 400ms.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!storeId) { setCount(null); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true); setError(null)
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      try {
        const res = await fetch('/api/customers/marketing-export/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(filters),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) setError(json.error || `Preview failed (${res.status})`)
        else setCount(json.count ?? 0)
      } catch (e: any) {
        setError(e?.message || 'Network error')
      }
      setLoading(false)
    }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [filters, storeId])

  async function exportNow() {
    if (count == null || count === 0) return
    if (!confirm(`Export ${count} customer${count === 1 ? '' : 's'} as CSV and log the mailing?`)) return
    setExporting(true); setError(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    try {
      const res = await fetch('/api/customers/marketing-export/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...filters, mailingType: 'postcard' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || `Export failed (${res.status})`)
        setExporting(false); return
      }
      // Trigger browser download
      const blob = await res.blob()
      const exportedCount = parseInt(res.headers.get('X-Exported-Count') || '0', 10)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `customers-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      setLastExport({ count: exportedCount, at: new Date().toLocaleString() })
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setExporting(false)
  }

  function toggleArr<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter(x => x !== v) : ([...arr, v] as T[])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="card-title">📨 Marketing Export</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14, lineHeight: 1.5 }}>
          Filter the customer database to build a postcard recipient list. Always-on suppressions: <strong>Do not contact</strong> and <strong>deleted customers</strong> are excluded automatically. Each export logs a <code>customer_mailings</code> row per recipient.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          {/* Store */}
          <div className="field" style={{ margin: 0, maxWidth: 400 }}>
            <label className="fl">Store (required)</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Engagement tier */}
          <FilterRow label="Engagement tier" hint="Multi-select">
            <ChipPicker
              options={TIER_OPTIONS.map(t => ({ value: t, label: ENGAGEMENT_TIER_LABELS[t] }))}
              selected={tiers}
              onToggle={v => setTiers(t => toggleArr<EngagementTier>(t, v as EngagementTier))}
            />
          </FilterRow>

          {/* How heard (enum) */}
          <FilterRow label='How did you hear (structured)' hint="From the dropdown on new customers">
            <ChipPicker
              options={HOW_HEARD_OPTIONS.map(t => ({ value: t, label: HOW_DID_YOU_HEAR_LABELS[t] }))}
              selected={howHeardEnum}
              onToggle={v => setHowHeardEnum(t => toggleArr<HowDidYouHear>(t, v as HowDidYouHear))}
            />
          </FilterRow>

          {/* How heard (legacy) — only when there are legacy values to filter on */}
          {legacyValues.length > 0 && (
            <FilterRow label="Legacy source (imported free-text)" hint="From customers added via CSV import">
              <ChipPicker
                options={legacyValues.map(v => ({ value: v, label: v }))}
                selected={howHeardLegacy}
                onToggle={v => setHowHeardLegacy(t => toggleArr(t, v))}
                small
              />
            </FilterRow>
          )}

          {/* Tags */}
          <FilterRow label="Tags" hint="Multi-select">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--mist)' }}>Logic:</span>
              <button type="button" onClick={() => setTagsLogic('or')}
                className={tagsLogic === 'or' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>OR</button>
              <button type="button" onClick={() => setTagsLogic('and')}
                className={tagsLogic === 'and' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>AND</button>
            </div>
            <ChipPicker
              options={tagDefs.map(d => ({ value: d.tag, label: d.tag, color: d.color }))}
              selected={tagsSel}
              onToggle={v => setTagsSel(t => toggleArr(t, v))}
            />
          </FilterRow>

          {/* Lifetime appointment count */}
          <FilterRow label="Lifetime appointment count">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="number" min={0} placeholder="Min" value={lifetimeMin}
                onChange={e => setLifetimeMin(e.target.value)} style={{ width: 100 }} />
              <span style={{ color: 'var(--mist)' }}>—</span>
              <input type="number" min={0} placeholder="Max" value={lifetimeMax}
                onChange={e => setLifetimeMax(e.target.value)} style={{ width: 100 }} />
            </div>
          </FilterRow>

          {/* First appointment date range */}
          <FilterRow label="First appointment date">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={firstStart} onChange={e => setFirstStart(e.target.value)} />
              <span style={{ color: 'var(--mist)' }}>—</span>
              <input type="date" value={firstEnd} onChange={e => setFirstEnd(e.target.value)} />
            </div>
          </FilterRow>

          {/* Last contact date range */}
          <FilterRow label="Last contact date">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={lastContactStart} onChange={e => setLastContactStart(e.target.value)} />
              <span style={{ color: 'var(--mist)' }}>—</span>
              <input type="date" value={lastContactEnd} onChange={e => setLastContactEnd(e.target.value)} />
            </div>
          </FilterRow>

          {/* Days since last mailing */}
          <FilterRow label="Suppress recently mailed" hint="Excludes anyone mailed in the last N days">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="number" min={1} placeholder="e.g., 90" value={daysSinceLastMailing}
                onChange={e => setDaysSinceLastMailing(e.target.value)} style={{ width: 120 }} />
              <span style={{ color: 'var(--mist)', fontSize: 12 }}>days</span>
            </div>
          </FilterRow>

          {/* Geographic radius — placeholder, deferred */}
          <FilterRow label="Geographic radius" hint="Coming after customer-address geocoding ships">
            <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
              Available once customer addresses are geocoded. Phase 6+.
            </div>
          </FilterRow>
        </div>
      </div>

      {/* Preview + export action bar */}
      <div className="card" style={{
        padding: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Matching customers
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: count === 0 ? 'var(--mist)' : 'var(--green-dark)' }}>
            {loading ? '…' : (count ?? '—')}
          </div>
          {error && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#7f1d1d' }}>{error}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastExport && (
            <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>
              ✓ Last export: {lastExport.count} at {lastExport.at}
            </span>
          )}
          <button className="btn-primary btn-sm" onClick={exportNow}
            disabled={exporting || loading || count == null || count === 0}>
            {exporting ? 'Exporting…' : '⬇️ Export CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: 11, color: 'var(--mist)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

interface ChipOpt { value: string; label: string; color?: string }

function ChipPicker({ options, selected, onToggle, small }: {
  options: ChipOpt[]
  selected: string[]
  onToggle: (v: string) => void
  small?: boolean
}) {
  if (options.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--mist)' }}>(no options)</div>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o.value)
        const c = o.color || 'var(--green)'
        return (
          <button key={o.value} type="button" onClick={() => onToggle(o.value)}
            style={{
              fontSize: small ? 10 : 11, fontWeight: 700,
              padding: small ? '3px 8px' : '4px 10px', borderRadius: 99,
              border: `1.5px solid ${on ? c : 'var(--pearl)'}`,
              background: on ? c + '22' : '#fff',
              color: on ? c : 'var(--mist)',
              cursor: 'pointer',
            }}>
            {on && '✓ '}{o.label}
          </button>
        )
      })}
    </div>
  )
}
