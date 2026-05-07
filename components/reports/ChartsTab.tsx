'use client'

// Visual reports tab. Renders one chart per registered visual report;
// new ones get added to the CHARTS array below.

import { useState } from 'react'
import BuyingTotalsByStoreChart from './charts/BuyingTotalsByStoreChart'

interface ChartDef {
  id: string
  title: string
  description: string
  Component: React.FC
}

const CHARTS: ChartDef[] = [
  {
    id: 'buying-totals-by-store',
    title: '📊 Buying Totals by Store',
    description: 'Horizontal bar chart of cumulative spend per store. Filter by date range.',
    Component: BuyingTotalsByStoreChart,
  },
]

export default function ChartsTab() {
  const [openId, setOpenId] = useState<string>(CHARTS[0]?.id || '')
  const open = CHARTS.find(c => c.id === openId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Chart picker — only shown when there's more than one chart. */}
      {CHARTS.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CHARTS.map(c => {
            const sel = c.id === openId
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)}
                style={{
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${sel ? 'var(--green-dark)' : 'var(--pearl)'}`,
                  background: sel ? 'var(--green-pale)' : '#fff',
                  color: sel ? 'var(--green-dark)' : 'var(--ash)',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                }}>
                {c.title}
              </button>
            )
          })}
        </div>
      )}

      {open && <open.Component />}
    </div>
  )
}
