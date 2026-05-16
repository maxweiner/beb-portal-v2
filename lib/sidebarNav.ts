// Shared sidebar nav definition. Extracted from
// components/layout/Sidebar.tsx so other surfaces (e.g. the Settings
// → 🧭 Sidebar Items visibility panel) can iterate over the same
// list without duplicating it.
//
// Anytime you'd be tempted to add a sidebar item, add it here — the
// Sidebar component reads from this file and so does the visibility
// panel that lets users hide/show individual rows.

import type { NavPage } from '@/app/page'

export interface SidebarNavItem {
  id?: NavPage
  label: string
  iconKey?: string
  section?: boolean
}

// Dashboard sits above the four section groups (Buying / Selling /
// Operations / Admin) since it's the home landing — items with no
// section header preceding them render unconditionally.
export const BEB_NAV: SidebarNavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',         iconKey: 'dashboard' },
  { id: 'calendar',      label: 'Calendar',          iconKey: 'schedule' },
  { label: 'Buying', section: true },
  // Nav id renames (2026-05-06): the buyer appointment-schedule page
  // moved from id 'calendar' → 'appointments' so that 'calendar' could
  // become the buyer time-off + event calendar (formerly id 'schedule').
  // Together with 'events' → 'buying-events' and 'libertyadmin' →
  // 'liberty-admin'. See supabase-migration-rename-nav-ids.sql.
  { id: 'appointments',        label: 'Appointments',        iconKey: 'calendar' },
  { id: 'buying-events',       label: 'Buying Events',       iconKey: 'events' },
  { id: 'buying-event-stores', label: 'Buying Event Stores', iconKey: 'stores' },
  { id: 'travel',              label: 'Travel Share',        iconKey: 'travel' },
  { id: 'dayentry',            label: 'Enter Buying Data',   iconKey: 'dayentry' },
  { id: 'buy-intake',          label: '🪪 Buy Intake',       iconKey: 'dayentry' },
  { id: 'intake-lookup',       label: 'Buy Form Lookup',     iconKey: 'reports' },
  { id: 'buying-communications', label: 'Buying Communications', iconKey: 'marketing' },
  { label: 'Selling', section: true },
  { id: 'trade-shows',       label: 'Trade Shows',       iconKey: 'tradeshows' },
  { id: 'trunk-shows',       label: 'Trunk Shows',       iconKey: 'trunkshows' },
  { id: 'trunk-show-stores', label: 'Trunk Show Stores', iconKey: 'stores' },
  { id: 'trunk-communications', label: 'Trunk Communications', iconKey: 'marketing' },
  { id: 'leads',             label: 'Leads',             iconKey: 'leads' },
  { label: 'Operations', section: true },
  { id: 'marketing',         label: 'Marketing',         iconKey: 'marketing' },
  { id: 'shipping',          label: 'Shipping',          iconKey: 'shipping' },
  { id: 'expenses',          label: 'Expenses',          iconKey: 'expenses' },
  { id: 'accounting-hub',    label: 'Accounting Hub',    iconKey: 'expenses' },
  { id: 'reconciliation',    label: 'Reconciliation',    iconKey: 'financials' },
  { id: 'broadcast',         label: '📣 Broadcast',      iconKey: 'marketing' },
  { id: 'customers',         label: 'Customers',         iconKey: 'staff' },
  { label: 'Admin', section: true },
  { id: 'admin',         label: 'Admin Panel',       iconKey: 'admin' },
  { id: 'reports',       label: 'Reports',           iconKey: 'reports' },
  { id: 'staff',         label: 'Staff',             iconKey: 'staff' },
  { id: 'data-research', label: 'Data Research',     iconKey: 'reports' },
  { id: 'financials',    label: 'Financials',        iconKey: 'financials' },
]

export const LIBERTY_NAV: SidebarNavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',         iconKey: 'dashboard' },
  { id: 'calendar',      label: 'Calendar',          iconKey: 'schedule' },
  { label: 'Buying', section: true },
  { id: 'appointments',        label: 'Appointments',        iconKey: 'calendar' },
  { id: 'buying-events',       label: 'Buying Events',       iconKey: 'events' },
  { id: 'buying-event-stores', label: 'Buying Event Stores', iconKey: 'stores' },
  { id: 'travel',              label: 'Travel Share',        iconKey: 'travel' },
  { id: 'dayentry',            label: 'Enter Buying Data',   iconKey: 'dayentry' },
  { label: 'Operations', section: true },
  { id: 'marketing',    label: 'Marketing',      iconKey: 'marketing' },
  { id: 'shipping',     label: 'Shipping',       iconKey: 'shipping' },
  { id: 'expenses',     label: 'Expenses',       iconKey: 'expenses' },
  { id: 'accounting-hub', label: 'Accounting Hub', iconKey: 'expenses' },
  { id: 'reconciliation', label: 'Reconciliation', iconKey: 'financials' },
  { id: 'customers',    label: 'Customers',      iconKey: 'staff' },
  { label: 'Admin', section: true },
  { id: 'wholesale',     label: 'Inventory POS',        iconKey: 'stores' },
  { id: 'liberty-admin', label: 'Liberty Admin Panel', iconKey: 'admin' },
  { id: 'reports',       label: 'Reports',             iconKey: 'reports' },
  { id: 'staff',         label: 'Staff',               iconKey: 'staff' },
  { id: 'data-research', label: 'Data Research',       iconKey: 'reports' },
  { id: 'financials',    label: 'Financials',          iconKey: 'financials' },
]

// Items the user can never hide. Hiding Dashboard would brick
// navigation (it's the home landing and the most common return-to-
// safety target). Settings doesn't appear in the nav list at all —
// it lives in the sidebar footer as a gear button — so users can
// always reach it to un-hide things.
export const ALWAYS_VISIBLE_NAV: NavPage[] = ['dashboard']
