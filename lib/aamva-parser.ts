/**
 * AAMVA PDF417 Barcode Parser
 * 
 * Privacy: This module runs entirely client-side. Debug mode only
 * exposes structural info (char codes, delimiters, field codes) —
 * never personal data.
 */

export interface ParsedLicense {
  firstName: string
  middleName: string
  lastName: string
  dateOfBirth: string
  address: {
    street: string
    city: string
    state: string
    zip: string
  }
  licenseNumber: string
  licenseState: string
  expirationDate: string
  sex: 'M' | 'F' | 'X' | ''
  eyeColor: string
  height: string
  isOver18: boolean
  rawFieldCount: number
}

export interface ParseDiagnostics {
  totalLength: number
  headerCharCodes: number[]  // first 20 char codes
  delimitersFound: string[]  // which delimiter types exist
  linesAfterSplit: number
  fieldCodesFound: string[]  // 3-char codes we recognized
  fieldCodesSeen: string[]   // all 3-char codes at line starts
  hasANSIHeader: boolean
  hasComplianceIndicator: boolean
  rawPrefix: string          // first 40 chars with non-printable shown as [XX]
}

function parseAAMVADate(raw: string): string {
  if (!raw || raw.length < 8) return ''
  const cleaned = raw.replace(/[^0-9]/g, '')
  if (cleaned.length < 8) return ''

  const mm1 = parseInt(cleaned.substring(0, 2), 10)
  const dd1 = parseInt(cleaned.substring(2, 4), 10)
  const yyyy1 = parseInt(cleaned.substring(4, 8), 10)
  if (mm1 >= 1 && mm1 <= 12 && dd1 >= 1 && dd1 <= 31 && yyyy1 >= 1900 && yyyy1 <= 2100) {
    return `${yyyy1}-${String(mm1).padStart(2, '0')}-${String(dd1).padStart(2, '0')}`
  }

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
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age >= 18
}

function parseEyeColor(raw: string): string {
  const map: Record<string, string> = {
    'BLK': 'Black', 'BLU': 'Blue', 'BRO': 'Brown',
    'GRY': 'Gray', 'GRN': 'Green', 'HAZ': 'Hazel',
    'MAR': 'Maroon', 'PNK': 'Pink', 'DIC': 'Dichromatic', 'UNK': 'Unknown',
  }
  return map[raw.trim().toUpperCase()] || raw.trim()
}

function parseHeight(raw: string): string {
  const c = raw.trim()
  if (/^\d{3}$/.test(c)) return `${c[0]}'${parseInt(c.substring(1), 10)}"`
  return c
}

/**
 * Make a character safe to display — show non-printable as [HEX]
 */
function safeChar(ch: string): string {
  const code = ch.charCodeAt(0)
  if (code >= 32 && code <= 126) return ch
  return `[${code.toString(16).toUpperCase().padStart(2, '0')}]`
}

/**
 * Generate diagnostics about the raw barcode string
 * without exposing personal data.
 */
export function diagnoseBarcode(raw: string): ParseDiagnostics {
  const headerCharCodes = Array.from(raw.substring(0, 20)).map(c => c.charCodeAt(0))

  const delimitersFound: string[] = []
  if (raw.includes('\n')) delimitersFound.push('\\n')
  if (raw.includes('\r')) delimitersFound.push('\\r')
  if (raw.includes('\x1e')) delimitersFound.push('RS(1E)')
  if (raw.includes('\x1f')) delimitersFound.push('US(1F)')
  if (raw.includes('\x0a')) delimitersFound.push('LF(0A)')
  if (raw.includes('\x0d')) delimitersFound.push('CR(0D)')
  if (raw.includes('\x40')) delimitersFound.push('@')
  if (raw.includes('DL')) delimitersFound.push('has-DL')
  if (raw.includes('ANSI')) delimitersFound.push('has-ANSI')
  if (raw.includes('AAMVA')) delimitersFound.push('has-AAMVA')

  // Show first 40 chars with non-printable escaped
  const rawPrefix = Array.from(raw.substring(0, 40)).map(safeChar).join('')

  // Try splitting and see what we get
  const lines = raw.split(/[\n\r\x1e\x1f]+/).filter(Boolean)

  // Check all 3-char prefixes of lines
  const fieldCodesSeen = lines
    .map(l => l.substring(0, 3))
    .filter(c => /^[A-Z]{2}[A-Z0-9]$/.test(c))

  const knownCodes = ['DAA', 'DCS', 'DAC', 'DCT', 'DAD', 'DBB', 'DAG', 'DAI', 'DAJ', 'DAK', 'DAQ', 'DBA', 'DBC', 'DAY', 'DAU', 'DCG', 'DDE', 'DDF', 'DDG', 'DDK', 'DDL']
  const fieldCodesFound = fieldCodesSeen.filter(c => knownCodes.includes(c))

  return {
    totalLength: raw.length,
    headerCharCodes,
    delimitersFound,
    linesAfterSplit: lines.length,
    fieldCodesFound,
    fieldCodesSeen,
    hasANSIHeader: raw.includes('ANSI'),
    hasComplianceIndicator: raw.charCodeAt(0) === 0x40, // '@' is the compliance indicator
    rawPrefix,
  }
}

/**
 * Parse raw AAMVA PDF417 barcode data into structured fields.
 */
export function parseAAMVABarcode(raw: string): ParsedLicense {
  const result: ParsedLicense = {
    firstName: '', middleName: '', lastName: '', dateOfBirth: '',
    address: { street: '', city: '', state: '', zip: '' },
    licenseNumber: '', licenseState: '', expirationDate: '',
    sex: '', eyeColor: '', height: '', isOver18: false, rawFieldCount: 0,
  }

  if (!raw || raw.length < 10) return result

  // Try multiple splitting strategies
  let lines: string[] = []

  // Strategy 1: Standard delimiters
  lines = raw.split(/[\n\r\x1e\x1f]+/).filter(Boolean)

  // Strategy 2: If we only got 1 line, the data might use a different delimiter
  // Some encoders use DL as a subfile type marker — try splitting on known field codes
  if (lines.length <= 2) {
    // Try to find field codes directly in the raw string using regex
    const fieldPattern = /(DAA|DCS|DCT|DAC|DAD|DBB|DAG|DAI|DAJ|DAK|DAQ|DBA|DBC|DAY|DAU|DDE|DDF|DDG|DCG|DDK|DDL)([^\x00-\x1f]*?)(?=DAA|DCS|DCT|DAC|DAD|DBB|DAG|DAI|DAJ|DAK|DAQ|DBA|DBC|DAY|DAU|DDE|DDF|DDG|DCG|DDK|DDL|$)/g

    let match
    const directFields: Array<{ code: string; value: string }> = []
    while ((match = fieldPattern.exec(raw)) !== null) {
      directFields.push({ code: match[1], value: match[2] })
    }

    if (directFields.length > lines.length) {
      // Direct field extraction found more — use it instead
      lines = directFields.map(f => f.code + f.value)
    }
  }

  let fieldCount = 0

  const handlers: Record<string, (val: string) => void> = {
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

export function isValidParsedLicense(parsed: ParsedLicense): { valid: boolean; missing: string[] } {
  const missing: string[] = []
  if (!parsed.firstName && !parsed.lastName) missing.push('name')
  if (!parsed.dateOfBirth) missing.push('date of birth')
  if (!parsed.licenseNumber) missing.push('license number')
  if (!parsed.address.street && !parsed.address.city) missing.push('address')
  return { valid: missing.length === 0, missing }
}
