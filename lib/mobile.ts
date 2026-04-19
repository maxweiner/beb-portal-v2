// Mobile detection utilities

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export function getMobilePreference(): boolean | null {
  if (typeof window === 'undefined') return null
  const pref = localStorage.getItem('beb_mobile_mode')
  if (pref === null) return null
  return pref === 'true'
}

export function setMobilePreference(mobile: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem('beb_mobile_mode', String(mobile))
}

export function shouldUseMobile(): boolean {
  const pref = getMobilePreference()
  if (pref !== null) return pref
  return isMobileDevice()
}
