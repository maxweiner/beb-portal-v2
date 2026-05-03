'use client'

// "Add Mileage" — calls the server's calculate-mileage endpoint, which
// uses Google Distance Matrix between the user's saved home address
// and the event's store address. Shows the calculation breakdown
// (round-trip × 1.10 buffer × IRS rate); user clicks Save to insert
// the expense with source='mileage_calc' and the breakdown stored in
// the notes field.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { todayIso } from './expensesUtils'
import DatePicker from '@/components/ui/DatePicker'

interface Breakdown {
  homeAddress: string
  storeAddress: string
  oneWayMiles: number
  roundTripMiles: number
  bufferedMiles: number
  rate: number
  amount: number
  description: string
}

export default function AddMileageButton({
  reportId, onAdded,
}: {
  reportId: string
  onAdded: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'idle' | 'calculating' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [purpose, setPurpose] = useState('')
  const [date, setDate] = useState(todayIso())
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  function reset() {
    setOpen(false); setBusy('idle'); setError(null)
    setPurpose(''); setDate(todayIso()); setBreakdown(null)
  }

  async function calculate() {
    setBusy('calculating'); setError(null); setBreakdown(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${reportId}/calculate-mileage`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.breakdown) {
        setError(json.error || `Calculation failed (${res.status})`)
      } else {
        setBreakdown(json.breakdown as Breakdown)
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setBusy('idle')
  }

  async function save() {
    if (!breakdown) return
    setBusy('saving'); setError(null)
    const notes = purpose.trim()
      ? `${purpose.trim()}\n${breakdown.description}`
      : breakdown.description
    const { error: insertErr } = await supabase.from('expenses').insert({
      expense_report_id: reportId,
      category: 'mileage',
      vendor: null,
      amount: breakdown.amount,
      expense_date: date,
      notes,
      source: 'mileage_calc',
      ocr_extracted_data: breakdown,
    })
    if (insertErr) {
      setError(insertErr.message); setBusy('idle'); return
    }
    await onAdded()
    reset()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 10,
          border: '2px dashed #6B7280', background: 'transparent',
          color: 'var(--ink)', fontWeight: 700, fontSize: 13,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        🛣 Add Mileage (calculated from your home to the store)
      </button>
    )
  }

  return (
    <div onClick={e => e.target === e.currentTarget && reset()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>🛣 Mileage</h2>
          <button onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label className="fl">Date</label>
          <DatePicker value={date} onChange={setDate} />
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label className="fl">Purpose (optional)</label>
          <input type="text" value={purpose} placeholder="e.g. Setup day, Pickup truck"
            onChange={e => setPurpose(e.target.value)} />
        </div>

        {!breakdown && (
          <button className="btn-primary" onClick={calculate}
            disabled={busy === 'calculating'} style={{ width: '100%' }}>
            {busy === 'calculating' ? 'Calculating…' : 'Calculate from home to store'}
          </button>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}

        {breakdown && (
          <>
            <div style={{
              marginTop: 12, padding: 14, background: '#F0FDF4',
              border: '1px solid #BBF7D0', borderRadius: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#065F46', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Calculation
              </div>
              <div style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.7 }}>
                <div><strong>Home:</strong> {breakdown.homeAddress}</div>
                <div><strong>Store:</strong> {breakdown.storeAddress}</div>
                <div style={{ marginTop: 6 }}>
                  {breakdown.oneWayMiles} mi one-way × 2 = <strong>{breakdown.roundTripMiles} mi round trip</strong>
                </div>
                <div>
                  × <strong>1.10</strong> in-town buffer = <strong>{breakdown.bufferedMiles} mi</strong>
                </div>
                <div>
                  × <strong>${breakdown.rate.toFixed(2)}</strong>/mi (IRS rate) = <strong style={{ color: 'var(--green-dark)', fontSize: 16 }}>${breakdown.amount.toFixed(2)}</strong>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setBreakdown(null)} className="btn-outline btn-sm">Recalculate</button>
              <button onClick={save} className="btn-primary" disabled={busy === 'saving'}>
                {busy === 'saving' ? 'Saving…' : 'Save expense'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
