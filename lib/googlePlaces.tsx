'use client'

import { useEffect, useRef, useState } from 'react'

export interface PlaceData {
  name: string
  address: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  website?: string
  phone?: string
}

/** Extract the bits we care about from a Google Places result. */
export function parsePlaceAddress(place: any) {
  const comps = place.address_components || []
  const get = (type: string) => comps.find((c: any) => c.types.includes(type))?.long_name || ''
  const getShort = (type: string) => comps.find((c: any) => c.types.includes(type))?.short_name || ''
  return {
    address: `${get('street_number')} ${get('route')}`.trim(),
    city: get('locality') || get('sublocality') || get('neighborhood'),
    state: getShort('administrative_area_level_1'),
    zip: get('postal_code'),
    lat: place.geometry?.location?.lat() || 0,
    lng: place.geometry?.location?.lng() || 0,
  }
}

/** Load the Google Maps Places script once per page. Multiple callers share the load. */
export function useGoogleMaps(): boolean {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).google?.maps?.places) { setLoaded(true); return }
    const existing = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existing) { existing.addEventListener('load', () => setLoaded(true)); return }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}&libraries=places`
    script.async = true
    script.onload = () => setLoaded(true)
    document.head.appendChild(script)
  }, [])
  return loaded
}

interface StoreSearchProps {
  onSelect: (data: PlaceData) => void
  placeholder?: string
}

/** Autocomplete input for finding a jewelry store via Google Places. */
export function StoreSearch({ onSelect, placeholder = 'Search for a jewelry store by name…' }: StoreSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mapsLoaded = useGoogleMaps()

  useEffect(() => {
    if (!mapsLoaded || !inputRef.current) return
    const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'us' },
      fields: ['name', 'address_components', 'formatted_address', 'geometry', 'website', 'formatted_phone_number'],
    })
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.address_components) return
      const addr = parsePlaceAddress(place)
      onSelect({
        ...addr,
        name: place.name || '',
        website: place.website || '',
        phone: place.formatted_phone_number || '',
      })
    })
  }, [mapsLoaded])

  return <input ref={inputRef} type="text" placeholder={placeholder} />
}
