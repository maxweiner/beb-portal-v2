import type {
  AppointmentLite,
  SlotBlockLite,
  Slot,
} from './types'

// Normalize 'HH:MM' or 'HH:MM:SS' → 'HH:MM'
function normTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t
}

// Convert 'HH:MM' to total minutes since 00:00
function toMinutes(t: string): number {
  const [h, m] = normTime(t).split(':').map(Number)
  return h * 60 + m
}

// Convert minutes since 00:00 to 'HH:MM'
function fromMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export interface BuildSlotsArgs {
  date: string                  // 'YYYY-MM-DD'
  startTime: string             // 'HH:MM' (inclusive)
  endTime: string               // 'HH:MM' (exclusive — last slot starts at endTime - intervalMinutes)
  intervalMinutes: number
  maxConcurrent: number
  bookings: AppointmentLite[]   // appointments for this event (we filter inside)
  blocks: SlotBlockLite[]       // blocks for this event (we filter inside)
  now?: Date                    // for past-slot detection; defaults to new Date()
}

/**
 * Pure function. Given a day's hours, slot interval, capacity, and the existing
 * bookings + blocks for that day, return the full slot list with availability.
 *
 * Cancelled appointments do not count toward booked capacity.
 */
export function buildSlotsForDay(args: BuildSlotsArgs): Slot[] {
  const {
    date,
    startTime,
    endTime,
    intervalMinutes,
    maxConcurrent,
    bookings,
    blocks,
    now = new Date(),
  } = args

  const startMin = toMinutes(startTime)
  const endMin = toMinutes(endTime)
  if (endMin <= startMin) return []

  // Bookings keyed by 'HH:MM', counting only confirmed for this date
  const bookedCount = new Map<string, number>()
  for (const b of bookings) {
    if (b.appointment_date !== date) continue
    if (b.status !== 'confirmed') continue
    const key = normTime(b.appointment_time)
    bookedCount.set(key, (bookedCount.get(key) ?? 0) + 1)
  }

  // Blocks keyed by 'HH:MM' for this date
  const blockedSet = new Set<string>()
  for (const block of blocks) {
    if (block.block_date !== date) continue
    blockedSet.add(normTime(block.block_time))
  }

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const isToday = date === todayStr
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : -1

  const slots: Slot[] = []
  for (let m = startMin; m < endMin; m += intervalMinutes) {
    const time = fromMinutes(m)
    const booked = bookedCount.get(time) ?? 0
    const blocked = blockedSet.has(time)
    const available = blocked ? 0 : Math.max(0, maxConcurrent - booked)
    const isPast = isToday && m <= nowMin
    slots.push({
      time,
      capacity: maxConcurrent,
      booked,
      blocked,
      available,
      isPast,
    })
  }
  return slots
}

/**
 * Resolve hours for a specific day-of-event, applying event overrides on top of
 * store defaults. Returns null if that day has no hours configured.
 */
export function hoursForEventDay(
  dayNumber: 1 | 2 | 3,
  storeDefaults: { day1_start: string | null; day1_end: string | null; day2_start: string | null; day2_end: string | null; day3_start: string | null; day3_end: string | null },
  eventOverride?: { day1_start: string | null; day1_end: string | null; day2_start: string | null; day2_end: string | null; day3_start: string | null; day3_end: string | null } | null,
): { start: string; end: string } | null {
  const startKey = `day${dayNumber}_start` as const
  const endKey = `day${dayNumber}_end` as const
  const start = eventOverride?.[startKey] ?? storeDefaults[startKey]
  const end = eventOverride?.[endKey] ?? storeDefaults[endKey]
  if (!start || !end) return null
  return { start: normTime(start), end: normTime(end) }
}
