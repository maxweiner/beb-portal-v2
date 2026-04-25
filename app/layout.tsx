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
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BEB Portal',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  )
}
