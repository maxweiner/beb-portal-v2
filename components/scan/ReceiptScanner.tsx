'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { compressImage, uploadToStorage } from '@/lib/imageUtils'

type Step = 'id_back' | 'id_front' | 'receipt' | 'confirm' | 'jewelry' | 'saving' | 'done'

interface SellerData {
  name: string
  address: string
  city: string
  state: string
  zip: string
  dob: string
  license_number: string
}

interface InvoiceData {
  invoice_number: string
  check_number: string
  dollar_amount: number
}

interface ScanState {
  idBackBase64: string
  idFrontBase64: string
  receiptBase64: string
  jewelryBase64: string[]
  seller: SellerData
  invoice: InvoiceData
  barcodeSuccess: boolean
}

const EMPTY_SELLER: SellerData = { name: '', address: '', city: '', state: '', zip: '', dob: '', license_number: '' }
const EMPTY_INVOICE: InvoiceData = { invoice_number: '', check_number: '', dollar_amount: 0 }

interface Props {
  eventId: string
  userId: string
  storeName: string
  dayNumber: number
  onClose: () => void
  onSaved: () => void
}

export default function ReceiptScanner({ eventId, userId, storeName, dayNumber, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>('id_back')
  const [data, setData] = useState<ScanState>({
    idBackBase64: '', idFrontBase64: '', receiptBase64: '', jewelryBase64: [],
    seller: { ...EMPTY_SELLER }, invoice: { ...EMPTY_INVOICE }, barcodeSuccess: false,
  })
  const [processing, setProcessing] = useState(false)
  const [processingMsg, setProcessingMsg] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const scanStartTime = useRef(Date.now())

  // Auto-save key for recovery
  const saveKey = `scan-progress-${eventId}-${userId}`

  // Restore progress on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(saveKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.step && parsed.data) {
          setData(parsed.data)
          setStep(parsed.step)
        }
      }
    } catch {}
  }, [saveKey])

  // Auto-save on every state change
  useEffect(() => {
    if (step === 'done' || step === 'saving') return
    try {
      localStorage.setItem(saveKey, JSON.stringify({ step, data }))
    } catch {}
  }, [step, data, saveKey])

  // Clear saved progress on completion
  const clearProgress = () => {
    try { localStorage.removeItem(saveKey) } catch {}
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'id_back', label: 'ID Back' },
    { id: 'id_front', label: 'ID Front' },
    { id: 'receipt', label: 'Receipt' },
    { id: 'confirm', label: 'Confirm' },
    { id: 'jewelry', label: 'Jewelry' },
  ]
  const stepIndex = steps.findIndex(s => s.id === step)

  // Open camera immediately
  const openCamera = () => {
    if (fileRef.current) {
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }

  // Auto-open camera when entering a capture step
  useEffect(() => {
    if (step === 'id_back' || step === 'id_front' || step === 'receipt' || step === 'jewelry') {
      // Small delay to ensure the component has rendered
      const t = setTimeout(() => openCamera(), 300)
      return () => clearTimeout(t)
    }
  }, [step])

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setProcessing(true)

    try {
      // Read file and resize via canvas
      const compressed = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          // Create a bitmap to handle HEIC and other formats
          const img = document.createElement('img')
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const maxW = 1024
            let w = img.naturalWidth
            let h = img.naturalHeight
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0, w, h)
            resolve(canvas.toDataURL('image/jpeg', 0.7))
          }
          img.onerror = () => {
            // If image fails to load (HEIC on desktop), use raw data
            resolve(dataUrl)
          }
          img.src = dataUrl
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })

      if (step === 'id_back') {
        setData(prev => ({ ...prev, idBackBase64: compressed }))
        setProcessingMsg('Reading ID barcode...')
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000)
        const res = await fetch('/api/scan-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressed, type: 'id_back' }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))
        const result = await res.json()
        if (result.error) setError('OCR error: ' + result.error)
        if (result.success && result.data && result.data.name) {
          setData(prev => ({
            ...prev,
            barcodeSuccess: true,
            seller: {
              name: result.data.name || '',
              address: result.data.address || '',
              city: result.data.city || '',
              state: result.data.state || '',
              zip: result.data.zip || '',
              dob: result.data.dob || '',
              license_number: result.data.license_number || '',
            },
          }))
        }
        setStep('id_front')

      } else if (step === 'id_front') {
        setData(prev => ({ ...prev, idFrontBase64: compressed }))
        // Only run OCR if barcode failed
        if (!data.barcodeSuccess) {
          setProcessingMsg('Reading ID front...')
          const res = await fetch('/api/scan-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: compressed, type: 'id_front' }),
          })
          const result = await res.json()
          if (result.success && result.data) {
            setData(prev => ({
              ...prev,
              seller: {
                name: result.data.name || prev.seller.name,
                address: result.data.address || prev.seller.address,
                city: result.data.city || prev.seller.city,
                state: result.data.state || prev.seller.state,
                zip: result.data.zip || prev.seller.zip,
                dob: result.data.dob || prev.seller.dob,
                license_number: result.data.license_number || prev.seller.license_number,
              },
            }))
          }
        }
        setStep('receipt')

      } else if (step === 'receipt') {
        setData(prev => ({ ...prev, receiptBase64: compressed }))
        setProcessingMsg('Reading invoice...')
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000)
        const res = await fetch('/api/scan-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressed, type: 'receipt' }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))
        const result = await res.json()
        if (result.error) setError('OCR error: ' + result.error)
        if (result.success && result.data) {
          setData(prev => ({
            ...prev,
            invoice: {
              invoice_number: result.data.invoice_number || '',
              check_number: result.data.check_number || '',
              dollar_amount: Number(result.data.dollar_amount) || 0,
            },
          }))
        }
        setStep('confirm')

      } else if (step === 'jewelry') {
        setData(prev => ({ ...prev, jewelryBase64: [...prev.jewelryBase64, compressed] }))
      }
    } catch (err: any) {
      setError('Failed to process image. Tap to try again.')
      console.error(err)
    } finally {
      setProcessing(false)
      setProcessingMsg('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveReceipt = async () => {
    setStep('saving')
    setError('')
    try {
      const ts = Date.now()
      const folder = `${eventId}/${ts}`

      // Upload images
      const idFrontUrl = data.idFrontBase64 ? await uploadToStorage(supabase, data.idFrontBase64, folder, 'id-front.jpg') : ''
      const idBackUrl = data.idBackBase64 ? await uploadToStorage(supabase, data.idBackBase64, folder, 'id-back.jpg') : ''
      const receiptUrl = data.receiptBase64 ? await uploadToStorage(supabase, data.receiptBase64, folder, 'receipt.jpg') : ''
      const jewelryUrls: string[] = []
      for (let i = 0; i < data.jewelryBase64.length; i++) {
        const url = await uploadToStorage(supabase, data.jewelryBase64[i], folder, `jewelry-${i + 1}.jpg`)
        jewelryUrls.push(url)
      }

      const fullAddress = [data.seller.address, data.seller.city, data.seller.state, data.seller.zip].filter(Boolean).join(', ')

      const { error: dbError } = await supabase.from('receipt_scans').insert({
        event_id: eventId,
        user_id: userId,
        seller_name: data.seller.name,
        seller_address: fullAddress,
        seller_dob: data.seller.dob,
        seller_license_number: data.seller.license_number,
        invoice_number: data.invoice.invoice_number,
        check_number: data.invoice.check_number,
        dollar_amount: data.invoice.dollar_amount,
        id_front_url: idFrontUrl,
        id_back_url: idBackUrl,
        receipt_url: receiptUrl,
        jewelry_urls: jewelryUrls,
      })

      if (dbError) throw dbError
      clearProgress()
      setStep('done')
    } catch (err: any) {
      setError('Failed to save: ' + (err?.message || 'Unknown error'))
      setStep('jewelry')
    }
  }

  const scanAnother = () => {
    setData({
      idBackBase64: '', idFrontBase64: '', receiptBase64: '', jewelryBase64: [],
      seller: { ...EMPTY_SELLER }, invoice: { ...EMPTY_INVOICE }, barcodeSuccess: false,
    })
    scanStartTime.current = Date.now()
    setStep('id_back')
    setError('')
  }

  const handleDone = () => {
    clearProgress()
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column',
      background: (step === 'id_back' || step === 'id_front' || step === 'receipt') ? '#111' : 'var(--cream)' }}>

      <input ref={fileRef} type="file" accept="image/jpeg,image/png" capture="environment" style={{ display: 'none' }} onChange={handleCapture} />

      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={stepIndex > 0 && step !== 'done' && step !== 'saving' ? () => setStep(steps[stepIndex - 1].id) : onClose}
          style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer',
            color: (step === 'confirm' || step === 'jewelry' || step === 'done') ? 'var(--ash)' : 'rgba(255,255,255,.5)' }}>
          {stepIndex > 0 && step !== 'done' ? '← Back' : '× Close'}
        </button>
        {step !== 'done' && step !== 'saving' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {steps.map((s, i) => (
              <div key={s.id} style={{ width: 8, height: 8, borderRadius: '50%',
                background: i <= stepIndex ? (step === 'confirm' || step === 'jewelry' ? 'var(--green)' : '#fff') : 'rgba(255,255,255,.25)' }} />
            ))}
          </div>
        )}
        <span style={{ fontSize: 11, color: (step === 'confirm' || step === 'jewelry') ? 'var(--mist)' : 'rgba(255,255,255,.3)' }}>
          {storeName} · Day {dayNumber}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>

        {/* CAMERA STEPS */}
        {(step === 'id_back' || step === 'id_front' || step === 'receipt') && (
          <>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              Step {stepIndex + 1} of 5
            </div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
              {step === 'id_back' && 'Scan ID — back (barcode)'}
              {step === 'id_front' && (data.barcodeSuccess ? 'Photograph ID — front' : 'Scan ID — front')}
              {step === 'receipt' && 'Scan the receipt'}
            </div>
            {step === 'id_front' && data.barcodeSuccess && (
              <div style={{ color: '#7EC8A0', fontSize: 13, marginBottom: 12, fontWeight: 700 }}>
                ✓ Barcode read successful — just need a photo of the front
              </div>
            )}

            {processing ? (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ color: '#7EC8A0', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{processingMsg || 'Processing...'}</div>
                <div style={{ width: 160, height: 4, background: 'rgba(255,255,255,.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#7EC8A0', borderRadius: 2, width: '60%', animation: 'none' }} />
                </div>
              </div>
            ) : (
              <>
                {/* Show preview if already captured */}
                {((step === 'id_back' && data.idBackBase64) || (step === 'id_front' && data.idFrontBase64) || (step === 'receipt' && data.receiptBase64)) ? (
                  <div style={{ width: '100%', maxWidth: 280, marginBottom: 16 }}>
                    <img src={step === 'id_back' ? data.idBackBase64 : step === 'id_front' ? data.idFrontBase64 : data.receiptBase64}
                      alt="Preview" style={{ width: '100%', borderRadius: 12, border: '2px solid rgba(255,255,255,.2)' }} />
                    <button onClick={openCamera} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 13, cursor: 'pointer' }}>
                      Retake photo
                    </button>
                  </div>
                ) : (
                  <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
                    Camera should open automatically...
                  </div>
                )}

                <button onClick={openCamera} style={{
                  width: 64, height: 64, borderRadius: '50%', background: '#fff', border: '4px solid rgba(255,255,255,.4)',
                  cursor: 'pointer',
                }} />
                <div style={{ color: 'rgba(255,255,255,.35)', fontSize: 12, marginTop: 6 }}>Tap to capture</div>
              </>
            )}

            {error && <div style={{ color: '#F09595', fontSize: 13, marginTop: 12 }}>{error}</div>}
          </>
        )}

        {/* CONFIRM STEP */}
        {step === 'confirm' && (
          <div style={{ width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 16 }}>Confirm details</div>

            {/* Seller */}
            <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Seller</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              {data.idFrontBase64 && (
                <img src={data.idFrontBase64} alt="ID" style={{ width: 56, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--pearl)' }} />
              )}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input value={data.seller.name}
                  onChange={e => setData(p => ({ ...p, seller: { ...p.seller, name: e.target.value } }))}
                  placeholder="Full name" style={{ fontSize: 14, fontWeight: 700 }} />
                <input value={[data.seller.address, data.seller.city, data.seller.state, data.seller.zip].filter(Boolean).join(', ')}
                  onChange={e => setData(p => ({ ...p, seller: { ...p.seller, address: e.target.value, city: '', state: '', zip: '' } }))}
                  placeholder="Address" style={{ fontSize: 12 }} />
              </div>
            </div>

            {/* Invoice */}
            <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Invoice</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              {data.receiptBase64 && (
                <img src={data.receiptBase64} alt="Receipt" style={{ width: 56, height: 72, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--pearl)' }} />
              )}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 2 }}>Invoice #</div>
                  <input value={data.invoice.invoice_number}
                    onChange={e => setData(p => ({ ...p, invoice: { ...p.invoice, invoice_number: e.target.value } }))}
                    placeholder="Invoice number" style={{ color: '#A32D2D', fontWeight: 700 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 2 }}>Check #</div>
                    <input value={data.invoice.check_number}
                      onChange={e => setData(p => ({ ...p, invoice: { ...p.invoice, check_number: e.target.value } }))}
                      placeholder="Check #" />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 2 }}>Amount</div>
                    <input type="number" value={data.invoice.dollar_amount || ''}
                      onChange={e => setData(p => ({ ...p, invoice: { ...p.invoice, dollar_amount: Number(e.target.value) } }))}
                      placeholder="$0" />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700, marginBottom: 16 }}>Tap any field to edit</div>

            {error && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}

            <button onClick={() => setStep('jewelry')} style={{
              width: '100%', padding: 14, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'var(--green)', color: '#fff', fontSize: 15, fontWeight: 700,
            }}>
              Next: photograph jewelry →
            </button>
          </div>
        )}

        {/* JEWELRY STEP */}
        {step === 'jewelry' && (
          <div style={{ width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>Jewelry photo</div>
            <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16 }}>
              Invoice #{data.invoice.invoice_number} · {data.seller.name}
            </div>

            {data.jewelryBase64.length > 0 ? (
              <img src={data.jewelryBase64[data.jewelryBase64.length - 1]} alt="Jewelry"
                style={{ width: '100%', borderRadius: 12, border: '1px solid var(--pearl)', marginBottom: 12 }} />
            ) : (
              <div style={{
                width: '100%', height: 180, border: '2px dashed var(--pearl)', borderRadius: 12,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: 'var(--cream2)', marginBottom: 12,
              }}>
                <div style={{ fontSize: 32, color: 'var(--mist)' }}>💎</div>
                <div style={{ color: 'var(--mist)', fontSize: 13 }}>Camera will open automatically</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              {data.jewelryBase64.map((img, i) => (
                <img key={i} src={img} alt={`Jewelry ${i + 1}`}
                  style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--pearl)' }} />
              ))}
              {data.jewelryBase64.length > 0 && data.jewelryBase64.length < 2 && (
                <button onClick={openCamera} style={{
                  width: 48, height: 48, borderRadius: 8, border: '2px dashed var(--pearl)', background: 'var(--cream2)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--mist)',
                }}>+</button>
              )}
              {data.jewelryBase64.length > 0 && data.jewelryBase64.length < 2 && (
                <span style={{ fontSize: 11, color: 'var(--mist)' }}>Add 2nd photo</span>
              )}
            </div>

            {processing && <div style={{ color: 'var(--green)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Processing...</div>}
            {error && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}

            {data.jewelryBase64.length === 0 ? (
              <button onClick={openCamera} disabled={processing} style={{
                width: '100%', padding: 14, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'var(--green)', color: '#fff', fontSize: 15, fontWeight: 700,
                opacity: processing ? 0.5 : 1,
              }}>
                📷 Take jewelry photo
              </button>
            ) : (
              <button onClick={saveReceipt} disabled={processing} style={{
                width: '100%', padding: 14, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'var(--green)', color: '#fff', fontSize: 15, fontWeight: 700,
              }}>
                ✓ Save receipt
              </button>
            )}
          </div>
        )}

        {/* SAVING */}
        {step === 'saving' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Uploading & saving...</div>
            <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>This may take a moment</div>
          </div>
        )}

        {/* DONE */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>Receipt saved!</div>
            <div style={{ fontSize: 14, color: 'var(--mist)', marginBottom: 24 }}>
              Invoice #{data.invoice.invoice_number} · ${Math.round(data.invoice.dollar_amount).toLocaleString()} · {data.seller.name}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={scanAnother} style={{
                flex: 1, padding: 14, borderRadius: 10, border: '1px solid var(--pearl)',
                background: 'var(--cream)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                Scan another
              </button>
              <button onClick={handleDone} style={{
                flex: 1, padding: 14, borderRadius: 10, border: 'none',
                background: 'var(--green)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
