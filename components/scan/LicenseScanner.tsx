'use client'

import { useState, useRef, useEffect } from 'react'
import { parseAAMVABarcode, isValidParsedLicense, type ParsedLicense } from '@/lib/aamva-parser'
import { decodePDF417FromImageData, decodePDF417FromBlob, type ScanResult } from '@/lib/barcodeScanner'
import { compressLicensePhoto, dataURLtoBlob, uploadLicensePhoto } from '@/lib/licensePhotoUtils'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

type Step = 'scan-back' | 'photo-front' | 'review' | 'saving' | 'done' | 'error'

interface LicenseScannerProps {
  eventId: string
  onClose: () => void
  onComplete?: (intakeId: string) => void
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

export default function LicenseScanner({ eventId, onClose, onComplete }: LicenseScannerProps) {
  const { user, brand } = useApp()
  const [step, setStep] = useState<Step>('scan-back')
  const [parsed, setParsed] = useState<ParsedLicense | null>(null)
  const [frontPhoto, setFrontPhoto] = useState<Blob | null>(null)
  const [frontPreview, setFrontPreview] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [scanAttempts, setScanAttempts] = useState(0)
  const [wasmLoaded, setWasmLoaded] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [lastScanInfo, setLastScanInfo] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const frontFileRef = useRef<HTMLInputElement>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const scanningRef = useRef(false) // prevent overlapping scans

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        if (mountedRef.current) {
          setCameraReady(true)
          startScanning()
        }
      }
    } catch {
      if (mountedRef.current) setCameraError(true)
    }
  }

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
    scanningRef.current = false
  }

  useEffect(() => {
    if (step === 'scan-back') {
      startCamera()
      return () => stopCamera()
    }
  }, [step])

  // ─── Process a scan result ───
  const processScanResult = (result: ScanResult) => {
    // Privacy: never display/log raw text — only format + length
    setLastScanInfo(`Found ${result.format} (${result.text.length} chars)`)

    // Try to parse as AAMVA
    const license = parseAAMVABarcode(result.text)
    const validation = isValidParsedLicense(license)

    if (validation.valid) {
      stopCamera()
      setParsed(license)
      setStep('photo-front')
    } else {
      // In debug mode, show what we got
      if (debugMode) {
        setLastScanInfo(`${result.format} (${result.text.length}ch) — missing: ${validation.missing.join(', ')} — parsed ${license.rawFieldCount} fields`)
      }
      setScanAttempts(prev => prev + 1)
    }
  }

  // ─── Continuous scanning ───
  const startScanning = () => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)

    scanIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !mountedRef.current) return
      if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) return
      if (scanningRef.current) return // skip if previous scan still running
      
      scanningRef.current = true

      const canvas = canvasRef.current
      const video = videoRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const result = await decodePDF417FromImageData(imageData, debugMode)

      scanningRef.current = false
      if (!mountedRef.current) return

      if (!wasmLoaded) setWasmLoaded(true)

      if (result) {
        processScanResult(result)
      } else {
        setScanAttempts(prev => prev + 1)
      }
    }, 400) // slightly faster interval
  }

  // Restart scanning when debug mode toggles (to pick up new options)
  useEffect(() => {
    if (step === 'scan-back' && cameraReady) {
      startScanning()
    }
  }, [debugMode])

  // ─── File upload fallback ───
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')

    try {
      const result = await decodePDF417FromBlob(file, debugMode)
      if (!wasmLoaded) setWasmLoaded(true)

      if (result) {
        processScanResult(result)
      } else {
        setError('No barcode found in image. Make sure the back of the license is clearly visible and well-lit.')
      }
    } catch {
      setError('Could not process image. Try a clearer photo.')
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Front photo ───
  useEffect(() => {
    if (step === 'photo-front') {
      setCameraError(false)
      ;(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
          })
          if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            await videoRef.current.play()
          }
        } catch {
          if (mountedRef.current) setCameraError(true)
        }
      })()
      return () => stopCamera()
    }
  }, [step])

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const video = videoRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const blob = dataURLtoBlob(dataUrl)
    setFrontPhoto(blob)
    setFrontPreview(dataUrl)
    stopCamera()
    setStep('review')
  }

  const handleFrontFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await compressLicensePhoto(file)
      setFrontPhoto(compressed)
      setFrontPreview(URL.createObjectURL(compressed))
      stopCamera()
      setStep('review')
    } catch {
      setError('Failed to process photo.')
    }
  }

  // ─── Save ───
  const handleSubmit = async () => {
    if (!parsed || !user) return
    if (!parsed.isOver18) { setError('Customer must be 18 or older to sell jewelry.'); return }

    setSaving(true)
    setStep('saving')

    try {
      await supabase.auth.refreshSession()
      const { data: intake, error: insertError } = await supabase
        .from('customer_intakes')
        .insert({
          event_id: eventId, buyer_id: user.id,
          first_name: parsed.firstName, last_name: parsed.lastName,
          date_of_birth: parsed.dateOfBirth || null,
          address_line1: parsed.address.street, address_city: parsed.address.city,
          address_state: parsed.address.state, address_zip: parsed.address.zip,
          license_number: parsed.licenseNumber, license_state: parsed.licenseState,
          license_expiration: parsed.expirationDate || null,
          sex: parsed.sex, eye_color: parsed.eyeColor, height: parsed.height,
          is_over_18: parsed.isOver18, scanned_at: new Date().toISOString(), brand: brand,
        })
        .select().single()

      if (insertError) throw insertError

      if (frontPhoto && intake) {
        try {
          const photoUrl = await uploadLicensePhoto(frontPhoto, eventId, intake.id)
          const expiresAt = new Date()
          expiresAt.setFullYear(expiresAt.getFullYear() + 3)
          await supabase.from('customer_intakes').update({
            license_photo_url: photoUrl, photo_expires_at: expiresAt.toISOString(),
          }).eq('id', intake.id)
        } catch { /* photo failed — non-fatal */ }
      }

      setStep('done')
      onComplete?.(intake.id)
    } catch (err) {
      setError((err as Error).message || 'Failed to save.')
      setStep('error')
    } finally { setSaving(false) }
  }

  const updateField = (field: string, value: string) => {
    if (!parsed) return
    setParsed(prev => {
      if (!prev) return prev
      if (field.startsWith('address.')) {
        const key = field.split('.')[1] as keyof typeof prev.address
        return { ...prev, address: { ...prev.address, [key]: value } }
      }
      return { ...prev, [field]: value }
    })
  }

  const stepIndex = ['scan-back', 'photo-front', 'review', 'saving', 'done'].indexOf(step)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes scanLine { 0%,100% { top: 10% } 50% { top: 85% } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', paddingTop: 'max(env(safe-area-inset-top), 12px)',
        background: 'rgba(0,0,0,.9)', borderBottom: '1px solid rgba(255,255,255,.1)',
      }}>
        <button onClick={() => { stopCamera(); onClose() }} style={{
          background: 'none', border: 'none', color: '#fff',
          fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '4px 8px',
        }}>← Back</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {step === 'scan-back' && 'Scan Back of ID'}
          {step === 'photo-front' && 'Photo Front of ID'}
          {step === 'review' && 'Review & Submit'}
          {step === 'saving' && 'Saving…'}
          {step === 'done' && 'Complete'}
          {step === 'error' && 'Error'}
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'rgba(0,0,0,.8)' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: stepIndex >= i ? 'var(--green, #7EC8A0)' : 'rgba(255,255,255,.15)',
            transition: 'background .3s',
          }} />
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* ── STEP 1: Scan barcode ── */}
        {step === 'scan-back' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video ref={videoRef} playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraError ? 'none' : 'block' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Targeting overlay */}
              {!cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{
                    width: '85%', maxWidth: 360, aspectRatio: '1.586/1',
                    border: '2px solid rgba(126,200,160,.6)', borderRadius: 12,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,.5)', position: 'relative',
                  }}>
                    {[
                      { top: -2, left: -2, borderTop: '3px solid #7EC8A0', borderLeft: '3px solid #7EC8A0', borderTopLeftRadius: 12 },
                      { top: -2, right: -2, borderTop: '3px solid #7EC8A0', borderRight: '3px solid #7EC8A0', borderTopRightRadius: 12 },
                      { bottom: -2, left: -2, borderBottom: '3px solid #7EC8A0', borderLeft: '3px solid #7EC8A0', borderBottomLeftRadius: 12 },
                      { bottom: -2, right: -2, borderBottom: '3px solid #7EC8A0', borderRight: '3px solid #7EC8A0', borderBottomRightRadius: 12 },
                    ].map((s, i) => <div key={i} style={{ position: 'absolute', width: 24, height: 24, ...s } as any} />)}

                    <div style={{
                      position: 'absolute', left: 8, right: 8, height: 2,
                      background: 'rgba(126,200,160,.5)',
                      animation: 'scanLine 2s ease-in-out infinite',
                    }} />

                    <div style={{
                      position: 'absolute', bottom: -36, left: 0, right: 0,
                      textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.8)',
                    }}>
                      Align barcode on back of ID
                    </div>
                  </div>
                </div>
              )}

              {/* Status panel */}
              {!cameraError && (
                <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,.7)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: cameraReady ? '#22C55E' : '#F59E0B', animation: cameraReady ? 'none' : 'pulse 1s infinite' }} />
                    {cameraReady ? 'Camera ready' : 'Starting camera…'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,.7)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: wasmLoaded ? '#22C55E' : '#F59E0B', animation: wasmLoaded ? 'none' : 'pulse 1s infinite' }} />
                    {wasmLoaded ? 'Scanner ready' : 'Loading scanner…'}
                  </div>
                  {scanAttempts > 0 && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                      Frames scanned: {scanAttempts}
                    </div>
                  )}
                  {debugMode && lastScanInfo && (
                    <div style={{ fontSize: 11, color: '#FCD34D', maxWidth: 240, wordBreak: 'break-word' }}>
                      {lastScanInfo}
                    </div>
                  )}
                </div>
              )}

              {/* Debug mode toggle */}
              {!cameraError && (
                <button onClick={() => setDebugMode(d => !d)} style={{
                  position: 'absolute', top: 12, right: 12,
                  background: debugMode ? 'rgba(250,204,21,.2)' : 'rgba(255,255,255,.1)',
                  border: `1px solid ${debugMode ? 'rgba(250,204,21,.4)' : 'rgba(255,255,255,.2)'}`,
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                  color: debugMode ? '#FCD34D' : 'rgba(255,255,255,.5)', cursor: 'pointer',
                }}>
                  {debugMode ? '🔍 DEBUG ON' : '🔍'}
                </button>
              )}

              {cameraError && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
                  <div style={{ fontSize: 48 }}>📷</div>
                  <div style={{ fontSize: 16, fontWeight: 700, textAlign: 'center' }}>Camera not available</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', textAlign: 'center' }}>
                    Upload a photo of the back of the license instead
                  </div>
                </div>
              )}
            </div>

            {/* Bottom controls */}
            <div style={{
              padding: '16px', paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
              background: 'rgba(0,0,0,.9)', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(220,38,38,.15)', border: '1px solid rgba(220,38,38,.3)',
                  fontSize: 13, color: '#FCA5A5', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                }}>
                  <span>{error}</span>
                  <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>×</button>
                </div>
              )}

              {scanAttempts > 30 && !cameraError && (
                <div style={{
                  padding: '8px 14px', borderRadius: 8,
                  background: 'rgba(217,119,6,.15)', border: '1px solid rgba(217,119,6,.3)',
                  fontSize: 12, color: '#FCD34D',
                }}>
                  Having trouble? Try: hold ID 6-8 inches away, tilt to reduce glare, or tap Upload below.
                  {!debugMode && ' Tap 🔍 for debug info.'}
                </div>
              )}

              <button onClick={() => fileInputRef.current?.click()} style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                📁 Upload Photo Instead
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
          </div>
        )}

        {/* ── STEP 2: Front photo ── */}
        {step === 'photo-front' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video ref={videoRef} playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraError ? 'none' : 'block' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {!cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{
                    width: '85%', maxWidth: 360, aspectRatio: '1.586/1',
                    border: '2px solid rgba(59,130,246,.6)', borderRadius: 12,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,.4)',
                  }}>
                    <div style={{
                      position: 'absolute', bottom: -36, left: 0, right: 0,
                      textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.8)',
                    }}>Position front of ID in frame</div>
                  </div>
                </div>
              )}

              {cameraError && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
                  <div style={{ fontSize: 48 }}>📷</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Upload front of ID photo</div>
                </div>
              )}
            </div>

            <div style={{
              padding: '16px', paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
              background: 'rgba(0,0,0,.9)', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {!cameraError && (
                  <button onClick={capturePhoto} style={{
                    flex: 2, padding: '14px', borderRadius: 10,
                    background: '#3B82F6', border: 'none',
                    color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  }}>📸 Capture Photo</button>
                )}
                <button onClick={() => frontFileRef.current?.click()} style={{
                  flex: 1, padding: '14px', borderRadius: 10,
                  background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>📁 Upload</button>
                <input ref={frontFileRef} type="file" accept="image/*" capture="environment"
                  style={{ display: 'none' }} onChange={handleFrontFileUpload} />
              </div>
              <button onClick={() => setStep('review')} style={{
                padding: '10px', background: 'none', border: 'none',
                color: 'rgba(255,255,255,.4)', fontSize: 13, cursor: 'pointer',
              }}>Skip photo →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Review ── */}
        {step === 'review' && parsed && (
          <div style={{ padding: 16, paddingBottom: 120, animation: 'fadeIn .3s ease' }}>
            <div style={{
              padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              background: parsed.isOver18 ? 'rgba(34,197,94,.12)' : 'rgba(220,38,38,.12)',
              border: `1px solid ${parsed.isOver18 ? 'rgba(34,197,94,.25)' : 'rgba(220,38,38,.25)'}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 24 }}>{parsed.isOver18 ? '✅' : '🚫'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: parsed.isOver18 ? '#86EFAC' : '#FCA5A5' }}>
                  {parsed.isOver18 ? 'Age Verified — 18+' : 'UNDER 18 — Cannot Proceed'}
                </div>
                {parsed.dateOfBirth && (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>DOB: {parsed.dateOfBirth}</div>
                )}
              </div>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.25)', fontSize: 13, color: '#FCA5A5' }}>{error}</div>
            )}

            {frontPreview && (
              <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}>
                <img src={frontPreview} alt="Front of ID" style={{ width: '100%', display: 'block' }} />
                <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.04)', fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                  Front of ID — retained for 3 years per compliance
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ReviewField label="First Name" value={parsed.firstName} onChange={v => updateField('firstName', v)} />
              <ReviewField label="Middle Name" value={parsed.middleName} onChange={v => updateField('middleName', v)} />
              <ReviewField label="Last Name" value={parsed.lastName} onChange={v => updateField('lastName', v)} />
              <ReviewField label="Date of Birth" value={parsed.dateOfBirth} onChange={v => updateField('dateOfBirth', v)} />
              <ReviewField label="Street Address" value={parsed.address.street} onChange={v => updateField('address.street', v)} />
              <ReviewField label="City" value={parsed.address.city} onChange={v => updateField('address.city', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ReviewField label="State" value={parsed.address.state} onChange={v => updateField('address.state', v)} />
                <ReviewField label="ZIP" value={parsed.address.zip} onChange={v => updateField('address.zip', v)} />
              </div>
              <ReviewField label="License #" value={parsed.licenseNumber} onChange={v => updateField('licenseNumber', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ReviewField label="License State" value={parsed.licenseState} onChange={v => updateField('licenseState', v)} />
                <ReviewField label="Expiration" value={parsed.expirationDate} onChange={v => updateField('expirationDate', v)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <ReviewField label="Sex" value={parsed.sex} onChange={v => updateField('sex', v)} />
                <ReviewField label="Eyes" value={parsed.eyeColor} onChange={v => updateField('eyeColor', v)} />
                <ReviewField label="Height" value={parsed.height} onChange={v => updateField('height', v)} />
              </div>
            </div>

            <div style={{
              position: 'fixed', bottom: 0, left: 0, right: 0,
              padding: '12px 16px', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
              background: 'rgba(0,0,0,.95)', borderTop: '1px solid rgba(255,255,255,.1)',
              display: 'flex', gap: 10,
            }}>
              <button onClick={() => {
                setStep('scan-back'); setParsed(null); setFrontPhoto(null)
                setFrontPreview(''); setError(''); setScanAttempts(0); setLastScanInfo('')
              }} style={{
                flex: 1, padding: '14px', borderRadius: 10,
                background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Re-scan</button>
              <button onClick={handleSubmit} disabled={!parsed.isOver18} style={{
                flex: 2, padding: '14px', borderRadius: 10,
                background: parsed.isOver18 ? 'var(--green, #1e5c3a)' : 'rgba(255,255,255,.08)',
                border: 'none', color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: parsed.isOver18 ? 'pointer' : 'not-allowed',
                opacity: parsed.isOver18 ? 1 : 0.5,
              }}>✓ Save Intake</button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, border: '4px solid rgba(255,255,255,.15)', borderTopColor: '#7EC8A0', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>Saving intake record…</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, animation: 'fadeIn .3s ease' }}>
            <div style={{ fontSize: 64 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Intake Saved</div>
            {parsed && <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)' }}>{parsed.firstName} {parsed.lastName}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, width: '100%', maxWidth: 320 }}>
              <button onClick={() => {
                setParsed(null); setFrontPhoto(null); setFrontPreview('')
                setError(''); setScanAttempts(0); setCameraError(false)
                setWasmLoaded(false); setCameraReady(false); setLastScanInfo('')
                setStep('scan-back')
              }} style={{
                flex: 1, padding: '14px', borderRadius: 10,
                background: 'var(--green, #1e5c3a)', border: 'none',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Scan Another</button>
              <button onClick={onClose} style={{
                flex: 1, padding: '14px', borderRadius: 10,
                background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Done</button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <div style={{ fontSize: 64 }}>❌</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
            <div style={{ fontSize: 14, color: '#FCA5A5', textAlign: 'center' }}>{error}</div>
            <button onClick={() => { setError(''); setStep('review') }} style={{
              padding: '14px 32px', borderRadius: 10, marginTop: 8,
              background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>← Back to Review</button>
          </div>
        )}
      </div>
    </div>
  )
}
