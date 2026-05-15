'use client'

// Read-only inventory detail viewer for the mobile module. Opens
// from a row tap on MobileInventoryView. Shows everything the
// operator needs at a trade show — photos, the price stack
// (cost / wholesale / retail), specs by category, current
// status / location / memo info.
//
// Edits intentionally NOT supported on mobile v1 — flip to
// desktop for create / edit / scrap / etc. The detail screen
// gets you "what is this piece and what does it cost" in a few
// scrolls.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { InventoryItem } from '@/types/wholesale'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdCents = (cents: number | null | undefined) => cents == null ? '—' : USD.format(cents / 100)

interface Props {
  item: InventoryItem
  onClose: () => void
}

export default function MobileInventoryDetail({ item, onClose }: Props) {
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [photoIdx, setPhotoIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: photos } = await supabase
        .from('inventory_photos')
        .select('storage_path, sort_order, is_primary')
        .eq('item_id', item.id)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
      if (cancelled || !photos || photos.length === 0) return
      const paths = (photos as any[]).map(p => p.storage_path).filter(Boolean)
      const { data: signed } = await supabase.storage
        .from('wholesale-photos')
        .createSignedUrls(paths, 60 * 60)
      if (cancelled || !signed) return
      const urls = (signed as any[]).map(s => s.signedUrl).filter(Boolean)
      setPhotoUrls(urls)
    })()
    return () => { cancelled = true }
  }, [item.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prior
    }
  }, [onClose])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#fff',
      display: 'flex', flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* Sticky header with close + stock # */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#fff',
        padding: '10px 14px',
        borderBottom: '1px solid var(--pearl)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, color: 'var(--ink)', lineHeight: 1,
            padding: 4,
          }}
        >←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {item.category || 'Item'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)' }}>#{item.item_number}</div>
        </div>
      </div>

      {/* Photo carousel */}
      <div style={{ background: 'var(--cream2)', position: 'relative' }}>
        {photoUrls.length === 0 ? (
          <div style={{
            height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--mist)', fontSize: 40,
          }}>
            💎
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrls[photoIdx]}
              alt=""
              style={{ width: '100%', height: 320, objectFit: 'contain', background: 'var(--cream2)', display: 'block' }}
            />
            {photoUrls.length > 1 && (
              <div style={{
                position: 'absolute', bottom: 8, left: 0, right: 0,
                display: 'flex', justifyContent: 'center', gap: 4,
              }}>
                {photoUrls.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPhotoIdx(i)}
                    aria-label={`Photo ${i + 1}`}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      border: 'none', cursor: 'pointer',
                      background: i === photoIdx ? '#fff' : 'rgba(255,255,255,.45)',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Price stack — cost first because the operator's eye lands
          there. Wholesale + Retail below for context. */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
        padding: 14, borderBottom: '1px solid var(--pearl)',
      }}>
        <PriceCell label="Cost"      value={usdCents(item.cost_cents)} accent />
        <PriceCell label="Wholesale" value={usdCents(item.wholesale_price_cents)} />
        <PriceCell label="Retail"    value={usdCents(item.retail_price_cents)} />
      </div>

      {/* Status + vendor row */}
      <div style={{ padding: 14, borderBottom: '1px solid var(--pearl)' }}>
        <Row label="Status"  value={item.status.replace(/_/g, ' ')} />
        {item.vendor_stock_number && <Row label="Vendor stock #" value={item.vendor_stock_number} />}
        {item.alternate_item_number && <Row label="Alt #" value={item.alternate_item_number} />}
        {item.date_acquired && <Row label="Acquired" value={item.date_acquired} />}
        {item.memo_in && <Row label="Memo in" value="Yes (loaned to us)" />}
      </div>

      {/* Category-specific specs */}
      <SpecBlock item={item} />

      {/* Notes */}
      {(item.public_notes || item.internal_notes) && (
        <div style={{ padding: 14, borderBottom: '1px solid var(--pearl)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.public_notes && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Public notes</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{item.public_notes}</div>
            </div>
          )}
          {item.internal_notes && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Internal notes</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{item.internal_notes}</div>
            </div>
          )}
        </div>
      )}

      {/* Edit-on-desktop reminder so the mobile read-only nature
          isn't surprising. */}
      <div style={{ padding: '14px 14px 24px', color: 'var(--mist)', fontSize: 11, textAlign: 'center' }}>
        Read-only view. Edit + photos on desktop.
      </div>
    </div>
  )
}

function PriceCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'var(--green-pale)' : 'var(--cream2)',
      border: accent ? '1px solid var(--green)' : '1px solid var(--pearl)',
      borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: accent ? 18 : 15, fontWeight: 900, color: accent ? 'var(--green-dark)' : 'var(--ink)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--mist)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{value}</span>
    </div>
  )
}

function SpecBlock({ item }: { item: InventoryItem }) {
  const specs: Array<[string, string | number | null | undefined]> = []
  if (item.category === 'jewelry') {
    specs.push(
      ['Type',     item.jewelry_type],
      ['Metal',    [item.jewelry_metal_karat, item.jewelry_metal_color, item.jewelry_metal_type].filter(Boolean).join(' ')],
      ['DWT',      item.jewelry_metal_dwt],
      ['Size',     item.jewelry_size],
      ['Length',   item.jewelry_length],
      ['Hallmarks', item.jewelry_hallmarks],
      ['Designer', item.jewelry_designer],
      ['Period',   item.jewelry_period],
    )
  }
  if (item.category === 'watch') {
    specs.push(
      ['Brand',    item.watch_brand],
      ['Model',    item.watch_model],
      ['Serial',   item.watch_serial_number],
      ['Year',     item.watch_year],
      ['Movement', item.watch_movement_type],
      ['Case',     [item.watch_case_size_mm ? `${item.watch_case_size_mm}mm` : null, item.watch_case_material].filter(Boolean).join(' · ')],
      ['Dial',     item.watch_dial_color],
      ['Band',     item.watch_band_style],
      ['Box/papers', item.watch_box_papers],
      ['Condition', item.watch_condition],
    )
  }
  if (item.category === 'diamond') {
    specs.push(
      ['Shape',     item.diamond_shape],
      ['Carat',     item.diamond_carat],
      ['Color',     item.diamond_color],
      ['Clarity',   item.diamond_clarity],
      ['Cut',       item.diamond_cut],
      ['Polish',    item.diamond_polish],
      ['Symmetry',  item.diamond_symmetry],
      ['Fluor.',    item.diamond_fluorescence],
      ['Lab',       item.diamond_lab_type],
      ['Report #',  item.diamond_report_number],
      ['Measure',   item.diamond_measurements],
    )
  }
  const filled = specs.filter(([, v]) => v != null && v !== '')
  if (filled.length === 0) return null
  return (
    <div style={{ padding: 14, borderBottom: '1px solid var(--pearl)' }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
        Specs
      </div>
      {filled.map(([label, value]) => (
        <Row key={label} label={label} value={String(value)} />
      ))}
    </div>
  )
}
