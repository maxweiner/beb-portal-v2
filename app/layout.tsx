import type { Metadata } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/context'

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
