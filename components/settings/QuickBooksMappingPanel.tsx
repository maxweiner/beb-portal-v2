'use client'

// Settings → 💼 QuickBooks Account Mapping. Edits the
// `quickbooks.account_mapping` settings row that the export
// route (POST /api/expense-reports/[id]/export-quickbooks)
// reads when assembling IIF + CSV files.
//
// Autosaves with the same pattern as the existing Settings
// profile form: debounced update via useAutosave so Diane
// doesn't have to remember to click Save.
//
// Visible to anyone who can run the export (admin / superadmin
// / accounting / partner) — gated at the mount point in
// Settings.tsx.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAutosave } from '@/lib/useAutosave'
import type { QuickbooksAccountMapping } from '@/types'

const DEFAULTS: QuickbooksAccountMapping = {
  flight:            'Travel:Flight',
  rental_car:        'Travel:Rental Car',
  rideshare:         'Travel:Ground Transportation',
  hotel:             'Travel:Hotel',
  meals:             'Travel:Meals',
  shipping_supplies: 'Supplies:Shipping',
  jewelry_lots_cash: 'Cost of Goods Sold:Jewelry Purchases',
  mileage:           'Travel:Mileage',
  custom:            'Travel:Other',
  compensation:      'Buyer Compensation',
  bonus:             'Buyer Bonus',
  ap_account:        'Accounts Payable',
}

interface Row {
  key: keyof QuickbooksAccountMapping
  label: string
  hint?: string
}
const ROWS: Row[] = [
  { key: 'flight',            label: 'Flight' },
  { key: 'rental_car',        label: 'Rental car' },
  { key: 'rideshare',         label: 'Rideshare / Taxi' },
  { key: 'hotel',             label: 'Hotel' },
  { key: 'meals',             label: 'Meals' },
  { key: 'shipping_supplies', label: 'Shipping supplies' },
  { key: 'jewelry_lots_cash', label: 'Jewelry lots (cash)', hint: 'Usually a COGS account — affects gross-profit reporting.' },
  { key: 'mileage',           label: 'Mileage' },
  { key: 'custom',            label: 'Custom / Other' },
  { key: 'compensation',      label: 'Buyer compensation', hint: 'Per-trip comp_rate paid to the buyer.' },
  { key: 'bonus',             label: 'Buyer bonus', hint: 'Partner-granted bonus on top of comp.' },
  { key: 'ap_account',        label: 'AP account (credit side of Bill)', hint: 'Usually "Accounts Payable". Each Bill credits this account; Pay Bills later debits it.' },
]

export default function QuickBooksMappingPanel() {
  const [mapping, setMapping] = useState<QuickbooksAccountMapping>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'quickbooks.account_mapping')
        .maybeSingle()
      if (cancelled) return
      if (err) { setError(err.message); setLoaded(true); return }
      // Merge stored value over defaults so any missing keys get
      // sensible fallbacks (also covers the legacy case where the
      // mapping row hasn't been seeded yet).
      const stored = (data?.value as Partial<QuickbooksAccountMapping>) || {}
      setMapping({ ...DEFAULTS, ...stored })
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  const status = useAutosave(
    mapping,
    async (m) => {
      if (!loaded) return
      const { error: err } = await supabase
        .from('settings')
        .upsert({
          key: 'quickbooks.account_mapping',
          value: m,
          updated_at: new Date().toISOString(),
        })
      if (err) setError(err.message)
    },
    { enabled: loaded, delay: 800 },
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--mist)', lineHeight: 1.5 }}>
        Each portal expense category maps to a QuickBooks account on the
        exported Bill. Use QB's hierarchy syntax (<code>Parent:Child</code>)
        — the export references existing accounts by full path. Edits
        autosave.
      </div>

      {error && (
        <div style={{ padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--cream2)', textAlign: 'left' }}>
            <th style={{ padding: '6px 10px', width: '38%' }}>Portal category</th>
            <th style={{ padding: '6px 10px' }}>QuickBooks account</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(r => (
            <tr key={r.key} style={{ borderBottom: '1px solid var(--cream2)', verticalAlign: 'top' }}>
              <td style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 600 }}>{r.label}</div>
                {r.hint && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{r.hint}</div>
                )}
              </td>
              <td style={{ padding: '6px 10px' }}>
                <input
                  type="text"
                  value={mapping[r.key]}
                  placeholder={DEFAULTS[r.key]}
                  onChange={e => setMapping(m => ({ ...m, [r.key]: e.target.value }))}
                  style={{ width: '100%', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 11, color: 'var(--mist)' }}>
        {status === 'saving' ? '💾 Saving…' :
         status === 'saved'  ? '✓ Saved' :
         status === 'error'  ? '⚠ Save failed' :
         'Autosaves as you type'}
      </div>
    </div>
  )
}
