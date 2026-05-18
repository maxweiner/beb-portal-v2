import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/context'
import { BENCH_FAVICON_DATA_URI, BENCH_FAVICON_LINK_ID } from '@/lib/themeFavicon'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // viewport-fit=cover lets env(safe-area-inset-*) report real values on
  // notched iPhones in Safari + standalone PWA. Pages then opt-in via
  // padding: env(safe-area-inset-top) etc.
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'BEB Buyer Portal',
  description: 'Estate jewelry buying event management',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/icon-180.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BEB Portal',
  },
  // Next.js auto-emits <meta name="apple-mobile-web-app-capable"
  // content="yes"> from appleWebApp.capable, but Chrome now warns
  // that tag is deprecated unless the cross-platform equivalent is
  // also present. Adding both keeps iOS happy AND silences the
  // Chrome DevTools deprecation warning.
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

// Inline script that sets the theme class on <html> *before* React
// hydrates, so the very first paint already has the right brand colors
// even on slow mobile loads. Mirrors the standard dark-mode pattern.
// MUST stay in lockstep with `themeClass` derivation in lib/context.tsx —
// if you change the rules there, change them here too.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var brand = localStorage.getItem('beb-brand');
    if (brand !== 'beb' && brand !== 'liberty') brand = 'beb';
    var theme = localStorage.getItem('beb-theme') || 'original';
    var cls = '';
    if (brand === 'liberty') {
      cls = (theme.indexOf('liberty') === 0) ? ('theme-' + theme) : 'theme-liberty';
    } else {
      // brand=beb wins over a stale liberty-* theme.
      cls = (theme && theme !== 'original' && theme.indexOf('liberty') !== 0) ? ('theme-' + theme) : '';
    }
    if (cls) document.documentElement.classList.add(cls);
    // Bench-theme favicon override. Appended *after* the default
    // <link rel="icon"> tags Next.js rendered from metadata.icons —
    // browsers use the last matching rel=icon, so this wins without
    // us having to remove the originals. The runtime theme-sync effect
    // in lib/context.tsx adds/removes this same element on toggle.
    if (cls === 'theme-liberty-bench') {
      var l = document.createElement('link');
      l.id = ${JSON.stringify(BENCH_FAVICON_LINK_ID)};
      l.rel = 'icon';
      l.type = 'image/svg+xml';
      l.href = ${JSON.stringify(BENCH_FAVICON_DATA_URI)};
      document.head.appendChild(l);
    }
  } catch (e) {}
})();
`.trim()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  )
}
