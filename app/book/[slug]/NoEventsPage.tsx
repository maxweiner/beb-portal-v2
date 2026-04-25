import { Diamond } from 'lucide-react'
import type { BookingStore } from '@/lib/appointments/types'
import { formatPhoneDisplay } from '@/lib/phone'

export default function NoEventsPage({ store }: { store: BookingStore }) {
  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'

  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      <header className="px-4 pb-6 bg-white" style={{
        borderBottom: `4px solid ${primary}`,
        paddingTop: 'max(env(safe-area-inset-top), 32px)',
      }}>
        <div className="max-w-md mx-auto flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight" style={{ color: primary }}>{store.name}</h1>
            {(store.owner_phone || store.owner_email) && (
              <div className="text-sm text-gray-700 mt-1 leading-snug">
                {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                {store.owner_email && <div className="break-all">{store.owner_email}</div>}
              </div>
            )}
          </div>
          <div className="shrink-0">
            {store.store_image_url ? (
              <img src={store.store_image_url} alt={`${store.name} logo`}
                className="h-28 w-28 rounded-xl object-cover" />
            ) : (
              <div className="h-28 w-28 rounded-xl flex items-center justify-center"
                style={{ background: '#f3f4f6', color: primary }}>
                <Diamond className="h-12 w-12" strokeWidth={1.5} />
              </div>
            )}
          </div>
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
