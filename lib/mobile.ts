// Mobile detection utilities
//
// Policy (2026-05-15): every fresh app load picks the layout from
// the DEVICE — desktop browsers get the desktop layout, phones get
// MobileLayout. We no longer remember the user's last manual choice
// across browser sessions.
//
// Within a single browser TAB the user can still override
// (Switch to mobile / Switch to desktop links). That override
// lives in sessionStorage so it survives a refresh in that tab
// but a fresh window or a new device starts from the device
// default. Matches the spec: "always open to default; don't
// remember what the state was last."
//
// Legacy: the prior version persisted the toggle in
// localStorage('beb_mobile_mode'). On first load we sweep that
// key out so stale prefs from before this change don't keep
// forcing the wrong layout.

const STORAGE_KEY = 'beb_mobile_mode'

function clearLegacyLocalPref(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch { /* private mode / disabled storage — ignore */ }
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/**
 * Per-tab override read from sessionStorage. NULL means no
 * override; caller falls back to device detection. Sweeps the
 * legacy localStorage key on each call so users who had a stale
 * pref from before 2026-05-15 get the fresh device-based default
 * on their next page load.
 */
export function getMobilePreference(): boolean | null {
  if (typeof window === 'undefined') return null
  clearLegacyLocalPref()
  try {
    const pref = window.sessionStorage.getItem(STORAGE_KEY)
    if (pref === null) return null
    return pref === 'true'
  } catch {
    return null
  }
}

/**
 * Write the per-tab override. sessionStorage means: survives a
 * refresh in this tab, gone when the tab closes (or in any other
 * tab / fresh browser window).
 */
export function setMobilePreference(mobile: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(mobile))
    // Belt-and-suspenders cleanup of the legacy key in case the
    // user landed here via the toggle without a prior page load.
    clearLegacyLocalPref()
  } catch { /* private mode / disabled storage — ignore */ }
}

export function shouldUseMobile(): boolean {
  const pref = getMobilePreference()
  if (pref !== null) return pref
  return isMobileDevice()
}
