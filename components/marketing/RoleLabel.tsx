// Tiny shared component for the gray "(who is responsible)" suffix
// next to section headers and input labels in the marketing module.
//
// Usage:
//   <h3>1. Setup <RoleLabel>(Buyers)</RoleLabel></h3>
//   <label>Marketing Budget <RoleLabel>(Buyers)</RoleLabel></label>

import type { ReactNode } from 'react'

export default function RoleLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{
      marginLeft: 6,
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--mist)',
      letterSpacing: '.02em',
    }}>
      {children}
    </span>
  )
}
