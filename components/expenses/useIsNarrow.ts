'use client'

// Tiny media-query hook: true when the viewport is narrower than the
// breakpoint (default ~tablet portrait). Used to swap dense desktop
// tables for stacked card layouts on phones. Mirrors the inline
// version in components/schedule/Schedule.tsx; lifted here so other
// expense surfaces can share it.

import { useEffect, useState } from 'react'

export function useIsNarrow(breakpoint = 720): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  )
  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth <= breakpoint)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return narrow
}
