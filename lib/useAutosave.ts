'use client'

import { useEffect, useRef, useState, createElement, type CSSProperties, type ReactElement } from 'react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Options {
  delay?: number
  enabled?: boolean
}

export function useAutosave<T>(
  data: T,
  save: (data: T) => Promise<void> | void,
  options: Options = {}
): AutosaveStatus {
  const { delay = 1000, enabled = true } = options
  const [status, setStatus] = useState<AutosaveStatus>('idle')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  const dataRef = useRef(data)
  const lastSavedRef = useRef<string>(JSON.stringify(data))
  const mountedRef = useRef(true)

  saveRef.current = save
  dataRef.current = data

  useEffect(() => () => { mountedRef.current = false }, [])

  const current = JSON.stringify(data)

  useEffect(() => {
    // When disabled (e.g., still loading), keep the baseline in sync with
    // current data so we don't fire a spurious save when enabling later.
    if (!enabled) {
      lastSavedRef.current = current
      return
    }
    if (current === lastSavedRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)
    if (clearRef.current) clearTimeout(clearRef.current)
    setStatus('saving')

    timerRef.current = setTimeout(async () => {
      const snapshot = current
      try {
        await saveRef.current(dataRef.current)
        if (!mountedRef.current) return
        lastSavedRef.current = snapshot
        setStatus('saved')
        clearRef.current = setTimeout(() => {
          if (!mountedRef.current) return
          setStatus(s => (s === 'saved' ? 'idle' : s))
        }, 2000)
      } catch (err) {
        console.error('Autosave failed:', err)
        if (!mountedRef.current) return
        setStatus('error')
      }
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [current, enabled, delay])

  return status
}

export function AutosaveIndicator({ status }: { status: AutosaveStatus }): ReactElement | null {
  if (status === 'idle') return null

  const style: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    marginLeft: 8,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  }

  if (status === 'saving') {
    return createElement(
      'span',
      { style: { ...style, color: 'var(--mist)' } },
      createElement('span', { style: { display: 'inline-block' } }, '⟳'),
      'Saving…'
    )
  }
  if (status === 'saved') {
    return createElement(
      'span',
      { style: { ...style, color: 'var(--green)' } },
      '✓ Saved'
    )
  }
  // error
  return createElement(
    'span',
    { style: { ...style, color: '#ef4444' } },
    '⚠ Save failed'
  )
}
