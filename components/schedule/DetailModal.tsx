'use client'

// Right-side drawer that opens when a buying-event chip is clicked
// AND there's no setNav handler (i.e. the user is on the standalone
// Schedule page, not embedded). The Schedule orchestrator falls back
// to this when it can't navigate to the Buying Events page.

import { useEffect } from 'react'
import type { Event } from '@/types'
import { eventSpend, eventCommission, daySpend } from '@/lib/eventSpend'
import { fmtMoney } from '@/lib/format'
import { buyingMainColor, evDays } from './helpers'

export default function DetailModal({ ev, stores, onClose, isNarrow }: { ev: Event; stores: any[]; onClose: () => void; isNarrow: boolean }) {
  const store = stores.find(s => s.id === ev.store_id)
  const days = [...(ev.days||[])].sort((a,b) => a.day_number - b.day_number)
  const totalPurchases = days.reduce((s,d) => s + (d.purchases||0), 0)
  const totalCustomers = days.reduce((s,d) => s + (d.customers||0), 0)
  const totalDollars = eventSpend(ev)
  const totalCommission = eventCommission(ev)
  const closeRate = totalCustomers > 0 ? Math.round(totalPurchases/totalCustomers*100) : 0
  const color = buyingMainColor()
  const fmt = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})
  const fmtDollars = fmtMoney

  // Esc closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--cream)', height: '100%',
        width: isNarrow ? '100%' : 460, maxWidth: '100%',
        boxShadow: '-12px 0 32px rgba(0,0,0,.18)',
        overflowY: 'auto',
        animation: 'beb-drawer-in .22s cubic-bezier(.2,.8,.2,1)',
      }}>
        <style>{`@keyframes beb-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        {/* Header */}
        <div style={{ background: color, padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>◆ Event Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{ev.store_name}</div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12, marginTop: 2 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 44, height: 44, borderRadius: '50%', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Event Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                ['Customers', totalCustomers.toLocaleString()],
                ['Purchases', totalPurchases.toLocaleString()],
                ['Close Rate', `${closeRate}%`],
                ['💰 Amount Spent', fmtDollars(totalDollars)],
                ['Commission Due', fmtDollars(totalCommission)],
                ['Days Entered', `${days.length} of 3`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Day breakdown */}
          {days.length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Day by Day</div>
              {days.map(d => {
                const dayDate = new Date(ev.start_date+'T12:00:00')
                dayDate.setDate(dayDate.getDate() + d.day_number - 1)
                const dayDateStr = isNaN(dayDate.getTime()) ? '' : dayDate.toISOString().slice(0,10)
                const dayDollars = daySpend(d)
                const dayCR = d.customers > 0 ? Math.round(d.purchases/d.customers*100) : 0
                return (
                  <div key={d.day_number} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--cream2)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8, fontSize: 13 }}>
                      Day {d.day_number}{dayDateStr ? ` — ${fmt(dayDateStr)}` : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 8, fontSize: 13 }}>
                      {[['Customers', d.customers||0], ['Purchases', d.purchases||0], ['Amount Spent', fmtDollars(dayDollars)], ['Close', `${dayCR}%`]].map(([l,v]) => (
                        <div key={l as string}>
                          <div style={{ color: 'var(--mist)', fontSize: 10, marginBottom: 2 }}>{l}</div>
                          <div style={{ fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Workers */}
          {(ev.workers||[]).length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Buyers</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(ev.workers||[]).map((w:any) => (
                  <span key={w.id} className="badge badge-jade">{w.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Ad Spend */}
          {(ev.spend_vdp||ev.spend_newspaper||ev.spend_postcard||ev.spend_spiffs) ? (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Ad Spend & Spiffs</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[['VDP', ev.spend_vdp], ['Newspaper', ev.spend_newspaper], ['Postcard', ev.spend_postcard], ['Spiffs', ev.spend_spiffs]].map(([l,v]) => v ? (
                  <div key={l as string}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--mist)', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>{fmtDollars(Number(v))}</div>
                  </div>
                ) : null)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
