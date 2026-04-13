import { createClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const { data: ev } = await sb.from('events').select('store_name').eq('id', params.id).single()
  return { title: ev ? `${ev.store_name} — Event Summary` : 'Event Summary' }
}

export default async function EventSummaryPage({ params }: { params: { id: string } }) {
  const { data: ev } = await sb
    .from('events')
    .select('*, days:event_days(*)')
    .eq('id', params.id)
    .single()

  if (!ev) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F5F0E8' }}>
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <div className="font-bold text-xl" style={{ color: '#1a1a16' }}>Event not found</div>
        </div>
      </div>
    )
  }

  const { data: store } = await sb.from('stores').select('*').eq('id', ev.store_id).single()

  const days = (ev.days || []).sort((a: any, b: any) => a.day_number - b.day_number)

  const totals = days.reduce((acc: any, d: any) => ({
    customers:  acc.customers  + (d.customers  || 0),
    purchases:  acc.purchases  + (d.purchases  || 0),
    dollars:    acc.dollars    + (d.dollars10 || 0) + (d.dollars5 || 0),
    src_vdp:    acc.src_vdp    + (d.src_vdp    || 0),
    src_postcard: acc.src_postcard + (d.src_postcard || 0),
    src_social: acc.src_social + (d.src_social  || 0),
    src_wom:    acc.src_wom    + (d.src_wordofmouth || 0),
    src_repeat: acc.src_repeat + (d.src_repeat  || 0),
    src_other:  acc.src_other  + (d.src_other   || 0),
  }), { customers: 0, purchases: 0, dollars: 0, src_vdp: 0, src_postcard: 0, src_social: 0, src_wom: 0, src_repeat: 0, src_other: 0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0
  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const srcTotal = totals.src_vdp + totals.src_postcard + totals.src_social + totals.src_wom + totals.src_repeat + totals.src_other
  const sources = [
    { label: 'VDP / Large Postcard', value: totals.src_vdp, color: '#059669' },
    { label: 'Store Postcard', value: totals.src_postcard, color: '#3B82F6' },
    { label: 'Social Media', value: totals.src_social, color: '#8B5CF6' },
    { label: 'Word of Mouth', value: totals.src_wom, color: '#F59E0B' },
    { label: 'Repeat Customer', value: totals.src_repeat, color: '#F43F5E' },
    { label: 'Other', value: totals.src_other, color: '#6B7280' },
  ].filter(s => s.value > 0)

  const card = (label: string, value: string | number, sub?: string) => (
    <div style={{ background: 'white', border: '1px solid #D8D3CA', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#737368', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: '#1D6B44' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#A8A89A', marginTop: 4 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-block', background: '#1D6B44', color: 'white', fontWeight: 900, fontSize: 13, padding: '4px 14px', borderRadius: 20, marginBottom: 12 }}>
            ◆ BEB Buyer Event Summary
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#1a1a16', margin: 0 }}>{store?.name || ev.store_name}</h1>
          <div style={{ color: '#737368', marginTop: 4 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          {ev.workers && ev.workers.length > 0 && (
            <div style={{ marginTop: 8, color: '#1D6B44', fontSize: 13, fontWeight: 600 }}>
              👤 {ev.workers.map((w: any) => w.name).join(', ')}
            </div>
          )}
        </div>

        {/* Totals */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {card('Customers', totals.customers.toLocaleString())}
          {card('Purchases', totals.purchases.toLocaleString())}
          {card('Revenue', `$${totals.dollars.toLocaleString()}`)}
          {card('Close Rate', `${closeRate}%`, `${totals.purchases} of ${totals.customers}`)}
        </div>

        {/* Per-day breakdown */}
        {days.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #D8D3CA', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#1a1a16', marginBottom: 16 }}>Day by Day</div>
            {days.map((d: any) => {
              const dayDate = new Date(ev.start_date + 'T12:00:00')
              dayDate.setDate(dayDate.getDate() + d.day_number - 1)
              const dayDollars = (d.dollars10 || 0) + (d.dollars5 || 0)
              const dayCR = d.customers > 0 ? Math.round(d.purchases / d.customers * 100) : 0
              return (
                <div key={d.day_number} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: d.day_number < days.length ? '1px solid #F0ECE4' : 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1D6B44', marginBottom: 8 }}>
                    Day {d.day_number} — {fmt(dayDate.toISOString().slice(0, 10))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[['Customers', d.customers || 0], ['Purchases', d.purchases || 0], [`$${dayDollars.toLocaleString()}`, 'Revenue'], [`${dayCR}%`, 'Close Rate']].map(([val, label], i) => (
                      <div key={i} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#1a1a16' }}>{i < 2 ? val : val}</div>
                        <div style={{ fontSize: 11, color: '#A8A89A' }}>{i < 2 ? label : label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Lead sources */}
        {srcTotal > 0 && (
          <div style={{ background: 'white', border: '1px solid #D8D3CA', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: '#1a1a16', marginBottom: 16 }}>Lead Sources</div>
            {sources.map(({ label, value, color }) => {
              const pct = Math.round(value / srcTotal * 100)
              return (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: '#4A4A42' }}>{label}</span>
                    <span style={{ fontWeight: 700 }}>{value} <span style={{ color: '#A8A89A' }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: '#F0ECE4', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: '#A8A89A', marginTop: 24 }}>
          BEB LLC · Beneficial Estate Buyers · beb-portal.vercel.app
        </div>
      </div>
    </div>
  )
}
