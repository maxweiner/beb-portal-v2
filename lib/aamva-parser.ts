/**
 * AAMVA PDF417 Barcode Parser
 * 
 * Parses the raw string from PDF417 barcodes on US driver's licenses
 * following AAMVA Card Design Standard (versions 01–10+).
 * 
 * Privacy: This module runs entirely client-side. No data is logged,
 * sent to any API, or persisted — it only returns a typed object.
 */

export interface ParsedLicense {
  firstName: string
  middleName: string
  lastName: string
  dateOfBirth: string        // ISO format YYYY-MM-DD
  address: {
    street: string
    city: string
    state: string
    zip: string
  }
  licenseNumber: string
  licenseState: string       // 2-letter issuing jurisdiction
  expirationDate: string     // ISO format YYYY-MM-DD
  sex: 'M' | 'F' | 'X' | ''
  eyeColor: string
  height: string
  isOver18: boolean
  rawFieldCount: number      // how many fields were successfully parsed
}

// AAMVA date format: MMDDYYYY or YYYYMMDD (version-dependent)
function parseAAMVADate(raw: string): string {
  if (!raw || raw.length < 8) return ''

  const cleaned = raw.replace(/[^0-9]/g, '')
  if (cleaned.length < 8) return ''

  // Try MMDDYYYY first (most common, versions 01–08)
  const mm1 = parseInt(cleaned.substring(0, 2), 10)
  const dd1 = parseInt(cleaned.substring(2, 4), 10)
  const yyyy1 = parseInt(cleaned.substring(4, 8), 10)

  if (mm1 >= 1 && mm1 <= 12 && dd1 >= 1 && dd1 <= 31 && yyyy1 >= 1900 && yyyy1 <= 2100) {
    return `${yyyy1}-${String(mm1).padStart(2, '0')}-${String(dd1).padStart(2, '0')}`
  }

  // Try YYYYMMDD (some version 09+ implementations)
  const yyyy2 = parseInt(cleaned.substring(0, 4), 10)
  const mm2 = parseInt(cleaned.substring(4, 6), 10)
  const dd2 = parseInt(cleaned.substring(6, 8), 10)

  if (yyyy2 >= 1900 && yyyy2 <= 2100 && mm2 >= 1 && mm2 <= 12 && dd2 >= 1 && dd2 <= 31) {
    return `${yyyy2}-${String(mm2).padStart(2, '0')}-${String(dd2).padStart(2, '0')}`
  }

  return ''
}

function parseSex(raw: string): 'M' | 'F' | 'X' | '' {
  const code = raw.trim().toUpperCase()
  if (code === '1' || code === 'M') return 'M'
  if (code === '2' || code === 'F') return 'F'
  if (code === '9' || code === 'X') return 'X'
  return ''
}

function checkOver18(dobISO: string): boolean {
  if (!dobISO) return false
  const dob = new Date(dobISO + 'T00:00:00')
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age >= 18
}

function parseEyeColor(raw: string): string {
  const map: Record<string, string> = {
    'BLK': 'Black', 'BLU': 'Blue', 'BRO': 'Brown',
    'GRY': 'Gray', 'GRN': 'Green', 'HAZ': 'Hazel',
    'MAR': 'Maroon', 'PNK': 'Pink', 'DIC': 'Dichromatic',
    'UNK': 'Unknown',
  }
  const code = raw.trim().toUpperCase()
  return map[code] || code
}

function parseHeight(raw: string): string {
  const cleaned = raw.trim()
  if (/^\d{3}$/.test(cleaned)) {
    const feet = cleaned[0]
    const inches = cleaned.substring(1)
    return `${feet}'${parseInt(inches, 10)}"`
  }
  return cleaned
}

/**
 * Parse raw AAMVA PDF417 barcode data into structured fields.
 */
export function parseAAMVABarcode(raw: string): ParsedLicense {
  const result: ParsedLicense = {
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    address: { street: '', city: '', state: '', zip: '' },
    licenseNumber: '',
    licenseState: '',
    expirationDate: '',
    sex: '',
    eyeColor: '',
    height: '',
    isOver18: false,
    rawFieldCount: 0,
  }

  if (!raw || raw.length < 10) return result

  // Split into lines — barcodes use \n, \r\n, \r, or record/unit separators
  const lines = raw.split(/[\n\r\x1e\x1f]+/).filter(Boolean)

  let fieldCount = 0

  const handlers: Record<string, (val: string) => void> = {
    // Full name in single field (older versions): LAST,FIRST,MIDDLE
    'DAA': (v) => {
      const parts = v.split(',').map(s => s.trim())
      if (parts.length >= 1) result.lastName = parts[0]
      if (parts.length >= 2) result.firstName = parts[1]
      if (parts.length >= 3) result.middleName = parts[2]
    },
    'DCS': (v) => { result.lastName = v.trim() },
    'DAC': (v) => { result.firstName = v.trim() },
    'DCT': (v) => {
      const parts = v.split(/[, ]+/)
      if (parts[0]) result.firstName = parts[0].trim()
      if (parts[1]) result.middleName = parts[1].trim()
    },
    'DAD': (v) => { result.middleName = v.trim() },
    'DBB': (v) => { result.dateOfBirth = parseAAMVADate(v) },
    'DAG': (v) => { result.address.street = v.trim() },
    'DAI': (v) => { result.address.city = v.trim() },
    'DAJ': (v) => {
      result.address.state = v.trim()
      if (!result.licenseState) result.licenseState = v.trim()
    },
    'DAK': (v) => { result.address.zip = v.trim().substring(0, 10) },
    'DAQ': (v) => { result.licenseNumber = v.trim() },
    'DBA': (v) => { result.expirationDate = parseAAMVADate(v) },
    'DBC': (v) => { result.sex = parseSex(v) },
    'DAY': (v) => { result.eyeColor = parseEyeColor(v) },
    'DAU': (v) => { result.height = parseHeight(v) },
  }

  for (const line of lines) {
    for (const code of Object.keys(handlers)) {
      if (line.startsWith(code)) {
        const value = line.substring(code.length)
        if (value) {
          handlers[code](value)
          fieldCount++
        }
        break
      }
    }
  }

  result.rawFieldCount = fieldCount
  result.isOver18 = checkOver18(result.dateOfBirth)

  return result
}

/**
 * Validate that a parsed license has the minimum fields needed.
 */
export function isValidParsedLicense(parsed: ParsedLicense): { valid: boolean; missing: string[] } {
  const missing: string[] = []
  if (!parsed.firstName && !parsed.lastName) missing.push('name')
  if (!parsed.dateOfBirth) missing.push('date of birth')
  if (!parsed.licenseNumber) missing.push('license number')
  if (!parsed.address.street && !parsed.address.city) missing.push('address')

  return { valid: missing.length === 0, missing }
}
