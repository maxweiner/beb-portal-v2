import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/context'

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
    icon: '/favicon.svg',
    apple: '/icons/beb-180.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BEB Portal',
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
