// Shared types for carrier tracking integrations (FedEx, UPS, …).
// Carrier modules normalize their responses into CarrierStatusResult so
// the rest of the app never has to think about per-carrier field names.

export type NormalizedStatus =
  | 'unknown'
  | 'label_created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned'

export interface CarrierStatusResult {
  status: NormalizedStatus
  /** Carrier's own status code/label, kept for debugging + display. */
  statusDetail: string | null
  /** Most recent scan description ("Departed FedEx location"). */
  lastEvent: string | null
  /** When the last event happened (carrier timestamp, ISO). */
  eventAt: string | null
  /** Estimated delivery date if the carrier provided one (YYYY-MM-DD). */
  eta: string | null
  /** Actual delivery timestamp when status === 'delivered'. */
  deliveredAt: string | null
  /** Raw carrier payload for the row in case we want to inspect it later. */
  raw: unknown
}

export class CarrierError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'CarrierError'
  }
}
