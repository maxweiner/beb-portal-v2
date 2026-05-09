'use client'

/**
 * Photo-first buy intake capture flow (Phase 1 of the intake → purchase
 * initiative — see docs/intake-purchase-spec.md).
 *
 * Step sequence:
 *   1. Buy form #
 *   2. Front of license (camera)
 *   3. Back of license (camera)
 *   4. Invoice (camera)
 *   5. Jewelry (1..5 photos, optional)
 *   6. Quick fields (amount, check #, commission, email, phone)
 *   7. Save → customer_intakes row + intake_photos rows
 *
 * Phase 1 has NO background worker — `processing_state` defaults to 'parsed'
 * because the buyer types every field manually. Phase 2 will start the worker
 * and switch the default to 'processing'.
 *
 * Buyer skips any optional step. Everything is editable later via the
 * worksheet (Phase 4) until the 3-day lock kicks in (Phase 8).
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { uploadIntakePhoto } from '@/lib/intake/photoUpload'

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
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Form-# uniqueness pre-check (buy_form_number is globally unique forever).
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

  // Save: insert customer_intakes row, upload photos, write intake_photos rows.
  async function save() {
    setStep('saving')
    setError('')
    if (!user?.id) { setError('Not signed in.'); setStep('error'); return }

    const opt = COMMISSION_OPTIONS.find(o => o.key === commission)!
    const purchaseAmount = amount ? Number(amount) : null
    if (purchaseAmount != null && (!Number.isFinite(purchaseAmount) || purchaseAmount < 0)) {
      setError('Amount must be a non-negative number.'); setStep('quick-fields'); return
    }

    // 1. Insert the intake row first so we have an ID for storage paths.
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
        phone: phone || null,
        email: email || null,
        processing_state: 'parsed',  // Phase 1: manual entry, no worker
      })
      .select('id')
      .single()
    if (insertErr || !insertData?.id) {
      setError(insertErr?.message || 'Insert failed.'); setStep('error'); return
    }
    const intakeId = insertData.id

    // 2. Upload photos in parallel. Failures here don't roll back the intake;
    //    user can retry from the worksheet.
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

    // 3. Jewelry photos → intake_photos rows.
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

    // 4. Audit log.
    void supabase.from('intake_audit_log').insert({
      intake_id: intakeId,
      actor_user_id: user.id,
      action: 'create',
      changed_fields: { intake_kind: [null, 'purchase'], buy_form_number: [null, buyFormNumber || null] },
    })

    setStep('done')
    onSaved?.(intakeId)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', color: '#fff',
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
          <PhotoStep
            label="Front of license"
            sub="Customer's photo side."
            existing={frontPhoto}
            onCapture={setFrontPhoto}
            onContinue={() => setStep('photo-back')}
            onSkip={() => setStep('photo-back')}
            onBack={() => setStep('form-number')}
          />
        )}

        {step === 'photo-back' && (
          <PhotoStep
            label="Back of license"
            sub="The side with the big square barcode (PDF417)."
            existing={backPhoto}
            onCapture={setBackPhoto}
            onContinue={() => setStep('photo-invoice')}
            onSkip={() => setStep('photo-invoice')}
            onBack={() => setStep('photo-front')}
          />
        )}

        {step === 'photo-invoice' && (
          <PhotoStep
            label="Invoice / buy form"
            sub="Capture the whole written form clearly."
            existing={invoicePhoto}
            onCapture={setInvoicePhoto}
            onContinue={() => setStep('photo-jewelry')}
            onSkip={() => setStep('photo-jewelry')}
            onBack={() => setStep('photo-back')}
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
            email={email} onEmail={setEmail}
            phone={phone} onPhone={setPhone}
            onSave={save}
            onBack={() => setStep('photo-jewelry')}
          />
        )}

        {step === 'saving' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,.7)' }}>
            Saving intake… uploading photos…
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Intake saved</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginBottom: 24 }}>
              Form #{buyFormNumber} is on today's worksheet.
            </div>
            <button onClick={onClose} style={primaryBtn}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Save failed</div>
            <div style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 24 }}>{error || 'Unknown error.'}</div>
            <button onClick={() => setStep('quick-fields')} style={primaryBtn}>Back to form</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── steps ─────────────────────────────────────────────────────

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
      padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.1)',
    }}>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', color: '#fff',
        fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: 0,
      }}>← Cancel</button>
      <div style={{ fontWeight: 800, fontSize: 14 }}>{titleByStep[step]}</div>
      <div style={{ width: 60 }} />
    </div>
  )
}

function FormNumberStep({
  value, onChange, onContinue,
}: { value: string; onChange: (s: string) => void; onContinue: () => void }) {
  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', marginBottom: 16, lineHeight: 1.5 }}>
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
          background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.2)',
          color: '#fff', borderRadius: 12, fontFamily: 'monospace', textAlign: 'center',
        }}
      />
      <button
        onClick={onContinue}
        disabled={value.length !== 5}
        style={{ ...primaryBtn, marginTop: 24, opacity: value.length === 5 ? 1 : 0.4 }}
      >
        Continue →
      </button>
    </div>
  )
}

function PhotoStep({
  label, sub, existing, onCapture, onContinue, onSkip, onBack,
}: {
  label: string
  sub: string
  existing: Blob | null
  onCapture: (b: Blob) => void
  onContinue: () => void
  onSkip: () => void
  onBack: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(existing)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [existing])

  const handleFile = (f: File | null | undefined) => {
    if (!f) return
    onCapture(f)
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', marginBottom: 4 }}>{sub}</div>

      {previewUrl ? (
        <img src={previewUrl} alt={label} style={{
          width: '100%', maxHeight: '50vh', objectFit: 'contain',
          background: '#111', borderRadius: 12, marginTop: 12,
        }} />
      ) : (
        <div style={{
          marginTop: 12, padding: 32, background: 'rgba(255,255,255,.04)',
          border: '1px dashed rgba(255,255,255,.2)', borderRadius: 12,
          textAlign: 'center', color: 'rgba(255,255,255,.5)', fontSize: 14,
        }}>
          No photo yet — tap below.
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={e => handleFile(e.target.files?.[0])}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        <button onClick={() => fileRef.current?.click()} style={{ ...primaryBtn, flex: 1 }}>
          {previewUrl ? '🔄 Retake' : '📷 Take photo'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {!previewUrl && (
          <button onClick={onSkip} style={{ ...secondaryBtn, flex: 1 }}>Skip for now</button>
        )}
        {previewUrl && (
          <button onClick={onContinue} style={{ ...primaryBtn, flex: 1 }}>Continue →</button>
        )}
      </div>
    </div>
  )
}

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
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', marginBottom: 12, lineHeight: 1.5 }}>
        Up to {MAX_JEWELRY_PHOTOS} jewelry photos. Optional.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
        {photos.map((b, i) => (
          <JewelryThumb key={i} blob={b} onRemove={() => removeAt(i)} />
        ))}
        {photos.length < MAX_JEWELRY_PHOTOS && (
          <button onClick={() => fileRef.current?.click()} style={{
            aspectRatio: '1/1', background: 'rgba(255,255,255,.05)',
            border: '1px dashed rgba(255,255,255,.25)', borderRadius: 10,
            color: 'rgba(255,255,255,.5)', fontSize: 32, cursor: 'pointer',
          }}>+</button>
        )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={e => { handleFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = '' }}
        style={{ display: 'none' }}
      />

      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>
        {photos.length} / {MAX_JEWELRY_PHOTOS} photos
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        <button onClick={onContinue} style={{ ...primaryBtn, flex: 1 }}>Continue →</button>
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

function QuickFieldsStep(props: {
  amount: string; onAmount: (s: string) => void
  checkNumber: string; onCheckNumber: (s: string) => void
  commission: CommissionBucket; onCommission: (c: CommissionBucket) => void
  email: string; onEmail: (s: string) => void
  phone: string; onPhone: (s: string) => void
  onSave: () => void
  onBack: () => void
}) {
  return (
    <div>
      <Field label="Purchase amount ($)">
        <input
          inputMode="decimal" placeholder="0.00"
          value={props.amount} onChange={e => props.onAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={textInputStyle}
        />
      </Field>

      <Field label="Commission %">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COMMISSION_OPTIONS.map(o => {
            const sel = props.commission === o.key
            return (
              <button key={o.key} onClick={() => props.onCommission(o.key)}
                style={{
                  padding: '8px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                  background: sel ? '#fff' : 'rgba(255,255,255,.08)',
                  color: sel ? '#000' : '#fff',
                  border: sel ? '1px solid #fff' : '1px solid rgba(255,255,255,.2)',
                  fontFamily: 'inherit', cursor: 'pointer',
                }}>{o.label}</button>
            )
          })}
        </div>
      </Field>

      <Field label="Check #">
        <input
          inputMode="numeric" placeholder="optional"
          value={props.checkNumber} onChange={e => props.onCheckNumber(e.target.value)}
          style={textInputStyle}
        />
      </Field>

      <Field label="Phone">
        <input
          inputMode="tel" placeholder="optional"
          value={props.phone} onChange={e => props.onPhone(e.target.value)}
          style={textInputStyle}
        />
      </Field>

      <Field label="Email">
        <input
          inputMode="email" type="email" placeholder="optional"
          value={props.email} onChange={e => props.onEmail(e.target.value)}
          style={textInputStyle}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button onClick={props.onBack} style={secondaryBtn}>← Back</button>
        <button onClick={props.onSave} style={{ ...primaryBtn, flex: 1 }}>💾 Save intake</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      background: 'rgba(178,34,52,.18)', border: '1px solid rgba(255,200,200,.4)',
      color: '#fecdd3', padding: '10px 12px', borderRadius: 8, marginBottom: 12,
      fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    }}>
      <span>⚠ {message}</span>
      <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
    </div>
  )
}

const textInputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 15,
  background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.2)',
  color: '#fff', borderRadius: 10, fontFamily: 'inherit',
}

const primaryBtn: React.CSSProperties = {
  padding: '14px 18px', borderRadius: 10, fontWeight: 800, fontSize: 14,
  background: '#fff', color: '#000', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
}

const secondaryBtn: React.CSSProperties = {
  padding: '14px 18px', borderRadius: 10, fontWeight: 700, fontSize: 14,
  background: 'rgba(255,255,255,.08)', color: '#fff',
  border: '1px solid rgba(255,255,255,.2)', cursor: 'pointer', fontFamily: 'inherit',
}
