'use client'

// Google Places-backed business search — sibling to
// AddressAutocompleteInput. Type a business name (jewelry vendor,
// retail customer, etc.), pick from suggestions, and `onPick` fires
// with the canonical name + formatted address + phone in one shot.
// Caller decides which form fields to populate (typically company_name
// + billing_address + phone).
//
// Uses the same Places API New endpoints as the address sibling — the
// only differences are:
//   - includedPrimaryTypes: ['establishment'] instead of address types
//   - fetchFields requests displayName / formattedAddress /
//     nationalPhoneNumber so the parent can fill multiple fields
//   - the dropdown row shows secondary text (the city + state) so two
//     "Smith Jewelers" in different cities can be distinguished
//
// Shares the same Maps loader + window.__bebGoogleMapsPromise as the
// address component, so the script + place library are loaded once
// across the whole app.

import { useEffect, useRef, useState, useCallback } from 'react'

declare global {
  interface Window {
    google?: any
    __bebGoogleMapsPromise?: Promise<void>
  }
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.maps?.places) return Promise.resolve()
  if (window.__bebGoogleMapsPromise) return window.__bebGoogleMapsPromise
  window.__bebGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-beb-gmaps]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('gmaps failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly&loading=async`
    script.async = true
    script.defer = true
    script.dataset.bebGmaps = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('gmaps failed'))
    document.head.appendChild(script)
  })
  return window.__bebGoogleMapsPromise
}

/** What `onPick` receives. Fields are null when Google didn't return
 *  them — the parent is responsible for "only fill if empty" logic. */
export interface BusinessPickResult {
  name: string | null
  address: string | null
  /** Raw 10-digit string (formatting stripped) so it slots into the
   *  PhoneInput component without further normalization. */
  phone: string | null
  /** Place's homepage URL — informational; nothing in the wholesale
   *  forms uses it yet, but it's a freebie if a future "Website"
   *  field shows up. */
  website: string | null
}

export interface BusinessAutocompleteInputProps {
  value: string
  /** Fires on every keystroke. */
  onChange: (v: string) => void
  /** Fires when the user picks a business from the dropdown. Use it to
   *  populate sibling fields (phone, billing address, etc). Note that
   *  `onChange` is also called with the canonical business name before
   *  `onPick` runs. */
  onPick?: (pick: BusinessPickResult) => void
  placeholder?: string
  /** ISO 3166-1 alpha-2 region codes. Default ['us']. */
  countries?: string[]
  className?: string
}

interface Suggestion {
  /** Main display line (typically the business name). */
  primary: string
  /** Secondary line (typically the city/state) — disambiguates two
   *  businesses with the same name in different markets. */
  secondary: string
  prediction: any
}

export default function BusinessAutocompleteInput({
  value, onChange, onPick, placeholder, countries = ['us'], className,
}: BusinessAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const sessionTokenRef = useRef<any>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placesReadyRef = useRef(false)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled) return
        const places = window.google?.maps?.places
        if (!places?.AutocompleteSuggestion) return
        placesReadyRef.current = true
        sessionTokenRef.current = new places.AutocompleteSessionToken()
      })
      .catch(() => { /* degrade silently — plain typing still works */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const fetchSuggestions = useCallback(async (input: string) => {
    // Late-recovery — when this component instance's useEffect missed
    // setting placesReadyRef (e.g., the script was already loaded by
    // a sibling component before this useEffect ran in some bundler
    // edge case), re-check window directly. Without this branch the
    // first vendor-form open could silently fail.
    if (!placesReadyRef.current) {
      const places = window.google?.maps?.places
      if (places?.AutocompleteSuggestion) {
        placesReadyRef.current = true
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new places.AutocompleteSessionToken()
        }
      } else {
        return
      }
    }
    if (!input || input.trim().length < 2) {
      setSuggestions([])
      return
    }
    try {
      const { AutocompleteSuggestion } = window.google.maps.places
      const request: any = {
        input: input.trim(),
        sessionToken: sessionTokenRef.current,
        // 'establishment' = any business / point-of-interest.
        // Cast wide here on purpose — wholesale vendors include
        // designers (manufacturer-type), local jewelers (retail),
        // and lab-grown suppliers (service-type), all of which
        // surface under different finer-grained types.
        includedPrimaryTypes: ['establishment'],
      }
      if (countries.length > 0) request.includedRegionCodes = countries
      const { suggestions: result } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
      const mapped: Suggestion[] = (result || [])
        .filter((s: any) => s.placePrediction)
        .slice(0, 6)
        .map((s: any) => {
          const p = s.placePrediction
          // PlacePrediction surfaces structured text via .structuredFormat
          // in the new API, but the older path .text still resolves for
          // back-compat. Try both.
          const primary = p?.structuredFormat?.mainText?.toString?.()
            || p?.text?.toString?.()
            || ''
          const secondary = p?.structuredFormat?.secondaryText?.toString?.() || ''
          return { primary, secondary, prediction: p }
        })
      setSuggestions(mapped)
      setActiveIdx(-1)
    } catch {
      // Network blip or rate limit — keep prior suggestions visible.
    }
  }, [countries])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onChange(v)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void fetchSuggestions(v) }, 200)
  }

  async function pickSuggestion(s: Suggestion) {
    try {
      const place = s.prediction.toPlace()
      // Request enough fields to populate the form one-shot. Phone +
      // address bump the SKU billing tier but the wholesale "create
      // vendor" cadence is low enough that the cost is negligible.
      await place.fetchFields({
        fields: [
          'displayName',
          'formattedAddress',
          'nationalPhoneNumber',
          'websiteURI',
        ],
      })
      const name = (place.displayName as string | undefined) || s.primary || null
      const address = (place.formattedAddress as string | undefined) || null
      const phoneRaw = (place.nationalPhoneNumber as string | undefined) || null
      const phoneDigits = phoneRaw ? phoneRaw.replace(/\D+/g, '') : null
      const website = (place.websiteURI as string | undefined) || null

      // Drive the controlled input to the canonical name first so the
      // text field is visually correct even if the parent's onPick is
      // a no-op or only fills siblings.
      if (name) onChange(name)
      onPick?.({ name, address, phone: phoneDigits, website })
    } catch {
      // Fall back to the prediction's display text so the user gets
      // at least the name in the field.
      onChange(s.primary)
    } finally {
      setOpen(false)
      setSuggestions([])
      setActiveIdx(-1)
      const places = window.google?.maps?.places
      if (places?.AutocompleteSessionToken) {
        sessionTokenRef.current = new places.AutocompleteSessionToken()
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < suggestions.length) {
        e.preventDefault()
        void pickSuggestion(suggestions[activeIdx])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={handleInputChange}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls="business-suggestions"
      />
      {open && suggestions.length > 0 && (
        <ul
          id="business-suggestions"
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%', left: 0, right: 0,
            zIndex: 1100,
            background: '#fff',
            border: '1px solid var(--pearl, #e2e8f0)',
            borderRadius: 6,
            marginTop: 2,
            padding: 0,
            listStyle: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => { e.preventDefault(); void pickSuggestion(s) }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--ink, #0f172a)',
                background: i === activeIdx ? 'var(--cream2, #f5f0e8)' : 'transparent',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--pearl, #e2e8f0)' : 'none',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <div style={{ fontWeight: 600 }}>{s.primary}</div>
              {s.secondary && (
                <div style={{ fontSize: 11, color: 'var(--mist, #64748b)' }}>{s.secondary}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
