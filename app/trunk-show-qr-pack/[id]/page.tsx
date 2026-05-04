'use client'

// Printable QR pack for a trunk show — one tile per active
// booking link, branded with the store's logo + primary color.
// Designed for "Print → Save as PDF" so admins can email or
// hand a stack of QRs to the store and each rep grabs the one
// with their name on it.
//
// Auth: SELECT on trunk_show_booking_tokens is gated by RLS
// (admin / superadmin / trunk_admin / partner / assigned rep).
// We rely on RLS to filter — no extra check needed here.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { makeSquareLogoDataUrl } from '@/lib/qr/squareLogo'

interface BookingToken {
  id: string
  token: string
  salesperson_name: string | null
  created_at: string
}

interface ShowInfo {
  id: string
  start_date: string
  end_date: string
  store_name: string
  store: {
    name: string
    city: string | null
    state: string | null
    color_primary: string | null
    color_secondary: string | null
    store_image_url: string | null
  } | null
}

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function TrunkShowQrPackPage() {
  const { id } = useParams() as { id: string }
  const [show, setShow] = useState<ShowInfo | null>(null)
  const [tokens, setTokens] = useState<BookingToken[]>([])
  const [qrLogo, setQrLogo] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: showRow, error: e1 } = await supabase
          .from('trunk_shows')
          .select('id, start_date, end_date, store_id, stores(name, city, state, color_primary, color_secondary, store_image_url)')
          .eq('id', id).maybeSingle()
        if (e1) throw new Error(e1.message)
        if (!showRow) { setError('Trunk show not found.'); setLoaded(true); return }
        const storeRel = (showRow as any).stores
        if (cancelled) return
        const info: ShowInfo = {
          id: showRow.id,
          start_date: showRow.start_date,
          end_date: showRow.end_date,
          store_name: storeRel?.name || '(unknown store)',
          store: storeRel || null,
        }
        setShow(info)

        const { data: toks, error: e2 } = await supabase
          .from('trunk_show_booking_tokens')
          .select('id, token, salesperson_name, created_at')
          .eq('trunk_show_id', id)
          .is('revoked_at', null)
          .order('salesperson_name', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
        if (e2) throw new Error(e2.message)
        if (cancelled) return
        setTokens((toks as BookingToken[]) || [])

        // Build the QR center-logo (store logo letterboxed onto white,
        // or initials on the store's primary color when no logo).
        if (storeRel) {
          try {
            const logo = await makeSquareLogoDataUrl({
              logoUrl: storeRel.store_image_url || null,
              storeName: storeRel.name || 'Store',
              color: storeRel.color_primary || '#1D6B44',
              size: 256,
            })
            if (!cancelled) setQrLogo(logo)
          } catch { /* fine — QR renders without center */ }
        }
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (!loaded) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
  if (error || !show) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#991B1B' }}>{error || 'Not found'}</div>
  )

  const primary = show.store?.color_primary || '#1D6B44'
  const secondary = show.store?.color_secondary || '#F5F0E8'
  const dateRange = show.start_date === show.end_date
    ? fmtDate(show.start_date)
    : `${fmtDate(show.start_date)} – ${fmtDate(show.end_date)}`

  return (
    <>
      <style>{`
        /* Screen view: stack tiles with gaps; show toolbar. Print:
           one tile per page, no toolbar, no background colors. */
        @page { size: letter; margin: 0.5in; }
        @media print {
          .qr-toolbar { display: none !important; }
          body { background: #fff !important; }
          .qr-tile { page-break-after: always; box-shadow: none !important; border: none !important; }
          .qr-tile:last-child { page-break-after: auto; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: '#f1f5f9', paddingBottom: 40 }}>
        <div className="qr-toolbar" style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>QR pack — {show.store_name}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{tokens.length} link{tokens.length === 1 ? '' : 's'} · {dateRange}</div>
          </div>
          <button onClick={() => window.print()}
            style={{ padding: '8px 16px', background: primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            🖨 Print / Save as PDF
          </button>
        </div>

        {tokens.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
            No active booking links. Generate one in the Trunk Customer Bookings panel first.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '24px 16px' }}>
            {tokens.map(tok => {
              const url = `${origin}/trunk-show-book/${tok.token}`
              return (
                <div key={tok.id} className="qr-tile" style={{
                  width: 'min(680px, 100%)',
                  background: '#fff',
                  borderTop: `8px solid ${primary}`,
                  borderRadius: 8,
                  padding: '32px 40px 40px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
                }}>
                  {/* Branded header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, alignSelf: 'stretch' }}>
                    {show.store?.store_image_url ? (
                      <img src={show.store.store_image_url} alt=""
                        style={{ height: 56, maxWidth: 140, objectFit: 'contain', background: '#fff' }} />
                    ) : (
                      <div style={{
                        height: 56, width: 56, borderRadius: 8,
                        background: secondary, color: primary,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, fontWeight: 900,
                      }}>💎</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 900, color: primary, lineHeight: 1.1 }}>
                        {show.store_name}
                      </div>
                      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                        Trunk Show · {dateRange}
                      </div>
                    </div>
                  </div>

                  {/* Salesperson name — the headline */}
                  <div style={{
                    background: secondary, padding: '14px 24px', borderRadius: 999,
                    fontSize: 24, fontWeight: 900, color: primary, textAlign: 'center',
                    minWidth: 280, marginTop: 6,
                  }}>
                    {tok.salesperson_name || 'Untagged link'}
                  </div>

                  {/* QR */}
                  <div style={{ background: '#fff', padding: 12, borderRadius: 8, border: `2px solid ${primary}` }}>
                    <QRCodeSVG
                      value={url}
                      size={280}
                      includeMargin={false}
                      level="H"
                      imageSettings={qrLogo ? {
                        src: qrLogo,
                        height: 280 * 0.22,
                        width: 280 * 0.22,
                        excavate: true,
                      } : undefined}
                    />
                  </div>

                  <div style={{ textAlign: 'center', fontSize: 14, color: '#0f172a', fontWeight: 600 }}>
                    Scan to book your customer's appointment
                  </div>

                  {/* Type-able URL */}
                  <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', wordBreak: 'break-all', maxWidth: 480 }}>
                    or visit:&nbsp;<span style={{ fontFamily: 'ui-monospace, monospace' }}>{url}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
