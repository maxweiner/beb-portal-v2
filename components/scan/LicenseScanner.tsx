'use client'

import { useState, useRef, useEffect } from 'react'
import { parseAAMVABarcode, isValidParsedLicense, type ParsedLicense } from '@/lib/aamva-parser'
import {
  createBarcodeDecoder, getDecoderStrategy, CAMERA_CONSTRAINTS,
  type BarcodeDecoder, type DecoderStrategy,
} from '@/lib/barcode-decoder'
import { compressLicensePhoto, dataURLtoBlob, uploadLicensePhoto } from '@/lib/licensePhotoUtils'
import {
  recordScanAttempt, recordScanSuccess, recordUploadFallback,
  strategyCategory,
} from '@/lib/scan-metrics'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

type Step = 'scan-back' | 'photo-front' | 'review' | 'saving' | 'done' | 'error'

interface LicenseScannerProps {
  eventId: string
  onClose: () => void
  onComplete?: (intakeId: string) => void
}

/** Display helpers — turn nullable fields into safe UI strings. */
const s = (v: string | null) => v ?? ''
const formatHeight = (inches: number | null): string => {
  if (inches == null) return ''
  const ft = Math.floor(inches / 12)
  const i = inches % 12
  return `${ft}'${i}"`
}

function ReviewField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} style={{
        width: '100%', padding: '10px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
        color: '#fff', fontSize: 14, fontFamily: 'inherit', outline: 'none',
      }} />
    </div>
  )
}

/** SHA-256 hex digest of the raw barcode. Used for dedup — NEVER stored raw. */
async function hashBarcode(raw: string): Promise<string> {
  const buf = new TextEncoder().encode(raw)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export default function LicenseScanner({ eventId, onClose, onComplete }: LicenseScannerProps) {
  const { user, brand } = useApp()
  const [step, setStep] = useState<Step>('scan-back')
  const [parsed, setParsed] = useState<ParsedLicense | null>(null)
  const [barcodeHash, setBarcodeHash] = useState<string>('')
  const [frontPhoto, setFrontPhoto] = useState<Blob | null>(null)
  const [frontPreview, setFrontPreview] = useState('')
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [strategy, setStrategy] = useState<DecoderStrategy>('upload-only')
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [showUploadFallback, setShowUploadFallback] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const decoderRef = useRef<BarcodeDecoder | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const frontFileRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanStartedAtRef = useRef<number>(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; teardown() }
  }, [])

  const teardown = () => {
    if (decoderRef.current) { decoderRef.current.stop(); decoderRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (videoRef.current) videoRef.current.srcObject = null
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null }
    setCameraReady(false)
    setTorchOn(false)
  }

  /* ─────────── Step 1: scan back of ID ─────────── */

  const startBackScan = async () => {
    const probed = await getDecoderStrategy()
    if (!mountedRef.current) return
    setStrategy(probed)

    if (probed === 'upload-only') {
      setCameraError(true)
      return
    }

    // Open camera with high-res rear-facing constraints.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    } catch {
      // Some phones reject `advanced: [{ focusMode: 'continuous' }]`. Retry
      // with the simpler constraint set.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
      } catch {
        if (mountedRef.current) setCameraError(true)
        return
      }
    }

    if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
    streamRef.current = stream

    // Torch capability probe
    const track = stream.getVideoTracks()[0]
    const caps = (track.getCapabilities?.() || {}) as any
    setTorchSupported(!!caps.torch)

    if (!videoRef.current) return
    videoRef.current.srcObject = stream
    try { await videoRef.current.play() } catch { /* autoplay policy; user-initiated */ }
    if (!mountedRef.current) return
    setCameraReady(true)

    // Build decoder + start scanning.
    const decoder = await createBarcodeDecoder()
    if (!mountedRef.current) return
    if (!decoder) { setCameraError(true); return }
    decoderRef.current = decoder

    scanStartedAtRef.current = Date.now()
    recordScanAttempt()

    decoder.startScanning(videoRef.current, handleDecoded)

    // 30-second fallback — surface the upload button prominently.
    fallbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setShowUploadFallback(true)
    }, 30_000)
  }

  const handleDecoded = async (raw: string) => {
    if (!mountedRef.current) return
    const elapsed = Date.now() - scanStartedAtRef.current
    const parsedLicense = parseAAMVABarcode(raw)
    const validation = isValidParsedLicense(parsedLicense)

    if (!validation.valid) {
      // Parser couldn't extract required fields — keep scanning. This is a
      // rare case where BarcodeDetector matches a PDF417 that isn't a DL.
      if (decoderRef.current) {
        const current = decoderRef.current
        // Restart scanning on the same decoder instance (it stopped itself).
        if (videoRef.current) current.startScanning(videoRef.current, handleDecoded)
      }
      return
    }

    const hash = await hashBarcode(raw)
    if (!mountedRef.current) return

    recordScanSuccess(strategyCategory(strategy), elapsed)

    // Privacy: `raw` now goes out of scope and is GC-collected. Only the
    // parsed fields + hash are kept in state.
    setParsed(parsedLicense)
    setBarcodeHash(hash)
    teardown()
    setStep('photo-front')
  }

  useEffect(() => {
    if (step === 'scan-back') {
      startBackScan()
      return () => teardown()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  /* ─────────── Torch toggle ─────────── */

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] as any })
      setTorchOn(next)
    } catch {
      // Not supported on this device — quietly ignore.
    }
  }

  /* ─────────── Tap-to-focus ─────────── */

  const handleVideoTap = async (e: React.MouseEvent<HTMLVideoElement>) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const caps = (track.getCapabilities?.() || {}) as any
    const rect = (e.currentTarget as HTMLVideoElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    try {
      const constraints: any = { advanced: [] }
      if (caps.focusMode && (caps.focusMode as string[]).includes('manual')) {
        constraints.advanced.push({ focusMode: 'manual' })
      }
      if (caps.pointsOfInterest) {
        constraints.advanced.push({ pointsOfInterest: [{ x, y }] })
      }
      if (constraints.advanced.length > 0) await track.applyConstraints(constraints)
    } catch {
      // Focus constraints often throw on unsupported devices — safe to ignore.
    }
  }

  /* ─────────── Upload-fallback decode ─────────── */

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    setError('')
    recordUploadFallback()
    recordScanAttempt()
    const startedAt = Date.now()

    // For upload decode, prefer native BarcodeDetector if available (same as
    // live scan strategy). Otherwise fall back to the enhanced zxing path.
    let decoder = decoderRef.current
    if (!decoder) {
      const built = await createBarcodeDecoder()
      if (!built) {
        setError('Barcode decoding is not available in this browser.')
        return
      }
      decoder = built
      decoderRef.current = built
    }

    try {
      const raw = await decoder.decodeImage(file)
      if (!raw) {
        setError('No barcode found. Make sure the back of the license is clearly visible and well-lit.')
        return
      }
      const parsedLicense = parseAAMVABarcode(raw)
      const validation = isValidParsedLicense(parsedLicense)
      if (!validation.valid) {
        setError(`Scanned the barcode but couldn't read: ${validation.missing.join(', ')}. Try a clearer photo.`)
        return
      }
      const hash = await hashBarcode(raw)
      recordScanSuccess('upload', Date.now() - startedAt)
      setParsed(parsedLicense)
      setBarcodeHash(hash)
      teardown()
      setStep('photo-front')
    } catch {
      setError('Could not process image.')
    }
  }

  /* ─────────── Step 2: front photo ─────────── */

  useEffect(() => {
    if (step !== 'photo-front') return
    setCameraError(false)
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (cancelled || !mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        if (!cancelled && mountedRef.current) setCameraError(true)
      }
    })()
    return () => { cancelled = true; teardown() }
  }, [step])

  const capturePhoto = () => {
    if (!videoRef.current) return
    const v = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    const url = canvas.toDataURL('image/jpeg', 0.85)
    setFrontPhoto(dataURLtoBlob(url))
    setFrontPreview(url)
    teardown()
    setStep('review')
  }

  const handleFrontFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await compressLicensePhoto(file)
      setFrontPhoto(compressed)
      setFrontPreview(URL.createObjectURL(compressed))
      teardown()
      setStep('review')
    } catch { setError('Failed to process photo.') }
  }

  /* ─────────── Step 3: review & save ─────────── */

  const updateField = <K extends keyof ParsedLicense>(field: K, value: string) => {
    setParsed(prev => {
      if (!prev) return prev
      return { ...prev, [field]: (value || null) as ParsedLicense[K] }
    })
  }

  const handleSubmit = async () => {
    if (!parsed || !user) return
    if (parsed.isUnder18) { setError('Customer must be 18 or older.'); return }
    setError('')
    setStep('saving')
    try {
      // Dedup: if this event already has this hash, don't create a duplicate.
      const { data: existing } = await supabase.from('customer_intakes')
        .select('id')
        .eq('event_id', eventId)
        .eq('barcode_hash', barcodeHash)
        .maybeSingle()

      if (existing?.id) {
        setError('This ID was already scanned for this event.')
        setStep('error')
        return
      }

      const insertRow: Record<string, any> = {
        event_id: eventId,
        buyer_id: user.id,
        first_name: parsed.firstName,
        middle_name: parsed.middleName,
        last_name: parsed.lastName,
        date_of_birth: parsed.dateOfBirth,
        address_line1: parsed.street,
        address_city: parsed.city,
        address_state: parsed.state,
        address_zip: parsed.zip,
        license_number: parsed.licenseNumber,
        license_state: parsed.licenseState,
        license_expiration: parsed.expirationDate,
        issue_date: parsed.issueDate,
        sex: parsed.sex,
        eye_color: parsed.eyeColor,
        height: formatHeight(parsed.heightInches) || null,
        height_inches: parsed.heightInches,
        country: parsed.country,
        aamva_version: parsed.aamvaVersion,
        barcode_hash: barcodeHash,
        is_over_18: !parsed.isUnder18,
        scanned_at: new Date().toISOString(),
        brand,
      }

      const { data: intake, error: err } = await supabase
        .from('customer_intakes')
        .insert(insertRow)
        .select()
        .single()
      if (err) throw err

      if (frontPhoto && intake) {
        try {
          const photoUrl = await uploadLicensePhoto(frontPhoto, eventId, intake.id)
          const exp = new Date(); exp.setFullYear(exp.getFullYear() + 3)
          await supabase.from('customer_intakes')
            .update({ license_photo_url: photoUrl, photo_expires_at: exp.toISOString() })
            .eq('id', intake.id)
        } catch { /* photo upload is non-fatal */ }
      }

      setStep('done')
      onComplete?.(intake.id)
    } catch (e) {
      setError((e as Error).message || 'Failed to save.')
      setStep('error')
    }
  }

  const resetAll = () => {
    setParsed(null); setBarcodeHash('')
    setFrontPhoto(null); setFrontPreview('')
    setError(''); setCameraError(false); setCameraReady(false)
    setShowUploadFallback(false)
    setStep('scan-back')
  }

  const stepIndex = ['scan-back', 'photo-front', 'review', 'saving', 'done'].indexOf(step)

  /* ─────────── Render ─────────── */

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes scanLine { 0%,100% { top: 10% } 50% { top: 85% } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', paddingTop: 'max(env(safe-area-inset-top), 12px)', background: 'rgba(0,0,0,.9)', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
        <button onClick={() => { teardown(); onClose() }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '4px 8px' }}>← Back</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {step === 'scan-back'   && 'Scan Back of ID'}
          {step === 'photo-front' && 'Photo Front of ID'}
          {step === 'review'      && 'Review & Submit'}
          {step === 'saving'      && 'Saving…'}
          {step === 'done'        && 'Complete'}
          {step === 'error'       && 'Error'}
        </div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'rgba(0,0,0,.8)' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: stepIndex >= i ? 'var(--green, #7EC8A0)' : 'rgba(255,255,255,.15)', transition: 'background .3s' }} />
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* ── STEP 1 ── */}
        {step === 'scan-back' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video
                ref={videoRef}
                playsInline
                muted
                onClick={handleVideoTap}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraError ? 'none' : 'block', cursor: 'crosshair' }}
              />

              {!cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: '90%', maxWidth: 380, aspectRatio: '3/1', border: '2px solid rgba(126,200,160,.6)', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.5)', position: 'relative' }}>
                    {[
                      { top: -2, left: -2, borderTop: '3px solid #7EC8A0', borderLeft: '3px solid #7EC8A0', borderTopLeftRadius: 12 },
                      { top: -2, right: -2, borderTop: '3px solid #7EC8A0', borderRight: '3px solid #7EC8A0', borderTopRightRadius: 12 },
                      { bottom: -2, left: -2, borderBottom: '3px solid #7EC8A0', borderLeft: '3px solid #7EC8A0', borderBottomLeftRadius: 12 },
                      { bottom: -2, right: -2, borderBottom: '3px solid #7EC8A0', borderRight: '3px solid #7EC8A0', borderBottomRightRadius: 12 },
                    ].map((st, i) => <div key={i} style={{ position: 'absolute', width: 24, height: 24, ...st } as any} />)}
                    <div style={{ position: 'absolute', left: 8, right: 8, height: 2, background: 'rgba(126,200,160,.5)', animation: 'scanLine 2s ease-in-out infinite' }} />
                    <div style={{ position: 'absolute', bottom: -36, left: 0, right: 0, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>
                      Align the PDF417 barcode on the back of the ID
                    </div>
                  </div>
                </div>
              )}

              {/* Status + strategy badge */}
              {!cameraError && (
                <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,.7)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: cameraReady ? '#22C55E' : '#F59E0B' }} />
                    {cameraReady ? 'Camera ready' : 'Starting…'}
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                    background: strategy === 'native' ? 'rgba(34,197,94,.18)' : 'rgba(59,130,246,.18)',
                    border: `1px solid ${strategy === 'native' ? 'rgba(34,197,94,.35)' : 'rgba(59,130,246,.35)'}`,
                    color: strategy === 'native' ? '#86EFAC' : '#93C5FD',
                    alignSelf: 'flex-start',
                  }}>
                    {strategy === 'native' ? '⚡ Native scanner' : strategy === 'zxing' ? '🔍 Enhanced scanner' : 'Upload only'}
                  </div>
                </div>
              )}

              {/* Torch toggle */}
              {!cameraError && torchSupported && (
                <button
                  onClick={toggleTorch}
                  aria-label="Toggle flashlight"
                  style={{
                    position: 'absolute', top: 12, right: 12,
                    width: 44, height: 44, borderRadius: '50%',
                    background: torchOn ? 'rgba(250,204,21,.25)' : 'rgba(255,255,255,.1)',
                    border: `1.5px solid ${torchOn ? 'rgba(250,204,21,.6)' : 'rgba(255,255,255,.25)'}`,
                    color: torchOn ? '#FCD34D' : '#fff',
                    fontSize: 20, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  💡
                </button>
              )}

              {cameraError && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
                  <div style={{ fontSize: 48 }}>📷</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Camera not available</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', textAlign: 'center' }}>Upload a photo of the back of the ID instead.</div>
                </div>
              )}
            </div>

            <div style={{ padding: 16, paddingBottom: 'max(env(safe-area-inset-bottom), 16px)', background: 'rgba(0,0,0,.9)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {error && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(220,38,38,.15)', border: '1px solid rgba(220,38,38,.3)', fontSize: 13, color: '#FCA5A5', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{error}</span>
                  <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', fontWeight: 700, marginLeft: 8 }}>×</button>
                </div>
              )}

              {showUploadFallback && !cameraError && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(217,119,6,.15)', border: '1px solid rgba(217,119,6,.35)', fontSize: 12, color: '#FCD34D' }}>
                  Having trouble? Upload a photo below — the native camera app usually focuses better on dense barcodes.
                </div>
              )}

              <button onClick={() => fileInputRef.current?.click()} style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: showUploadFallback ? '#D97706' : 'rgba(255,255,255,.1)',
                border: `1px solid ${showUploadFallback ? 'rgba(217,119,6,.8)' : 'rgba(255,255,255,.2)'}`,
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                transition: 'all .2s',
              }}>📁 {showUploadFallback ? 'Upload Photo Instead' : 'Upload Photo'}</button>

              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 'photo-front' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraError ? 'none' : 'block' }} />
              {!cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: '85%', maxWidth: 360, aspectRatio: '1.586/1', border: '2px solid rgba(59,130,246,.6)', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.4)' }}>
                    <div style={{ position: 'absolute', bottom: -36, left: 0, right: 0, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>Position the front of the ID</div>
                  </div>
                </div>
              )}
              {cameraError && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
                  <div style={{ fontSize: 48 }}>📷</div><div style={{ fontSize: 16, fontWeight: 700 }}>Upload front of ID</div>
                </div>
              )}
            </div>
            <div style={{ padding: 16, paddingBottom: 'max(env(safe-area-inset-bottom), 16px)', background: 'rgba(0,0,0,.9)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {!cameraError && <button onClick={capturePhoto} style={{ flex: 2, padding: '14px', borderRadius: 10, background: '#3B82F6', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>📸 Capture</button>}
                <button onClick={() => frontFileRef.current?.click()} style={{ flex: 1, padding: '14px', borderRadius: 10, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>📁 Upload</button>
                <input ref={frontFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFrontFileUpload} />
              </div>
              <button onClick={() => setStep('review')} style={{ padding: '10px', background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 13, cursor: 'pointer' }}>Skip photo →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 'review' && parsed && (
          <div style={{ padding: 16, paddingBottom: 120, animation: 'fadeIn .3s ease' }}>
            <div style={{
              padding: '12px 16px', borderRadius: 10, marginBottom: 12,
              background: !parsed.isUnder18 ? 'rgba(34,197,94,.12)' : 'rgba(220,38,38,.12)',
              border: `1px solid ${!parsed.isUnder18 ? 'rgba(34,197,94,.25)' : 'rgba(220,38,38,.25)'}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 24 }}>{!parsed.isUnder18 ? '✅' : '🚫'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: !parsed.isUnder18 ? '#86EFAC' : '#FCA5A5' }}>
                  {!parsed.isUnder18 ? 'Age Verified — 18+' : 'UNDER 18 — cannot continue'}
                </div>
                {parsed.dateOfBirth && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>DOB: {parsed.dateOfBirth}</div>}
              </div>
            </div>

            {parsed.isExpired && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                background: 'rgba(217,119,6,.15)', border: '1px solid rgba(217,119,6,.3)',
                fontSize: 12, color: '#FCD34D',
              }}>
                ⚠️ License expired {parsed.expirationDate}. You can still accept this intake; remind the customer to renew.
              </div>
            )}

            {error && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.25)', fontSize: 13, color: '#FCA5A5' }}>{error}</div>}

            {frontPreview && (
              <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}>
                <img src={frontPreview} alt="Front of ID" style={{ width: '100%', display: 'block' }} />
                <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.04)', fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Retained 3 years per compliance</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ReviewField label="First Name"   value={s(parsed.firstName)}    onChange={v => updateField('firstName', v)} />
              <ReviewField label="Middle Name"  value={s(parsed.middleName)}   onChange={v => updateField('middleName', v)} />
              <ReviewField label="Last Name"    value={s(parsed.lastName)}     onChange={v => updateField('lastName', v)} />
              <ReviewField label="Date of Birth" value={s(parsed.dateOfBirth)} onChange={v => updateField('dateOfBirth', v)} />
              <ReviewField label="Street"        value={s(parsed.street)}      onChange={v => updateField('street', v)} />
              <ReviewField label="City"          value={s(parsed.city)}        onChange={v => updateField('city', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ReviewField label="State" value={s(parsed.state)} onChange={v => updateField('state', v)} />
                <ReviewField label="ZIP"   value={s(parsed.zip)}   onChange={v => updateField('zip', v)} />
              </div>
              <ReviewField label="License #" value={s(parsed.licenseNumber)} onChange={v => updateField('licenseNumber', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ReviewField label="License State" value={s(parsed.licenseState)} onChange={v => updateField('licenseState', v)} />
                <ReviewField label="Expiration"    value={s(parsed.expirationDate)} onChange={v => updateField('expirationDate', v)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <ReviewField label="Sex"    value={s(parsed.sex)}          onChange={v => updateField('sex', v.toUpperCase() as any)} />
                <ReviewField label="Eyes"   value={s(parsed.eyeColor)}     onChange={v => updateField('eyeColor', v)} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Height</div>
                  <input
                    value={formatHeight(parsed.heightInches)}
                    readOnly
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
                      color: 'rgba(255,255,255,.7)', fontSize: 14, fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', background: 'rgba(0,0,0,.95)', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', gap: 10 }}>
              <button onClick={resetAll} style={{ flex: 1, padding: '14px', borderRadius: 10, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Re-scan</button>
              <button
                onClick={handleSubmit}
                disabled={parsed.isUnder18}
                style={{
                  flex: 2, padding: '14px', borderRadius: 10,
                  background: !parsed.isUnder18 ? 'var(--green, #1e5c3a)' : 'rgba(255,255,255,.08)',
                  border: 'none', color: '#fff', fontSize: 15, fontWeight: 700,
                  cursor: !parsed.isUnder18 ? 'pointer' : 'not-allowed',
                  opacity: !parsed.isUnder18 ? 1 : 0.5,
                }}>
                ✓ Save Intake
              </button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, border: '4px solid rgba(255,255,255,.15)', borderTopColor: '#7EC8A0', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>Saving…</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, animation: 'fadeIn .3s ease' }}>
            <div style={{ fontSize: 64 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Intake Saved</div>
            {parsed && <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)' }}>{parsed.firstName} {parsed.lastName}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, width: '100%', maxWidth: 320 }}>
              <button onClick={resetAll} style={{ flex: 1, padding: '14px', borderRadius: 10, background: 'var(--green, #1e5c3a)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Scan Another</button>
              <button onClick={onClose} style={{ flex: 1, padding: '14px', borderRadius: 10, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <div style={{ fontSize: 64 }}>❌</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
            <div style={{ fontSize: 14, color: '#FCA5A5', textAlign: 'center' }}>{error}</div>
            <button onClick={() => { setError(''); setStep('review') }} style={{ padding: '14px 32px', borderRadius: 10, marginTop: 8, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
