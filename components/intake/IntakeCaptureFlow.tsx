'use client'

/**
 * Photo-first buy intake capture flow.
 *
 * Step sequence:
 *   1. Buy form #
 *   2. Front of license (live camera, license outline, 5s auto-capture)
 *   3. Back of license (live camera, license outline, 5s auto-capture)
 *   4. Invoice (live camera, "Buy Form" overlay, 5s auto-capture)
 *   5. Jewelry (1..5 photos, file picker)
 *   6. Quick fields (amount, check #, phone, email — commission editable behind a link)
 *   7. Save → customer_intakes row + intake_photos rows + background OCR
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { uploadIntakePhoto } from '@/lib/intake/photoUpload'
import { dedupAndUpsertCustomer } from '@/lib/intake/customerDedup'

type Step =
  | 'form-number'
  | 'photo-front'
  | 'photo-back'
  | 'photo-invoice'
  | 'photo-jewelry'
  | 'quick-fields'
  | 'saving'
  | 'done'
  | 'error'

type CommissionBucket = 'rate_10' | 'rate_5' | 'rate_0' | 'store'

const COMMISSION_OPTIONS: Array<{ key: CommissionBucket; label: string; pct: number | null }> = [
  { key: 'rate_10', label: '10%', pct: 10 },
  { key: 'rate_5',  label: '5%',  pct: 5 },
  { key: 'rate_0',  label: '0%',  pct: 0 },
  { key: 'store',   label: 'Store', pct: null },
]

const MAX_JEWELRY_PHOTOS = 5
const AUTO_CAPTURE_SECONDS = 5

interface Props {
  eventId: string
  onClose: () => void
  onSaved?: (intakeId: string) => void
}

export default function IntakeCaptureFlow({ eventId, onClose, onSaved }: Props) {
  const { user } = useApp()

  const [step, setStep] = useState<Step>('form-number')
  const [error, setError] = useState('')

  // Captured fields
  const [buyFormNumber, setBuyFormNumber] = useState('')
  const [frontPhoto, setFrontPhoto] = useState<Blob | null>(null)
  const [backPhoto, setBackPhoto] = useState<Blob | null>(null)
  const [invoicePhoto, setInvoicePhoto] = useState<Blob | null>(null)
  const [jewelryPhotos, setJewelryPhotos] = useState<Blob[]>([])

  // Quick fields
  const [amount, setAmount] = useState('')
  const [checkNumber, setCheckNumber] = useState('')
  const [commission, setCommission] = useState<CommissionBucket>('rate_10')
  const [showCommissionPicker, setShowCommissionPicker] = useState(false)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')  // raw digits

  async function checkFormNumberAvailable(n: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!/^\d{5}$/.test(n)) return { ok: false, reason: 'Form # must be exactly 5 digits.' }
    const { data, error } = await supabase
      .from('customer_intakes')
      .select('id, event_id')
      .eq('buy_form_number', n)
      .limit(1)
    if (error) return { ok: false, reason: error.message }
    if (data && data.length > 0) {
      return { ok: false, reason: `Form #${n} has already been used. Voided forms are burned forever — check your book.` }
    }
    return { ok: true }
  }

  async function handleFormNumberContinue() {
    setError('')
    const check = await checkFormNumberAvailable(buyFormNumber)
    if (!check.ok) { setError(check.reason); return }
    setStep('photo-front')
  }

  async function save() {
    setStep('saving')
    setError('')
    if (!user?.id) { setError('Not signed in.'); setStep('error'); return }

    const opt = COMMISSION_OPTIONS.find(o => o.key === commission)!
    const purchaseAmount = amount ? Number(amount) : null
    if (purchaseAmount != null && (!Number.isFinite(purchaseAmount) || purchaseAmount < 0)) {
      setError('Amount must be a non-negative number.'); setStep('quick-fields'); return
    }

    const willProcess = !!(frontPhoto || invoicePhoto)

    const { data: insertData, error: insertErr } = await supabase
      .from('customer_intakes')
      .insert({
        event_id: eventId,
        buyer_id: user.id,
        buy_form_number: buyFormNumber || null,
        check_number: checkNumber || null,
        purchase_amount: purchaseAmount,
        commission_pct: opt.pct,
        commission_bucket: commission,
        intake_kind: 'purchase',
        phone: formatPhoneDisplay(phone) || null,
        email: email || null,
        processing_state: willProcess ? 'processing' : 'parsed',
      })
      .select('id')
      .single()
    if (insertErr || !insertData?.id) {
      setError(insertErr?.message || 'Insert failed.'); setStep('error'); return
    }
    const intakeId = insertData.id

    const uploadJobs: Promise<{ field: string; url: string } | null>[] = []
    if (frontPhoto)   uploadJobs.push(uploadIntakePhoto(frontPhoto,   { eventId, intakeId, kind: 'front'   }).then(url => ({ field: 'license_photo_url', url })).catch(() => null))
    if (backPhoto)    uploadJobs.push(uploadIntakePhoto(backPhoto,    { eventId, intakeId, kind: 'back'    }).then(url => ({ field: 'back_photo_url', url })).catch(() => null))
    if (invoicePhoto) uploadJobs.push(uploadIntakePhoto(invoicePhoto, { eventId, intakeId, kind: 'invoice' }).then(url => ({ field: 'invoice_photo_url', url })).catch(() => null))
    const singletonResults = await Promise.all(uploadJobs)

    const updateFields: Record<string, string> = {}
    for (const r of singletonResults) {
      if (r) updateFields[r.field] = r.url
    }
    if (Object.keys(updateFields).length > 0) {
      await supabase.from('customer_intakes').update(updateFields).eq('id', intakeId)
    }

    const jewelryUploads = await Promise.all(
      jewelryPhotos.map((blob, i) =>
        uploadIntakePhoto(blob, { eventId, intakeId, kind: 'jewelry', index: i + 1 })
          .then(url => ({ url, sort_order: i }))
          .catch(() => null)
      )
    )
    const jewelryRows = jewelryUploads
      .filter((r): r is { url: string; sort_order: number } => r !== null)
      .map(r => ({ intake_id: intakeId, photo_url: r.url, sort_order: r.sort_order }))
    if (jewelryRows.length > 0) {
      await supabase.from('intake_photos').insert(jewelryRows)
    }

    void supabase.from('intake_audit_log').insert({
      intake_id: intakeId,
      actor_user_id: user.id,
      action: 'create',
      changed_fields: { intake_kind: [null, 'purchase'], buy_form_number: [null, buyFormNumber || null] },
    })

    if (willProcess) {
      void fetch(`/api/intake/${intakeId}/process`, { method: 'POST' }).catch(e => {
        console.warn('[intake] background process trigger failed', e)
      })
    }

    if (phone || email) {
      void (async () => {
        try {
          const { data: ev } = await supabase.from('events').select('store_id').eq('id', eventId).single()
          if (ev?.store_id) {
            const cid = await dedupAndUpsertCustomer({
              storeId: ev.store_id,
              firstName: null, lastName: null,
              phone: formatPhoneDisplay(phone) || null,
              email: email || null,
              licenseNumber: null, licenseState: null, dateOfBirth: null,
              addressLine1: null, addressCity: null, addressState: null, addressZip: null,
            })
            if (cid) await supabase.from('customer_intakes').update({ customer_id: cid }).eq('id', intakeId)
          }
        } catch (e) {
          console.warn('[intake] post-save dedup skipped', e)
        }
      })()
    }

    setStep('done')
    onSaved?.(intakeId)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fff', color: 'var(--ink)',
      display: 'flex', flexDirection: 'column', zIndex: 2000,
    }}>
      <Header step={step} onClose={onClose} />
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

        {step === 'form-number' && (
          <FormNumberStep
            value={buyFormNumber}
            onChange={setBuyFormNumber}
            onContinue={handleFormNumberContinue}
          />
        )}

        {step === 'photo-front' && (
          <CameraCaptureStep
            key="front"
            label="Front of license"
            existing={frontPhoto}
            onCapture={setFrontPhoto}
            onContinue={() => setStep('photo-back')}
            onSkip={() => setStep('photo-back')}
            onBack={() => setStep('form-number')}
            overlay="license"
            overlayLabel="ID FRONT"
          />
        )}

        {step === 'photo-back' && (
          <CameraCaptureStep
            key="back"
            label="Back of license (PDF417)"
            existing={backPhoto}
            onCapture={setBackPhoto}
            onContinue={() => setStep('photo-invoice')}
            onSkip={() => setStep('photo-invoice')}
            onBack={() => setStep('photo-front')}
            overlay="license"
            overlayLabel="ID BACK"
          />
        )}

        {step === 'photo-invoice' && (
          <CameraCaptureStep
            key="invoice"
            label="Invoice / Buy Form"
            existing={invoicePhoto}
            onCapture={setInvoicePhoto}
            onContinue={() => setStep('photo-jewelry')}
            onSkip={() => setStep('photo-jewelry')}
            onBack={() => setStep('photo-back')}
            overlay="paper"
            overlayLabel="BUY FORM"
          />
        )}

        {step === 'photo-jewelry' && (
          <JewelryStep
            photos={jewelryPhotos}
            onChange={setJewelryPhotos}
            onContinue={() => setStep('quick-fields')}
            onBack={() => setStep('photo-invoice')}
          />
        )}

        {step === 'quick-fields' && (
          <QuickFieldsStep
            amount={amount} onAmount={setAmount}
            checkNumber={checkNumber} onCheckNumber={setCheckNumber}
            commission={commission} onCommission={setCommission}
            showCommissionPicker={showCommissionPicker} onShowCommissionPicker={setShowCommissionPicker}
            email={email} onEmail={setEmail}
            phoneDigits={phone} onPhoneDigits={setPhone}
            onSave={save}
            onBack={() => setStep('photo-jewelry')}
          />
        )}

        {step === 'saving' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--mist)' }}>
            Saving intake… uploading photos…
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Intake saved</div>
            <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 24 }}>
              Form #{buyFormNumber} is on today's worksheet.
            </div>
            <button onClick={onClose} style={primaryBtnFull}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Save failed</div>
            <div style={{ fontSize: 13, color: '#B22234', marginBottom: 24 }}>{error || 'Unknown error.'}</div>
            <button onClick={() => setStep('quick-fields')} style={primaryBtnFull}>Back to form</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────

function Header({ step, onClose }: { step: Step; onClose: () => void }) {
  const titleByStep: Record<Step, string> = {
    'form-number':   'Buy form #',
    'photo-front':   'Front of license',
    'photo-back':    'Back of license',
    'photo-invoice': 'Invoice photo',
    'photo-jewelry': 'Jewelry photos',
    'quick-fields':  'Quick fields',
    'saving':        'Saving…',
    'done':          'Saved',
    'error':         'Error',
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderBottom: '1px solid var(--cream2)', background: '#fff',
    }}>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', color: 'var(--ink)',
        fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 0,
      }}>← Cancel</button>
      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)' }}>{titleByStep[step]}</div>
      <div style={{ width: 60 }} />
    </div>
  )
}

// ── Form-number step ─────────────────────────────────────────

function FormNumberStep({
  value, onChange, onContinue,
}: { value: string; onChange: (s: string) => void; onContinue: () => void }) {
  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ fontSize: 14, color: 'var(--ash)', marginBottom: 16, lineHeight: 1.5 }}>
        Type the 5-digit number from the top of the paper buy form.
      </div>
      <input
        autoFocus
        inputMode="numeric"
        pattern="\d{5}"
        maxLength={5}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="00000"
        style={{
          width: '100%', padding: '18px 16px', fontSize: 28, letterSpacing: 6,
          background: '#fff', border: '1px solid var(--pearl)',
          color: 'var(--ink)', borderRadius: 12, fontFamily: 'monospace', textAlign: 'center',
        }}
      />
      <button
        onClick={onContinue}
        disabled={value.length !== 5}
        style={{ ...primaryBtnFullTall, marginTop: 16, opacity: value.length === 5 ? 1 : 0.4 }}
      >
        Continue →
      </button>
    </div>
  )
}

// ── Camera capture step (live preview + overlay + auto-capture) ───

interface CameraStepProps {
  label: string
  existing: Blob | null
  onCapture: (b: Blob) => void
  onContinue: () => void
  onSkip: () => void
  onBack: () => void
  overlay: 'license' | 'paper'
  overlayLabel: string
}

function CameraCaptureStep({
  label, existing, onCapture, onContinue, onSkip, onBack, overlay, overlayLabel,
}: CameraStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [autoCountdown, setAutoCountdown] = useState<number>(AUTO_CAPTURE_SECONDS)
  const [autoEnabled, setAutoEnabled] = useState(true)
  const fallbackInputRef = useRef<HTMLInputElement | null>(null)

  // Render existing preview if user has already captured.
  useEffect(() => {
    if (!existing) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(existing)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [existing])

  // Open camera when step mounts (and we haven't captured yet).
  useEffect(() => {
    if (existing) return  // already captured — show preview, no camera
    let cancelled = false
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try { await videoRef.current.play() } catch { /* autoplay policy */ }
        }
        setCameraReady(true)
      } catch (e: any) {
        setCameraError(e?.message || 'Camera unavailable. Use the file picker.')
      }
    })()
    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [existing])

  // Auto-capture countdown — resets whenever the user taps the camera area
  // (assumed to be a recompose) or toggles auto off.
  useEffect(() => {
    if (existing || !cameraReady || !autoEnabled) return
    setAutoCountdown(AUTO_CAPTURE_SECONDS)
    const timer = setInterval(() => {
      setAutoCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          // Snap on next tick to give the state update a chance to propagate.
          setTimeout(() => { void capture() }, 0)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, cameraReady, autoEnabled])

  function resetAutoCountdown() {
    setAutoCountdown(AUTO_CAPTURE_SECONDS)
  }

  async function capture() {
    const v = videoRef.current
    if (!v || v.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    canvas.toBlob(b => {
      if (b) onCapture(b)
    }, 'image/jpeg', 0.9)
  }

  function handleFile(f: File | null | undefined) {
    if (!f) return
    onCapture(f)
  }

  // Show retake/continue when we already have a photo.
  if (previewUrl) {
    return (
      <div>
        <img src={previewUrl} alt={label} style={{
          width: '100%', maxHeight: '55vh', objectFit: 'contain',
          background: '#111', borderRadius: 12,
        }} />
        <button onClick={onContinue} style={{ ...primaryBtnFullTall, marginTop: 16 }}>
          Continue →
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <button onClick={onBack} style={secondaryBtn}>← Back</button>
          <button onClick={() => onCapture(null as any)} style={secondaryBtn}>🔄 Retake</button>
        </div>
      </div>
    )
  }

  // Camera-error fallback to file picker.
  if (cameraError) {
    return (
      <div>
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--mist)', background: 'var(--cream)', borderRadius: 12, border: '1px dashed var(--pearl)' }}>
          {cameraError}
        </div>
        <input
          ref={fallbackInputRef} type="file" accept="image/*" capture="environment"
          onChange={e => handleFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
        <button onClick={() => fallbackInputRef.current?.click()} style={{ ...primaryBtnFullTall, marginTop: 16 }}>
          📷 Take photo
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <button onClick={onBack} style={secondaryBtn}>← Back</button>
          <button onClick={onSkip} style={secondaryBtn}>Skip →</button>
        </div>
      </div>
    )
  }

  // Live camera with overlay + auto-capture countdown + manual button.
  return (
    <div>
      <div
        onClick={resetAutoCountdown}
        style={{
          position: 'relative', width: '100%', aspectRatio: '3/4',
          background: '#000', borderRadius: 12, overflow: 'hidden',
        }}
      >
        <video ref={videoRef} playsInline muted autoPlay style={{
          width: '100%', height: '100%', objectFit: 'cover',
        }} />

        {/* Overlay outline */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <div style={{
            width: '88%',
            aspectRatio: overlay === 'license' ? '1.586/1' : '8.5/11',
            border: '3px solid #7EC8A0',
            borderRadius: overlay === 'license' ? 12 : 4,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.45)',
            position: 'relative',
          }}>
            {overlayLabel && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'rgba(255,255,255,.55)', fontSize: 28, fontWeight: 900,
                letterSpacing: '.1em', textTransform: 'uppercase',
                textShadow: '0 2px 8px rgba(0,0,0,.7)',
              }}>{overlayLabel}</div>
            )}
          </div>
        </div>

        {/* Status badge top-left */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(0,0,0,.55)', color: '#fff',
          padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: cameraReady ? '#22C55E' : '#F59E0B' }} />
          {cameraReady ? 'Camera ready' : 'Starting…'}
        </div>

        {/* Countdown badge top-right */}
        {cameraReady && autoEnabled && autoCountdown > 0 && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(220,38,38,.92)', color: '#fff',
            padding: '4px 10px', borderRadius: 99, fontSize: 12, fontWeight: 800,
          }}>
            Auto in {autoCountdown}s
          </div>
        )}
        {cameraReady && !autoEnabled && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(0,0,0,.55)', color: '#fff',
            padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
          }}>
            Auto OFF
          </div>
        )}

        {/* Auto toggle bottom-right */}
        <button
          onClick={(e) => { e.stopPropagation(); setAutoEnabled(v => !v) }}
          style={{
            position: 'absolute', bottom: 10, right: 10,
            background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none',
            padding: '6px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {autoEnabled ? '⏸ Auto off' : '▶ Auto on'}
        </button>
      </div>

      <button onClick={() => void capture()} disabled={!cameraReady} style={{
        ...primaryBtnFullTall, marginTop: 16,
        opacity: cameraReady ? 1 : 0.4,
        cursor: cameraReady ? 'pointer' : 'not-allowed',
      }}>
        📷 Take photo
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        <button onClick={onSkip} style={secondaryBtn}>Skip →</button>
      </div>
    </div>
  )
}

// ── Jewelry step ─────────────────────────────────────────────

function JewelryStep({
  photos, onChange, onContinue, onBack,
}: {
  photos: Blob[]
  onChange: (next: Blob[]) => void
  onContinue: () => void
  onBack: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const handleFile = (f: File | null | undefined) => {
    if (!f) return
    if (photos.length >= MAX_JEWELRY_PHOTOS) return
    onChange([...photos, f])
  }
  const removeAt = (i: number) => onChange(photos.filter((_, idx) => idx !== i))

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--ash)', marginBottom: 12, lineHeight: 1.5 }}>
        Up to {MAX_JEWELRY_PHOTOS} jewelry photos. Optional.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
        {photos.map((b, i) => (
          <JewelryThumb key={i} blob={b} onRemove={() => removeAt(i)} />
        ))}
        {photos.length < MAX_JEWELRY_PHOTOS && (
          <button onClick={() => fileRef.current?.click()} style={{
            aspectRatio: '1/1', background: 'var(--cream)',
            border: '1px dashed var(--pearl)', borderRadius: 10,
            color: 'var(--mist)', fontSize: 32, cursor: 'pointer',
          }}>+</button>
        )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={e => { handleFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = '' }}
        style={{ display: 'none' }}
      />

      <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 8 }}>
        {photos.length} / {MAX_JEWELRY_PHOTOS} photos
      </div>

      <button onClick={onContinue} style={{ ...primaryBtnFullTall, marginTop: 16 }}>Continue →</button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        <button onClick={onContinue} style={secondaryBtn}>Skip →</button>
      </div>
    </div>
  )
}

function JewelryThumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return (
    <div style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 10, overflow: 'hidden', background: '#111' }}>
      {url && <img src={url} alt="Jewelry" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <button onClick={onRemove} style={{
        position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%',
        background: 'rgba(0,0,0,.7)', color: '#fff', border: 'none', fontSize: 12,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>×</button>
    </div>
  )
}

// ── Quick fields step ────────────────────────────────────────

function QuickFieldsStep(props: {
  amount: string; onAmount: (s: string) => void
  checkNumber: string; onCheckNumber: (s: string) => void
  commission: CommissionBucket; onCommission: (c: CommissionBucket) => void
  showCommissionPicker: boolean; onShowCommissionPicker: (b: boolean) => void
  email: string; onEmail: (s: string) => void
  phoneDigits: string; onPhoneDigits: (s: string) => void
  onSave: () => void
  onBack: () => void
}) {
  const phoneFormatted = formatPhoneDisplay(props.phoneDigits)
  const commissionLabel = COMMISSION_OPTIONS.find(o => o.key === props.commission)?.label || '10%'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Field label="Purchase $" noMargin>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: 15, fontWeight: 800, color: 'var(--mist)', pointerEvents: 'none',
            }}>$</span>
            <input
              inputMode="numeric"
              placeholder="0"
              value={props.amount}
              onChange={e => props.onAmount(e.target.value.replace(/\D/g, ''))}
              style={{ ...textInputStyle, paddingLeft: 26 }}
            />
          </div>
        </Field>

        <Field label="Check #" noMargin>
          <input
            inputMode="numeric" placeholder="optional"
            value={props.checkNumber} onChange={e => props.onCheckNumber(e.target.value.replace(/\D/g, ''))}
            style={textInputStyle}
          />
        </Field>
      </div>

      <Field label="Phone">
        <input
          inputMode="tel" placeholder="555-555-5555"
          value={phoneFormatted}
          onChange={e => props.onPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 10))}
          style={textInputStyle}
        />
      </Field>

      <Field label="Email">
        <input
          inputMode="email" type="email" placeholder="optional"
          value={props.email} onChange={e => props.onEmail(e.target.value)}
          style={textInputStyle}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {['@gmail.com', '@yahoo.com', '@hotmail.com', '@aol.com'].map(suffix => (
            <button
              key={suffix}
              type="button"
              onClick={() => {
                if (props.email.includes('@')) {
                  // Replace existing domain
                  props.onEmail(props.email.split('@')[0] + suffix)
                } else {
                  props.onEmail(props.email + suffix)
                }
              }}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: 'var(--cream)', border: '1px solid var(--pearl)',
                color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >+{suffix}</button>
          ))}
        </div>
      </Field>

      {/* Commission — small text link by default */}
      <div style={{ margin: '10px 0 16px', fontSize: 13, color: 'var(--ash)' }}>
        Commission: <strong>{commissionLabel}</strong>
        {' · '}
        <button
          type="button"
          onClick={() => props.onShowCommissionPicker(!props.showCommissionPicker)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--green-dark)',
            cursor: 'pointer', textDecoration: 'underline', fontSize: 13, padding: 0,
            fontFamily: 'inherit',
          }}
        >
          {props.showCommissionPicker ? 'hide' : 'edit'}
        </button>
        {props.showCommissionPicker && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {COMMISSION_OPTIONS.map(o => {
              const sel = props.commission === o.key
              return (
                <button key={o.key} onClick={() => props.onCommission(o.key)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                    background: sel ? 'var(--green)' : '#fff',
                    color: sel ? '#fff' : 'var(--ink)',
                    border: `1px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
                    fontFamily: 'inherit', cursor: 'pointer',
                  }}>{o.label}</button>
              )
            })}
          </div>
        )}
      </div>

      <button onClick={props.onSave} style={{ ...primaryBtnFullTall, marginTop: 8 }}>💾 Save intake</button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <button onClick={props.onBack} style={secondaryBtn}>← Back</button>
      </div>
    </div>
  )
}

function Field({ label, children, noMargin }: { label: string; children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      background: '#FEF2F2', border: '1px solid #fecdd3',
      color: '#B22234', padding: '10px 12px', borderRadius: 8, marginBottom: 12,
      fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    }}>
      <span>⚠ {message}</span>
      <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function formatPhoneDisplay(digits: string): string {
  const d = (digits || '').replace(/\D/g, '').slice(0, 10)
  if (d.length === 0) return ''
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

// ── Styles ────────────────────────────────────────────────────

const textInputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 15,
  background: '#fff', border: '1px solid var(--pearl)',
  color: 'var(--ink)', borderRadius: 10, fontFamily: 'inherit',
}

const primaryBtnFull: React.CSSProperties = {
  width: '100%', padding: '14px 18px', borderRadius: 10, fontWeight: 800, fontSize: 15,
  background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
}

/** Double-height variant of primaryBtnFull — used for the most-tappable
 *  "Continue" actions on photo previews + jewelry step where users will be
 *  thumbing through quickly with a customer at the counter. */
const primaryBtnFullTall: React.CSSProperties = {
  width: '100%', padding: '28px 18px', borderRadius: 12, fontWeight: 800, fontSize: 17,
  background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
}

const primaryBtn: React.CSSProperties = {
  padding: '12px 18px', borderRadius: 10, fontWeight: 800, fontSize: 14,
  background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
}

const secondaryBtn: React.CSSProperties = {
  padding: '12px 18px', borderRadius: 10, fontWeight: 700, fontSize: 14,
  background: '#fff', color: 'var(--ink)',
  border: '1px solid var(--pearl)', cursor: 'pointer', fontFamily: 'inherit',
}
