'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'

interface BookingConfigState {
  slot_interval_minutes: number
  max_concurrent_slots: number
  day1_start: string; day1_end: string
  day2_start: string; day2_end: string
  day3_start: string; day3_end: string
  items_options: string[]
  hear_about_options: string[]
  hot_show_threshold: number
  hot_show_notify_sms: boolean
  hot_show_notify_email: boolean
}

interface StorePortalToken {
  id: string
  token: string
  active: boolean
}

const DEFAULT_CONFIG: BookingConfigState = {
  slot_interval_minutes: 20,
  max_concurrent_slots: 3,
  day1_start: '10:00', day1_end: '17:00',
  day2_start: '10:00', day2_end: '17:00',
  day3_start: '10:00', day3_end: '16:00',
  items_options: ['Gold', 'Diamonds', 'Watches', 'Coins', 'Jewelry', "I'm Not Sure"],
  hear_about_options: ['Large Postcard', 'Small Postcard', 'Newspaper', 'Email', 'Text', 'The Store Told Me'],
  hot_show_threshold: 80,
  hot_show_notify_sms: true,
  hot_show_notify_email: true,
}

function timeToHHMM(t: string | null | undefined): string {
  if (!t) return ''
  return t.length >= 5 ? t.slice(0, 5) : t
}

const TIMEZONE_OPTIONS = [
  ['America/New_York',    'Eastern (ET) — New York'],
  ['America/Chicago',     'Central (CT) — Chicago'],
  ['America/Denver',      'Mountain (MT) — Denver'],
  ['America/Phoenix',     'Mountain (no DST) — Phoenix'],
  ['America/Los_Angeles', 'Pacific (PT) — Los Angeles'],
  ['America/Anchorage',   'Alaska (AKT)'],
  ['Pacific/Honolulu',    'Hawaii (HST)'],
] as const

export default function BookingConfigCard({
  storeId,
  initialPrimary,
  initialSecondary,
  initialTimezone,
  refetchStores,
}: {
  storeId: string
  initialPrimary: string | null
  initialSecondary: string | null
  initialTimezone: string | null
  refetchStores: () => Promise<void>
}) {
  const [primary, setPrimary] = useState(initialPrimary || '#1D6B44')
  const [secondary, setSecondary] = useState(initialSecondary || '#F5F0E8')
  const [timezone, setTimezone] = useState(initialTimezone || 'America/New_York')

  const [config, setConfig] = useState<BookingConfigState | null>(null)
  const [portalToken, setPortalToken] = useState<StorePortalToken | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('booking_config').select('*').eq('store_id', storeId).maybeSingle(),
      supabase.from('store_portal_tokens').select('id, token, active').eq('store_id', storeId).eq('active', true).maybeSingle(),
    ]).then(([cfgRes, tokRes]) => {
      if (cancelled) return
      const cfg = cfgRes.data
      if (cfg) {
        setConfig({
          slot_interval_minutes: cfg.slot_interval_minutes ?? 20,
          max_concurrent_slots: cfg.max_concurrent_slots ?? 3,
          day1_start: timeToHHMM(cfg.day1_start),
          day1_end: timeToHHMM(cfg.day1_end),
          day2_start: timeToHHMM(cfg.day2_start),
          day2_end: timeToHHMM(cfg.day2_end),
          day3_start: timeToHHMM(cfg.day3_start),
          day3_end: timeToHHMM(cfg.day3_end),
          items_options: Array.isArray(cfg.items_options) ? cfg.items_options : DEFAULT_CONFIG.items_options,
          hear_about_options: Array.isArray(cfg.hear_about_options) ? cfg.hear_about_options : DEFAULT_CONFIG.hear_about_options,
          hot_show_threshold: cfg.hot_show_threshold ?? 80,
          hot_show_notify_sms: cfg.hot_show_notify_sms ?? true,
          hot_show_notify_email: cfg.hot_show_notify_email ?? true,
        })
      } else {
        setConfig(DEFAULT_CONFIG)
      }
      setPortalToken(tokRes.data || null)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [storeId])

  // Autosave: branding + timezone → stores table.
  // (Slug lives in QrCodesSection now since every QR redirect depends on it.)
  const brandingStatus = useAutosave(
    { primary, secondary, timezone },
    async ({ primary, secondary, timezone }) => {
      const { error } = await supabase.from('stores').update({
        color_primary: primary || null,
        color_secondary: secondary || null,
        timezone: timezone || 'America/New_York',
      }).eq('id', storeId)
      if (error) throw error
      await refetchStores()
    },
    { delay: 1200, enabled: loaded },
  )

  // Autosave: booking_config → upsert
  const configStatus = useAutosave(
    config,
    async (cfg) => {
      if (!cfg) return
      const payload: any = { store_id: storeId, ...cfg }
      // Send empty time strings as nulls so the time columns accept them
      for (const k of ['day1_start','day1_end','day2_start','day2_end','day3_start','day3_end']) {
        if (!payload[k]) payload[k] = null
      }
      const { error } = await supabase.from('booking_config')
        .upsert(payload, { onConflict: 'store_id' })
      if (error) throw error
    },
    { delay: 1200, enabled: loaded },
  )

  if (!loaded || !config) {
    return (
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">Customer Booking Configuration</div>
        <p style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</p>
      </div>
    )
  }

  const generatePortalToken = async () => {
    if (portalToken && !confirm('Generate a new token? The old store-portal link will stop working.')) return
    // Deactivate existing tokens for this store, then insert a new one.
    if (portalToken) {
      await supabase.from('store_portal_tokens').update({ active: false }).eq('store_id', storeId)
    }
    const newToken = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const { data, error } = await supabase
      .from('store_portal_tokens')
      .insert({ store_id: storeId, token: newToken, active: true })
      .select('id, token, active')
      .single()
    if (error) { alert('Error: ' + error.message); return }
    setPortalToken(data)
  }

  const portalUrl = portalToken
    ? (process.env.NEXT_PUBLIC_BOOKING_BASE_URL
        || (typeof window !== 'undefined' ? window.location.origin : 'https://beb-portal-v2.vercel.app'))
      + `/store-portal/${portalToken.token}`
    : ''

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
        Customer Booking Configuration
        <AutosaveIndicator status={configStatus === 'idle' ? brandingStatus : configStatus} />
      </div>

      {/* Brand colors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="field">
          <label className="fl">Primary color (header)</label>
          <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
            style={{ width: '100%', height: 40, padding: 2 }} />
        </div>
        <div className="field">
          <label className="fl">Secondary color (background)</label>
          <input type="color" value={secondary} onChange={e => setSecondary(e.target.value)}
            style={{ width: '100%', height: 40, padding: 2 }} />
        </div>
      </div>

      {/* Timezone */}
      <div className="field" style={{ marginBottom: 16 }}>
        <label className="fl">Store timezone</label>
        <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ width: '100%' }}>
          {TIMEZONE_OPTIONS.map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Used by the reminder cron — appointment times are interpreted as this timezone.
        </p>
      </div>

      {/* Hours per day */}
      <div style={{ marginBottom: 16 }}>
        <label className="fl" style={{ display: 'block', marginBottom: 8 }}>Hours per event day</label>
        {[1, 2, 3].map(n => {
          const startKey = `day${n}_start` as keyof BookingConfigState
          const endKey = `day${n}_end` as keyof BookingConfigState
          return (
            <div key={n} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 8,
              alignItems: 'center', marginBottom: 6,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Day {n}</span>
              <input type="time" value={config[startKey] as string}
                onChange={e => setConfig(p => p && ({ ...p, [startKey]: e.target.value }))} />
              <input type="time" value={config[endKey] as string}
                onChange={e => setConfig(p => p && ({ ...p, [endKey]: e.target.value }))} />
            </div>
          )
        })}
        <p style={{ fontSize: 11, color: 'var(--mist)' }}>Leave blank for days that have no appointments.</p>
      </div>

      {/* Slot config */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="field">
          <label className="fl">Slot interval (minutes)</label>
          <input type="number" min={5} max={120} step={5}
            value={config.slot_interval_minutes}
            onChange={e => setConfig(p => p && ({ ...p, slot_interval_minutes: Number(e.target.value) || 20 }))} />
        </div>
        <div className="field">
          <label className="fl">Max appointments per slot</label>
          <input type="number" min={1} max={20}
            value={config.max_concurrent_slots}
            onChange={e => setConfig(p => p && ({ ...p, max_concurrent_slots: Number(e.target.value) || 1 }))} />
        </div>
      </div>

      {/* Dropdown options */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="fl">"What are you bringing?" options (one per line)</label>
        <textarea rows={4} value={config.items_options.join('\n')}
          style={{ resize: 'vertical' }}
          onChange={e => setConfig(p => p && ({
            ...p,
            items_options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
          }))} />
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <label className="fl">"How did you hear about us?" options (one per line)</label>
        <textarea rows={4} value={config.hear_about_options.join('\n')}
          style={{ resize: 'vertical' }}
          onChange={e => setConfig(p => p && ({
            ...p,
            hear_about_options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
          }))} />
      </div>

      {/* Hot show alert */}
      <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 8 }}>
          Hot Show Alert
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'end' }}>
          <div className="field">
            <label className="fl">Threshold (% booked)</label>
            <input type="number" min={1} max={100} value={config.hot_show_threshold}
              onChange={e => setConfig(p => p && ({ ...p, hot_show_threshold: Number(e.target.value) || 80 }))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8 }}>
            <input type="checkbox" checked={config.hot_show_notify_sms}
              onChange={e => setConfig(p => p && ({ ...p, hot_show_notify_sms: e.target.checked }))} />
            SMS
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8 }}>
            <input type="checkbox" checked={config.hot_show_notify_email}
              onChange={e => setConfig(p => p && ({ ...p, hot_show_notify_email: e.target.checked }))} />
            Email
          </label>
        </div>
      </div>

      {/* Store-portal access token */}
      <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 4 }}>
          Store Portal Access
        </div>
        <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 10 }}>
          A shared link store staff can use to view and add appointments. Anyone with the link can use the portal — rotate the token if it leaks.
        </p>
        {portalToken ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: 12, background: 'white', border: '1px solid var(--pearl)',
            borderRadius: 'var(--r)', marginBottom: 8,
          }}>
            <div style={{ background: 'white', padding: 4, borderRadius: 6 }}>
              <QRCodeSVG value={portalUrl} size={88} includeMargin={false} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)', marginBottom: 2 }}>
                STAFF PORTAL URL
              </div>
              <a href={portalUrl} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: 'var(--green)', wordBreak: 'break-all' }}>
                {portalUrl}
              </a>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 8 }}>
            No active token. Click below to generate one.
          </p>
        )}
        <button onClick={generatePortalToken} className="btn-primary btn-sm">
          {portalToken ? 'Rotate token' : 'Generate access token'}
        </button>
      </div>
    </div>
  )
}
