'use client'

import { useApp } from '@/lib/context'

export default function Reports() {
  const { events, stores, year, setYear } = useApp()

  const YEARS = Array.from({ length: new Date().getFullYear() - 2017 }, (_, i) => String(2018 + i)).reverse()

  const yearEvents = events.filter(e => e.start_date?.startsWith(year))

  const totals = yearEvents.reduce((acc, ev) => {
    ev.days.forEach(d => {
      acc.customers  += d.customers  || 0
      acc.purchases  += d.purchases  || 0
      acc.dollars    += (d.dollars10 || 0) + (d.dollars5 || 0)
      acc.src_vdp         += d.src_vdp         || 0
      acc.src_postcard    += d.src_postcard    || 0
      acc.src_social      += d.src_social      || 0
      acc.src_wordofmouth += d.src_wordofmouth || 0
      acc.src_other       += d.src_other       || 0
      acc.src_repeat      += d.src_repeat      || 0
    })
    return acc
  }, { customers: 0, purchases: 0, dollars: 0, src_vdp: 0, src_postcard: 0, src_social: 0, src_wordofmouth: 0, src_other: 0, src_repeat: 0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0

  const storeRows = stores.map(store => {
    const evs = yearEvents.filter(e => e.store_id === store.id)
    const days = evs.flatMap(e => e.days)
    const purchases = days.reduce((s, d) => s + (d.purchases || 0), 0)
    const customers = days.reduce((s, d) => s + (d.customers || 0), 0)
    const dollars = days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
    return { store, evs: evs.length, purchases, customers, dollars, closeRate: customers > 0 ? Math.round(purchases / customers * 100) : 0 }
  }).filter(r => r.evs > 0).sort((a, b) => b.dollars - a.dollars)

  const srcTotal = totals.src_vdp + totals.src_postcard + totals.src_social + totals.src_wordofmouth + totals.src_other + totals.src_repeat
  const sources = [
    { label: 'VDP / Large Postcard', value: totals.src_vdp, color: '#059669' },
    { label: 'Store Postcard',        value: totals.src_postcard, color: '#3B82F6' },
    { label: 'Social Media',          value: totals.src_social, color: '#8B5CF6' },
    { label: 'Word of Mouth',         value: totals.src_wordofmouth, color: '#F59E0B' },
    { label: 'Repeat Customer',       value: totals.src_repeat, color: '#F43F5E' },
    { label: 'Other',                 value: totals.src_other, color: '#6B7280' },
  ]

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Reports</h1>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--pearl)', color: 'var(--ink)' }}>
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => window.print()}
            className="btn-outline btn-sm"
            >🖨 Print</button>
        </div>
      </div>

      {/* Year totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Events', value: yearEvents.length },
          { label: 'Purchases', value: totals.purchases.toLocaleString() },
          { label: 'Revenue', value: fmt(totals.dollars) },
          { label: 'Close Rate', value: `${closeRate}%` },
        ].map(({ label, value }) => (
          <div key={label} className="card">
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--mist)' }}>{label}</div>
            <div className="text-3xl font-black" style={{ color: 'var(--green)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Store breakdown */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
        <div className="px-6 py-4 font-black" style={{ borderBottom: '1px solid var(--pearl)', color: 'var(--ink)' }}>Store Performance — {year}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
                {['Store', 'Events', 'Customers', 'Purchases', 'Close Rate', 'Revenue'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--mist)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {storeRows.length === 0 && (
                <tr><td colSpan={6} className="text-center px-5 py-8" style={{ color: 'var(--fog)' }}>No data for {year}</td></tr>
              )}
              {storeRows.map(({ store, evs, purchases, customers, dollars, closeRate: cr }) => (
                <tr key={store.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                  <td className="px-5 py-3 font-semibold" style={{ color: 'var(--ink)' }}>{store.name}</td>
                  <td className="px-5 py-3" style={{ color: 'var(--mist)' }}>{evs}</td>
                  <td className="px-5 py-3" style={{ color: 'var(--mist)' }}>{customers.toLocaleString()}</td>
                  <td className="px-5 py-3 font-bold" style={{ color: 'var(--ink)' }}>{purchases.toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full overflow-hidden flex-1 max-w-16" style={{ background: 'var(--cream2)' }}>
                        <div className="h-full rounded-full" style={{ width: `${cr}%`, background: 'var(--green)' }} />
                      </div>
                      <span style={{ color: 'var(--mist)' }}>{cr}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 font-bold" style={{ color: 'var(--green)' }}>{fmt(dollars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead sources */}
      <div className="card">
        <div className="font-black mb-4" style={{ color: 'var(--ink)' }}>Lead Sources — {year}</div>
        <div className="space-y-3">
          {sources.map(({ label, value, color }) => {
            const pct = srcTotal > 0 ? Math.round(value / srcTotal * 100) : 0
            return (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1">
                  <span style={{ color: 'var(--ash)' }}>{label}</span>
                  <span className="font-bold" style={{ color: 'var(--ink)' }}>{value} <span style={{ color: 'var(--mist)' }}>({pct}%)</span></span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--cream2)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
