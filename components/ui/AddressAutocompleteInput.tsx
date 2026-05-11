'use client'

// Google Places-backed address input. Falls back to a plain text
// input when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY isn't set or the Maps
// script fails to load — typing still works, the user just won't
// get suggestions.
//
// MIGRATION NOTE (May 2026): the legacy
// google.maps.places.Autocomplete widget is blocked for API keys
// created after March 1, 2025 ("not available to new customers" —
// keys silently return zero suggestions). We use the newer
// google.maps.places.AutocompleteSuggestion data API instead,
// which works for all keys, and render our own dropdown so we keep
// the controlled-input contract (value + onChange) that every
// caller relies on.
//
// Required GCP setup:
//   - Enable "Places API (New)" on the GCP project. (The new API
//     is distinct from the legacy "Places API" — both names appear
//     in the GCP console.)
//   - Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to Vercel env. If the key
//     is HTTP-referrer-restricted, allow https://portal.bebllp.com/*
//     and https://*.vercel.app/* (for preview deploys).

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

export interface AddressAutocompleteInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Restrict suggestions to ISO 3166-1 alpha-2 country codes. Default: ['us']. */
  countries?: string[]
  /** Forwarded to the underlying <input> for styling parity with sibling inputs. */
  className?: string
  inputType?: 'text' | 'search'
}

interface Suggestion {
  /** Already-formatted display string for the dropdown row. */
  display: string
  /** The full PlacePrediction so we can convert → Place → fetchFields(). */
  prediction: any
}

export default function AddressAutocompleteInput({
  value, onChange, placeholder, countries = ['us'], className, inputType = 'text',
}: AddressAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  // Session token groups N autocomplete requests + 1 place-details
  // fetch into a single billing session. Refreshed after every pick
  // so the next address gets its own session.
  const sessionTokenRef = useRef<any>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placesReadyRef = useRef(false)

  // Load the Maps JS once on mount + warm a session token.
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
      .catch(() => { /* swallow — degrade to plain typing */ })
    return () => { cancelled = true }
  }, [])

  // Click-outside closes the dropdown. Captured on the wrapper so
  // clicking a suggestion still fires its handler first.
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
    if (!placesReadyRef.current) return
    if (!input || input.trim().length < 3) {
      setSuggestions([])
      return
    }
    try {
      const { AutocompleteSuggestion } = window.google.maps.places
      const request: any = {
        input: input.trim(),
        sessionToken: sessionTokenRef.current,
        // Address-style results only — skips POIs, businesses, etc.
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
      }
      if (countries.length > 0) {
        // New API uses ISO 3166-1 alpha-2 codes in includedRegionCodes.
        request.includedRegionCodes = countries
      }
      const { suggestions: result } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
      const mapped: Suggestion[] = (result || [])
        .filter((s: any) => s.placePrediction)
        .slice(0, 6)
        .map((s: any) => ({
          display: s.placePrediction.text?.toString?.() || '',
          prediction: s.placePrediction,
        }))
      setSuggestions(mapped)
      setActiveIdx(-1)
    } catch {
      // Network blip or rate-limit — just keep current suggestions
      // so the user doesn't get a flicker. Plain typing still works.
    }
  }, [countries])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onChange(v)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // 200ms debounce — under Places' "type-ahead" SLA and well above
    // typical keystroke cadence, so we don't burn quota on every key.
    debounceRef.current = setTimeout(() => { void fetchSuggestions(v) }, 200)
  }

  async function pickSuggestion(s: Suggestion) {
    try {
      // Convert prediction → Place → fetch only the formatted address.
      // Limiting fields keeps the Place Details billing tier at "ID".
      const place = s.prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress'] })
      const formatted = place.formattedAddress || s.display
      onChange(formatted)
    } catch {
      // If the place fetch fails, fall back to the prediction's
      // already-displayed text so the user still gets *something*.
      onChange(s.display)
    } finally {
      setOpen(false)
      setSuggestions([])
      setActiveIdx(-1)
      // Refresh the session token so the next address is a new
      // billing session (otherwise we'd keep paying autocomplete-
      // session rates on a session that already had its details call).
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
        type={inputType}
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
        aria-controls="address-suggestions"
      />
      {open && suggestions.length > 0 && (
        <ul
          id="address-suggestions"
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
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === activeIdx}
              // mousedown (not click) so the input's blur doesn't
              // close the dropdown before the click registers.
              onMouseDown={(e) => { e.preventDefault(); void pickSuggestion(s) }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--ink, #0f172a)',
                background: i === activeIdx ? 'var(--cream2, #f5f0e8)' : 'transparent',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--pearl, #e2e8f0)' : 'none',
              }}
            >
              {s.display}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
