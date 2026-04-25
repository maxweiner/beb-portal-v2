'use client'

// Standalone "Store Portal Access" card. Lives at the top of the
// per-store settings panel (above the Customer Booking URL & QR Codes
// section). Owns the active store_portal_tokens row + the generate /
// rotate flow + the QR/link display. Extracted from BookingConfigCard
// so its order on the page is independent of the booking config block.

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'

interface StorePortalToken {
  id: string
  token: string
  active: boolean
}

export default function StorePortalAccessCard({ storeId }: { storeId: string }) {
  const [portalToken, setPortalToken] = useState<StorePortalToken | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.from('store_portal_tokens')
      .select('id, token, active')
      .eq('store_id', storeId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setPortalToken(data || null)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [storeId])

  const generatePortalToken = async () => {
    if (portalToken && !confirm('Generate a new token? The old store-portal link will stop working.')) return
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

  // Append ?add=1 so the QR / link lands directly on the Add Appointment
  // modal — staff can still get to the appointments list by removing the
  // query string or by closing the modal once it loads.
  const portalUrl = portalToken
    ? (process.env.NEXT_PUBLIC_BOOKING_BASE_URL
        || (typeof window !== 'undefined' ? window.location.origin : 'https://beb-portal-v2.vercel.app'))
      + `/store-portal/${portalToken.token}?add=1`
    : ''

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title">Store Portal Access</div>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>
        A shared link store staff can use to view and add appointments. Anyone with the link can use the portal — rotate the token if it leaks.
      </p>
      {!loaded ? (
        <p style={{ fontSize: 13, color: 'var(--mist)' }}>Loading…</p>
      ) : portalToken ? (
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
      <button onClick={generatePortalToken} className="btn-primary btn-sm" disabled={!loaded}>
        {portalToken ? 'Rotate token' : 'Generate access token'}
      </button>
    </div>
  )
}
