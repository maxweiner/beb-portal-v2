'use client'

// Read-only "Captured lead profile" card. Surfaces the per-kind
// profile fields the rep gathered before this store was created.
//
// Looks up the most recent converted lead pointing at this target:
//   • storeKind='store'             — leads.converted_store_id
//   • storeKind='trunk_show_store'  — leads.converted_trunk_show_store_id
//
// Renders nothing if there's no matching lead, or if the lead has no
// per-kind fields filled in.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/types'

interface Props {
  storeKind: 'store' | 'trunk_show_store'
  targetId: string
}

const PARKING_LABEL: Record<string, string> = {
  own_lot: 'Own Lot', shared_lot: 'Shared Lot', street: 'Street', none: 'None',
}
const SQ_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

export default function LeadProfileCard({ storeKind, targetId }: Props) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const col = storeKind === 'store' ? 'converted_store_id' : 'converted_trunk_show_store_id'
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq(col, targetId)
        .is('deleted_at', null)
        .order('converted_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (!cancelled) {
        setLead((data as Lead) || null)
        setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [storeKind, targetId])

  if (!loaded || !lead) return null

  const isBuying = lead.lead_kind === 'buying_event'
  const isTrunk  = lead.lead_kind === 'trunk_show'
  if (!isBuying && !isTrunk) return null

  const rows: { label: string; value: any }[] = isBuying
    ? [
        { label: 'Best time of year', value: lead.best_time_of_year },
        { label: 'Year established', value: lead.year_established },
        { label: 'Square footage', value: lead.sq_footage ? SQ_LABEL[lead.sq_footage] : null },
        { label: 'Parking', value: lead.parking ? PARKING_LABEL[lead.parking] : null },
        { label: 'Freestanding building', value: yn(lead.freestanding) },
        { label: 'Currently buys estate jewelry', value: yn(lead.currently_buys) },
      ]
    : [
        { label: 'Locking cases', value: yn(lead.locking_cases) },
        { label: 'Rated safe on premises', value: yn(lead.rated_safe) },
        { label: '# of sales staff', value: lead.sales_staff_count },
        { label: 'Years in business', value: lead.years_in_business },
        { label: 'Sells estate jewelry now', value: yn(lead.sells_estate_jewelry) },
        { label: 'Distance to airport (mi)', value: lead.distance_to_airport_miles },
      ]

  const universal = [
    { label: 'Referral source', value: lead.referral_source },
    { label: 'Captured store phone', value: lead.store_phone },
    { label: 'Captured cell phone', value: lead.cell_phone },
    { label: 'Captured contact', value: [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null },
    { label: 'Captured contact email', value: lead.email },
  ]

  const visible = [...rows, ...universal].filter(r => r.value !== null && r.value !== undefined && r.value !== '')
  if (visible.length === 0) return null

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>📋 Captured Lead Profile</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {isBuying ? 'Buying-event lead' : 'Trunk-show lead'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: -4, marginBottom: 12 }}>
        Captured before this store was created — read-only.
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {visible.map(r => (
          <div key={r.label}>
            <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{r.label}</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{String(r.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function yn(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return v ? 'Yes' : 'No'
}
