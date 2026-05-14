'use client'

// Per-event review pile workspace for white-sheet OCR.
//
// Opens from the Hub launcher (via WhiteSheetUploadModal's
// "X pages need review" link) or directly via prop. Renders as a
// FullscreenWorkspace with:
//   - Left sidebar: every needs_review / errored page for this
//     event, grouped by upload, with the active selection
//     highlighted. Counts at the top.
//   - Right pane: WhiteSheetPageDetail for the selected page.
//
// On a successful resolve (confirm or promote), the resolved page
// drops out of the list, the workspace auto-advances to the next
// unresolved page, and when the list goes empty it shows an "all
// clear" celebration state.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import FullscreenWorkspace from '@/components/ui/FullscreenWorkspace'
import WhiteSheetPageDetail from './WhiteSheetPageDetail'
import type { Event, WhiteSheetPage } from '@/types'

interface Props {
  event: Event
  onClose: () => void
}

interface BuyerCheckSummary {
  id: string
  amount: number | null
  check_number: string | null
  buy_form_number: string | null
  day_number: number | null
  payment_type: string | null
  commission_rate: number | null
}
interface UploadSummary {
  id: string
  original_filename: string | null
  status: string
  pages_total: number
  pages_in_review: number
  pages_auto_committed: number
  pages_errored: number
  created_at: string
}

export default function WhiteSheetReviewPile({ event, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<WhiteSheetPage[]>([])
  const [checksById, setChecksById] = useState<Record<string, BuyerCheckSummary>>({})
  const [uploadsById, setUploadsById] = useState<Record<string, UploadSummary>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadPages = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch(`/api/white-sheets/pages?event_id=${event.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `${res.status}`)
      const fetched = (json.pages || []) as WhiteSheetPage[]
      setPages(fetched)
      setChecksById(json.checks_by_id || {})
      setUploadsById(json.uploads_by_id || {})
      // Maintain selection across reloads when possible; otherwise
      // jump to the first page.
      setSelectedId(prev => {
        if (prev && fetched.some(p => p.id === prev)) return prev
        return fetched[0]?.id || null
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load review pile')
    } finally {
      setLoading(false)
    }
  }, [event.id])

  useEffect(() => { loadPages() }, [loadPages])

  const selectedPage = useMemo(
    () => pages.find(p => p.id === selectedId) || null,
    [pages, selectedId],
  )
  const selectedCheck = selectedPage?.buyer_check_id ? checksById[selectedPage.buyer_check_id] : null

  // Assigned workers feed the buyer-initials buttons in the detail
  // view. Falls back to an empty list if the event has no workers
  // (rare — guarded against in the UI).
  const assignedWorkers = useMemo(() => {
    const ws = event.workers || []
    return ws.filter(w => !w.deleted).map(w => ({ id: w.id, name: w.name }))
  }, [event.workers])

  const eventDayCount = useMemo(
    () => Math.max(1, (event.days || []).length),
    [event.days],
  )

  function handleResolved(pageId: string) {
    // Drop the resolved page out of state immediately + advance
    // selection to the next one. A background reload keeps counts
    // accurate against any concurrent worker activity.
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === pageId)
      const next = prev.filter(p => p.id !== pageId)
      // Move selection to the same index (now the next page) or
      // the previous one if we resolved the last in the list.
      const nextSelected = next[idx] || next[idx - 1] || null
      setSelectedId(nextSelected ? nextSelected.id : null)
      return next
    })
    loadPages()
  }

  // Group pages by upload for the sidebar list.
  const groups = useMemo(() => {
    const m = new Map<string, WhiteSheetPage[]>()
    for (const p of pages) {
      const k = p.upload_id
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return Array.from(m.entries()).map(([uploadId, ps]) => ({
      upload: uploadsById[uploadId],
      pages: ps,
    }))
  }, [pages, uploadsById])

  return (
    <FullscreenWorkspace
      title={<>📋 White Sheet Review · {event.store_name}</>}
      subtitle={<>
        {loading ? 'Loading…' :
          pages.length === 0
            ? 'All pages resolved — close to return to the event.'
            : <>{pages.length} page{pages.length === 1 ? '' : 's'} to review</>}
      </>}
      onClose={onClose}
    >
      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12,
          background: '#FEE2E2', color: '#991B1B',
          borderRadius: 8, fontSize: 13, fontWeight: 700,
        }}>⚠ {error}</div>
      )}

      {!loading && pages.length === 0 && !error && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Review pile is empty</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Every page has been auto-committed or resolved.</div>
        </div>
      )}

      {pages.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr',
          gap: 14, height: 'calc(100vh - 120px)',
        }}>
          {/* SIDEBAR */}
          <div style={{
            background: '#fff', borderRadius: 10,
            border: '1px solid var(--pearl)',
            overflow: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            {groups.map(g => (
              <div key={g.upload?.id || 'orphan'}>
                <div style={{
                  padding: '8px 12px',
                  background: 'var(--cream2)',
                  borderBottom: '1px solid var(--pearl)',
                  fontSize: 10, fontWeight: 800, color: 'var(--ash)',
                  textTransform: 'uppercase', letterSpacing: '.04em',
                }}>
                  {g.upload?.original_filename || 'Upload'}
                  {g.upload && (
                    <span style={{ fontWeight: 600, color: 'var(--mist)', marginLeft: 6 }}>
                      · {g.pages.length} of {g.upload.pages_total} pending
                    </span>
                  )}
                </div>
                {g.pages.map(p => {
                  const isActive = p.id === selectedId
                  const reasonCount = (p.review_reasons || []).length
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px',
                        background: isActive ? 'var(--green-pale)' : 'transparent',
                        borderLeft: '3px solid',
                        borderLeftColor: isActive ? 'var(--green)' : 'transparent',
                        borderTop: 'none', borderRight: 'none', borderBottom: '1px solid var(--cream2)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)' }}>
                          Page {p.page_number}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)' }}>
                          {p.status === 'errored' ? '⚠' : `${reasonCount} flag${reasonCount === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                        {(p as any).buy_form_number_ocr || '— no form #'}
                        {p.amount_ocr ? ` · $${p.amount_ocr}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* DETAIL */}
          <div style={{ minWidth: 0 }}>
            {selectedPage ? (
              <WhiteSheetPageDetail
                key={selectedPage.id}
                page={selectedPage}
                buyer_check={selectedCheck || null}
                assignedWorkers={assignedWorkers}
                eventDayCount={eventDayCount}
                onResolved={handleResolved}
              />
            ) : (
              <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                Pick a page from the left to start reviewing.
              </div>
            )}
          </div>
        </div>
      )}
    </FullscreenWorkspace>
  )
}
