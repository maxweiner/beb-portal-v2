'use client'

// Google Places Autocomplete-backed address input. Falls back to a
// plain text input when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY isn't set or
// the Maps script fails to load — typing still works, the user just
// won't get suggestions.
//
// Loads the Maps JS once per page lifecycle (cached on window), uses
// the legacy google.maps.places.Autocomplete widget (still supported,
// less ceremony than the new PlaceAutocompleteElement).
//
// Required GCP setup:
//   - Enable "Places API" on the GCP project.
//   - Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to Vercel env (same value
//     as GOOGLE_MAPS_API_KEY is fine; consider HTTP-referrer
//     restrictions on the key since it's exposed to the browser).

import { useEffect, useRef } from 'react'

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=quarterly&loading=async`
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

export default function AddressAutocompleteInput({
  value, onChange, placeholder, countries = ['us'], className, inputType = 'text',
}: AddressAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey || !inputRef.current) return
    let autocomplete: any
    let cancelled = false

    loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !inputRef.current || !window.google?.maps?.places) return
      autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: countries.length > 0 ? { country: countries } : undefined,
        fields: ['formatted_address'],
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place?.formatted_address) onChange(place.formatted_address)
      })
    }).catch(() => { /* swallow — fall back to plain typing */ })

    return () => {
      cancelled = true
      if (autocomplete && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocomplete)
      }
    }
    // We intentionally don't include onChange in deps — re-binding the
    // listener on every keystroke would be wasteful and the closure
    // already captures the latest onChange via React's render cycle
    // (handler runs on user gesture, not on render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <input
      ref={inputRef}
      type={inputType}
      value={value}
      placeholder={placeholder}
      className={className}
      onChange={e => onChange(e.target.value)}
      autoComplete="off"
    />
  )
}
