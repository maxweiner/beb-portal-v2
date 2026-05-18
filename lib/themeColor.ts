/** Map from theme class to the <meta name="theme-color"> hex.
 *
 *  Each value is picked to match that theme's --sidebar-bg, so the
 *  PWA window chrome (macOS title bar, Chrome address bar on Android,
 *  status bar on iOS Safari) blends into the left rail instead of
 *  showing the legacy BEB green for every theme.
 *
 *  Used by both:
 *   • The boot script in app/layout.tsx (injected pre-hydration so a
 *     cold reload paints the right tint without a green flash)
 *   • The theme-sync effect in lib/context.tsx (kept in sync when the
 *     theme is changed at runtime)
 *
 *  Note: an *installed* PWA bakes its window chrome at install time
 *  from manifest.json's `theme_color`. Runtime <meta> updates affect
 *  browser tabs and freshly-loaded PWA windows, but already-running
 *  PWA windows may need a reload (or re-install) to pick up changes.
 */
export const THEME_COLOR_MAP: Record<string, string> = {
  'theme-bench':           '#0F2E3A', // patina-deep
  'theme-liberty-bench':   '#1A0E08', // walnut-deep
  'theme-liberty':         '#0F172A',
  'theme-liberty-gold':    '#0F172A',
  'theme-liberty-slate':   '#1E293B',
  'theme-liberty-patriot': '#3C3B6E',
  'theme-salesforce':      '#16325C',
  'theme-apple':           '#1C1C1E',
}

/** Default for the unscoped original BEB theme (no class on <html>). */
export const THEME_COLOR_DEFAULT = '#14532d'
