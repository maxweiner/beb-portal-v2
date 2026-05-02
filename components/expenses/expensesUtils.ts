// Shared helpers for the Expenses & Invoicing module — category
// labels/icons, status pill styling, currency formatting.

import type { ExpenseCategory, ExpenseReportStatus } from '@/types'

export const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'flight',             label: 'Flight',             icon: '✈️' },
  { value: 'rental_car',         label: 'Rental car',         icon: '🚗' },
  { value: 'rideshare',          label: 'Rideshare / Taxi',   icon: '🚕' },
  { value: 'hotel',              label: 'Hotel',              icon: '🏨' },
  { value: 'meals',              label: 'Meals',              icon: '🍽' },
  { value: 'shipping_supplies',  label: 'Shipping supplies',  icon: '📦' },
  { value: 'jewelry_lots_cash',  label: 'Jewelry lots (cash)', icon: '💎' },
  { value: 'mileage',            label: 'Mileage',            icon: '🛣' },
  { value: 'custom',             label: 'Custom',             icon: '•' },
]

const CATEGORY_LOOKUP: Record<ExpenseCategory, { label: string; icon: string }> =
  Object.fromEntries(CATEGORY_OPTIONS.map(o => [o.value, { label: o.label, icon: o.icon }])) as any

export function categoryLabel(c: ExpenseCategory, customLabel?: string | null): string {
  if (c === 'custom' && customLabel) return customLabel
  return CATEGORY_LOOKUP[c]?.label ?? c
}
export function categoryIcon(c: ExpenseCategory): string {
  return CATEGORY_LOOKUP[c]?.icon ?? '•'
}

export const STATUS_LABEL: Record<ExpenseReportStatus, string> = {
  // 'active' is the DB enum but the buyer hasn't actually done
  // anything yet — it's a draft. Display label reflects that.
  active: 'Non-Submitted',
  submitted_pending_review: 'Pending review',
  approved: 'Approved',
  paid: 'Paid',
}

export const STATUS_COLOR: Record<ExpenseReportStatus, { bg: string; fg: string }> = {
  active:                   { bg: '#E5E7EB', fg: '#374151' },
  submitted_pending_review: { bg: '#FEF3C7', fg: '#92400E' },
  approved:                 { bg: '#D1FAE5', fg: '#065F46' },
  paid:                     { bg: '#DBEAFE', fg: '#1E40AF' },
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export function formatCurrency(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  return USD.format(Number.isFinite(v) ? v : 0)
}

export function formatDateLong(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
export function formatDateShort(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
