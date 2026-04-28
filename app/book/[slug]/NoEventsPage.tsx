import { Diamond } from 'lucide-react'
import type { BookingStore } from '@/lib/appointments/types'
import { formatPhoneDisplay } from '@/lib/phone'

export default function NoEventsPage({ store }: { store: BookingStore }) {
  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'

  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      <header className="px-5 pt-4 pb-3 bg-white flex items-center gap-3 max-w-md mx-auto"
        style={{
          borderTop: `4px solid ${primary}`,
          paddingTop: 'max(env(safe-area-inset-top), 16px)',
        }}>
        {store.store_image_url ? (
          <img src={store.store_image_url} alt={`${store.name} logo`}
            className="h-10 w-auto max-w-[6rem] rounded-lg object-contain bg-white" />
        ) : (
          <div className="h-10 w-10 rounded-lg flex items-center justify-center"
            style={{ background: '#f3f4f6', color: primary }}>
            <Diamond className="h-5 w-5" strokeWidth={1.5} />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="font-extrabold leading-tight" style={{ color: primary, fontSize: '1.125rem' }}>{store.name}</div>
          {store.city && (
            <div className="text-gray-500 leading-tight" style={{ fontSize: '0.8125rem' }}>
              {store.city}{store.state ? `, ${store.state}` : ''}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-10">
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <h2 className="text-xl font-bold mb-2" style={{ color: primary }}>
            No upcoming events
          </h2>
          <p className="text-gray-700">
            We don't have any buying events scheduled at {store.name} right now.
            Check back soon, or call the store for the next visit.
          </p>
        </div>
      </main>
    </div>
  )
}
