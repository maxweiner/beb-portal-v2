'use client'

// Sidebar badge feeder. Counts OPEN mismatches + duplicates +
// orphans for the active brand, so accounting sees a red dot
// without having to remember to check /reconciliation.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

export function useReconciliationAlerts(): { count: number; loaded: boolean } {
  const { user, brand } = useApp()
  const isAllowed = user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  const [count, setCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isAllowed || !brand) { setCount(0); setLoaded(true); return }
    let cancelled = false

    const load = async () => {
      const { count: c } = await supabase
        .from('reconciliation_findings')
        .select('id', { count: 'exact', head: true })
        .eq('brand', brand)
        .eq('status', 'open')
        .in('finding_type', ['amount_mismatch', 'duplicate_clearing', 'orphan_cleared'])
      if (cancelled) return
      setCount(c ?? 0)
      setLoaded(true)
    }
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [isAllowed, brand])

  return { count, loaded }
}
