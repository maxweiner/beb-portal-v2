import type { Metadata } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/context'

export const metadata: Metadata = {
  title: 'BEB Buyer Portal',
  description: 'Estate jewelry buying event management',
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
