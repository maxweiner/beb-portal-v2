'use client'

import { useApp } from '@/lib/context'

export default function Dashboard() {
  const { user, users, stores, events, year, setYear } = useApp()

  const YEARS = Array.from(
    { length: new Date().getFullYear() - 2017 },
    (_, i) => String(2018 + i)
  ).reverse()

  const yearEvents = events.filter(e => e.start_date?.startsWith(year))

  const totals = yearEvents.reduce((acc, ev) => {
    ev.days.forEach(d => {
      acc.customers  += d.customers  || 0
      acc.purchases  += d.purchases  || 0
      acc.dollars    += (d.dollars10 || 0) + (d.dollars5 || 0)
      acc.commission += (d.dollars10 || 0) * 0.10 + (d.dollars5 || 0) * 0.05
      acc.src_vdp         += d.src_vdp         || 0
      acc.src_postcard    += d.src_postcard    || 0
      acc.src_social      += d.src_social      || 0
      acc.src_wordofmouth += d.src_wordofmouth || 0
      acc.src_other       += d.src_other       || 0
      acc.src_repeat      += d.src_repeat      || 0
    })
    return acc
  }, { customers: 0, purchases: 0, dollars: 0, commission: 0, src_vdp: 0, src_postcard: 0, src_social: 0, src_wordofmouth: 0, src_other: 0, src_repeat: 0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0

  const storeRows = stores.map(store => {
    const evs = yearEvents.filter(e => e.store_id === store.id)
    const days = evs.flatMap(e => e.days)
    const purchases = days.reduce((s, d) => s + (d.purchases || 0), 0)
    const customers = days.reduce((s, d) => s + (d.customers || 0), 0)
    const dollars = days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
    const cr = customers > 0 ? Math.round(purchases / customers * 100) : 0
    return { store, evs: evs.length, purchases, customers, dollars, cr }
  }).filter(r => r.evs > 0).sort((a, b) => b.dollars - a.dollars)

  const srcTotal = totals.src_vdp + totals.src_postcard + totals.src_social + totals.src_wordofmouth + totals.src_other + totals.src_repeat
  const sources = [
    { label: 'VDP / Large Postcard', value: totals.src_vdp, color: '#059669' },
    { label: 'Store Postcard', value: totals.src_postcard, color: '#3B82F6' },
    { label: 'Social Media', value: totals.src_social, color: '#8B5CF6' },
    { label: 'Word of Mouth', value: totals.src_wordofmouth, color: '#F59E0B' },
    { label: 'Repeat Customer', value: totals.src_repeat, color: '#F43F5E' },
    { label: 'Other', value: totals.src_other, color: '#6B7280' },
  ]

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`
  const buyers = users.filter(u => u.active && (u.role === 'buyer' || u.role === 'admin'))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>
            Welcome back, {user?.name?.split(' ')[0]} 👋
          </h1>
          <div className="text-sm mt-0.5" style={{ color: 'var(--mist)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Year</span>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--pearl)', color: 'var(--ink)' }}>
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Events', value: yearEvents.length, sub: `${stores.length} stores` },
          { label: 'Purchases', value: totals.purchases.toLocaleString(), sub: `${totals.customers.toLocaleString()} customers` },
          { label: 'Revenue', value: fmt(totals.dollars), sub: `${closeRate}% close rate` },
          { label: 'Commission Due', value: fmt(totals.commission), sub: '10% + 5% tiers' },
          { label: 'Active Buyers', value: buyers.length, sub: `${users.filter(u => u.role === 'admin' || u.role === 'superadmin').length} admin(s)` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-val">{value}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store performance table */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
          <div className="px-5 py-4 font-black text-sm" style={{ borderBottom: '1px solid var(--pearl)', color: 'var(--ink)' }}>
            Store Performance — {year}
          </div>
          {storeRows.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'var(--mist)' }}>No data for {year}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--cream2)', background: 'var(--cream2)' }}>
                    {['Store', 'Events', 'Purchases', 'Close Rate', 'Revenue'].map(h => (
                      <th key={h} className="text-left px-5 py-2.5 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--mist)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storeRows.map(({ store, evs, purchases, customers, dollars, cr }) => (
                    <tr key={store.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                      <td className="px-5 py-3 font-semibold" style={{ color: 'var(--ink)' }}>{store.name}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--mist)' }}>{evs}</td>
                      <td className="px-5 py-3 font-bold" style={{ color: 'var(--ink)' }}>{purchases.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden max-w-20" style={{ background: 'var(--cream2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${cr}%`, background: 'var(--green)' }} />
                          </div>
                          <span className="text-xs" style={{ color: 'var(--mist)' }}>{cr}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-bold" style={{ color: 'var(--green)' }}>{fmt(dollars)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lead sources */}
        <div className="card">
          <div className="font-black text-sm mb-4" style={{ color: 'var(--ink)' }}>Lead Sources — {year}</div>
          <div className="space-y-3">
            {sources.map(({ label, value, color }) => {
              const pct = srcTotal > 0 ? Math.round(value / srcTotal * 100) : 0
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ash)' }}>{label}</span>
                    <span className="font-bold" style={{ color: 'var(--ink)' }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cream2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Buyers worked */}
          {buyers.length > 0 && (
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--cream2)' }}>
              <div className="font-black text-sm mb-3" style={{ color: 'var(--ink)' }}>Buyers</div>
              <div className="space-y-2">
                {buyers.map(b => {
                  const buyed = yearEvents.flatMap(ev => ev.days).filter(d => d.entered_by === b.id).length
                  return (
                    <div key={b.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white"
                          style={{ background: 'var(--green)', fontSize: 10 }}>
                          {b.name?.charAt(0)}
                        </div>
                        <span style={{ color: 'var(--ash)' }}>{b.name}</span>
                      </div>
                      <span className="text-xs font-bold" style={{ color: 'var(--mist)' }}>{buyed} days</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
