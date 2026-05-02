'use client'

// Leads module — visible to sales reps (their assigned + captured
// leads), partners, admins. Phase 2 wires the route; manual lead
// CRUD lands in Phase 6, business-card OCR in Phase 7, territory-
// based auto-assignment in Phase 8, lead → trunk-show conversion
// in Phase 16.

import PlaceholderPage from './PlaceholderPage'

export default function Leads() {
  return (
    <PlaceholderPage
      title="🎯 Leads"
      phase="Sales Rollout · Phase 6 of 16"
      blurb="Leads pipeline — capture from trade shows or dashboard (manual entry + business-card scan), territory-based auto-assignment, and conversion into Trunk Show opportunities. Lands across Phases 6–8 and Phase 16."
    />
  )
}
