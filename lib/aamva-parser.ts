/**
 * AAMVA PDF417 Barcode Parser.
 *
 * Supports AAMVA DL/ID Card Design Standard versions 01 through 10.
 * Parses entirely client-side — callers are expected to discard the raw
 * barcode string after parsing and never log its contents.
 */

export interface ParsedLicense {
  firstName: string | null
  middleName: string | null
  lastName: string | null
  dateOfBirth: string | null     // ISO YYYY-MM-DD
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  licenseNumber: string | null
  licenseState: string | null
  expirationDate: string | null  // ISO YYYY-MM-DD
  issueDate: string | null       // ISO YYYY-MM-DD
  sex: 'M' | 'F' | 'X' | null
  eyeColor: string | null
  heightInches: number | null
  country: string | null
  aamvaVersion: number | null
  isExpired: boolean
  isUnder18: boolean
}

export interface ParseDiagnostics {
  totalLength: number
  headerCharCodes: number[]
  delimitersFound: string[]
  linesAfterSplit: number
  fieldCodesFound: string[]
  fieldCodesSeen: string[]
  hasANSIHeader: boolean
  hasComplianceIndicator: boolean
  aamvaVersion: number | null
  rawPrefix: string
}

/* ───────────────────── Field parsers ───────────────────── */

function parseAAMVADate(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9]/g, '')
  if (cleaned.length < 8) return null

  // MMDDYYYY (standard AAMVA US)
  const mm1 = parseInt(cleaned.substring(0, 2), 10)
  const dd1 = parseInt(cleaned.substring(2, 4), 10)
  const yyyy1 = parseInt(cleaned.substring(4, 8), 10)
  if (mm1 >= 1 && mm1 <= 12 && dd1 >= 1 && dd1 <= 31 && yyyy1 >= 1900 && yyyy1 <= 2100) {
    return `${yyyy1}-${String(mm1).padStart(2, '0')}-${String(dd1).padStart(2, '0')}`
  }

  // YYYYMMDD (Canadian / some older encoders)
  const yyyy2 = parseInt(cleaned.substring(0, 4), 10)
  const mm2 = parseInt(cleaned.substring(4, 6), 10)
  const dd2 = parseInt(cleaned.substring(6, 8), 10)
  if (yyyy2 >= 1900 && yyyy2 <= 2100 && mm2 >= 1 && mm2 <= 12 && dd2 >= 1 && dd2 <= 31) {
    return `${yyyy2}-${String(mm2).padStart(2, '0')}-${String(dd2).padStart(2, '0')}`
  }
  return null
}

function parseSex(raw: string): 'M' | 'F' | 'X' | null {
  const code = raw.trim().toUpperCase()
  if (code === '1' || code === 'M') return 'M'
  if (code === '2' || code === 'F') return 'F'
  if (code === '9' || code === 'X') return 'X'
  return null
}

function parseEyeColor(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  if (!code) return null
  const map: Record<string, string> = {
    BLK: 'Black',  BLU: 'Blue',  BRO: 'Brown',
    GRY: 'Gray',   GRN: 'Green', HAZ: 'Hazel',
    MAR: 'Maroon', PNK: 'Pink',  DIC: 'Dichromatic',
    UNK: 'Unknown',
  }
  return map[code] || code
}

/**
 * Parse DAU (height) into inches.
 *   "072 IN"      → 72   — explicit inches
 *   "180 CM"      → 71   — centimeters, converted
 *   "072"         → 72   — inches (less-than-88 → interpret as inches)
 *   "510"         → 70   — feet+inches packed: 5'10" = 70in
 *   "5'10\""      → 70   — feet/inches with punctuation
 */
function parseHeight(raw: string): number | null {
  if (!raw) return null
  const trimmed = raw.trim().toUpperCase()
  if (!trimmed) return null

  const cmMatch = trimmed.match(/(\d{2,3})\s*CM/)
  if (cmMatch) {
    const cm = parseInt(cmMatch[1], 10)
    if (cm >= 90 && cm <= 250) return Math.round(cm / 2.54)
  }

  const inMatch = trimmed.match(/(\d{2,3})\s*IN/)
  if (inMatch) {
    const inches = parseInt(inMatch[1], 10)
    if (inches >= 30 && inches <= 96) return inches
  }

  const ftIn = trimmed.match(/^(\d+)'\s*(\d+)"?$/)
  if (ftIn) {
    const ft = parseInt(ftIn[1], 10)
    const inch = parseInt(ftIn[2], 10)
    if (ft >= 3 && ft <= 8 && inch >= 0 && inch < 12) return ft * 12 + inch
  }

  const digits = trimmed.match(/^(\d{3})$/)
  if (digits) {
    const n = parseInt(digits[1], 10)
    // AAMVA packed feet+inches — e.g. 510 → 5ft 10in. Only makes sense if
    // the last two digits are < 12.
    const ft = Math.floor(n / 100)
    const inch = n % 100
    if (ft >= 3 && ft <= 8 && inch >= 0 && inch < 12) return ft * 12 + inch
    // Otherwise treat as straight inches.
    if (n >= 30 && n <= 96) return n
  }

  return null
}

function isDateInPast(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function isUnder18(dobISO: string | null): boolean {
  if (!dobISO) return false
  const dob = new Date(dobISO + 'T00:00:00')
  if (isNaN(dob.getTime())) return false
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age < 18
}

/**
 * Extract the AAMVA version number from the compliance header.
 * Returns null if the header is missing or unrecognized.
 *
 * Header structure (AAMVA DL/ID standard):
 *   byte  0: '@' compliance indicator
 *   bytes 1-3: data-element separator + record separator + segment terminator
 *   bytes 4-8: "ANSI "
 *   bytes 9-14: 6-digit IIN
 *   bytes 15-16: 2-digit AAMVA version number
 *
 * We anchor on "ANSI " rather than a fixed offset since some readers strip
 * or rewrite the leading control bytes.
 */
function extractAamvaVersion(raw: string): number | null {
  const ansiIdx = raw.indexOf('ANSI ')
  if (ansiIdx < 0) return null
  const versionStart = ansiIdx + 5 + 6 // skip "ANSI " + 6-digit IIN
  const versionStr = raw.substring(versionStart, versionStart + 2)
  const version = parseInt(versionStr, 10)
  if (isNaN(version) || version < 1 || version > 20) return null
  return version
}

/* ───────────────────── Diagnostics ───────────────────── */

function safeChar(ch: string): string {
  const code = ch.charCodeAt(0)
  if (code >= 32 && code <= 126) return ch
  return `[${code.toString(16).toUpperCase().padStart(2, '0')}]`
}

export function diagnoseBarcode(raw: string): ParseDiagnostics {
  const headerCharCodes = Array.from(raw.substring(0, 20)).map(c => c.charCodeAt(0))
  const delimitersFound: string[] = []
  if (raw.includes('\n'))  delimitersFound.push('\\n')
  if (raw.includes('\r'))  delimitersFound.push('\\r')
  if (raw.includes('\x1e')) delimitersFound.push('RS(1E)')
  if (raw.includes('\x1f')) delimitersFound.push('US(1F)')

  const rawPrefix = Array.from(raw.substring(0, 40)).map(safeChar).join('')
  const lines = raw.split(/[\n\r\x1e\x1f]+/).filter(Boolean)
  const fieldCodesSeen = lines
    .map(l => l.substring(0, 3))
    .filter(c => /^[A-Z]{2}[A-Z0-9]$/.test(c))

  const knownCodes = [
    'DAA','DCS','DAC','DCT','DAD','DBB',
    'DAG','DAI','DAJ','DAK','DAQ',
    'DBA','DBC','DAY','DAU','DBD','DCG',
  ]
  const fieldCodesFound = fieldCodesSeen.filter(c => knownCodes.includes(c))

  return {
    totalLength: raw.length,
    headerCharCodes,
    delimitersFound,
    linesAfterSplit: lines.length,
    fieldCodesFound,
    fieldCodesSeen,
    hasANSIHeader: raw.includes('ANSI'),
    hasComplianceIndicator: raw.charCodeAt(0) === 0x40,
    aamvaVersion: extractAamvaVersion(raw),
    rawPrefix,
  }
}

/* ───────────────────── Main parse ───────────────────── */

export function parseAAMVABarcode(raw: string): ParsedLicense {
  const result: ParsedLicense = {
    firstName: null, middleName: null, lastName: null,
    dateOfBirth: null,
    street: null, city: null, state: null, zip: null,
    licenseNumber: null, licenseState: null,
    expirationDate: null, issueDate: null,
    sex: null, eyeColor: null, heightInches: null,
    country: null, aamvaVersion: null,
    isExpired: false, isUnder18: false,
  }

  if (!raw || raw.length < 10) return result

  result.aamvaVersion = extractAamvaVersion(raw)

  // Split on any control-character delimiter AAMVA uses. Different states
  // use different separators; LF / CR / RS / US are all spec-permissible.
  let lines = raw.split(/[\n\r\x1e\x1f]+/).filter(Boolean)

  // Some encoders concatenate everything into a single blob with field codes
  // embedded inline. If splitting by delimiters produced too few entries,
  // fall back to direct regex extraction on field codes.
  if (lines.length <= 2) {
    const codeList = 'DAA|DCS|DCT|DAC|DAD|DBB|DAG|DAI|DAJ|DAK|DAQ|DBA|DBC|DAY|DAU|DBD|DCG'
    const pattern = new RegExp(`(${codeList})([^\\x00-\\x1f]*?)(?=${codeList}|$)`, 'g')
    const directFields: string[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.exec(raw)) !== null) {
      directFields.push(m[1] + m[2])
    }
    if (directFields.length > lines.length) lines = directFields
  }

  // Apply a handler for each 3-char field code at the start of a line.
  const handlers: Record<string, (v: string) => void> = {
    DAA: (v) => {
      const parts = v.split(',').map(s => s.trim())
      if (parts[0]) result.lastName = parts[0] || null
      if (parts[1]) result.firstName = parts[1] || null
      if (parts[2]) result.middleName = parts[2] || null
    },
    DCS: (v) => { result.lastName = v.trim() || null },
    DAC: (v) => { result.firstName = v.trim() || null },
    DCT: (v) => {
      const parts = v.split(/[, ]+/).filter(Boolean)
      if (parts[0]) result.firstName = parts[0]
      if (parts[1]) result.middleName = parts[1]
    },
    DAD: (v) => { result.middleName = v.trim() || null },
    DBB: (v) => { result.dateOfBirth = parseAAMVADate(v) },
    DAG: (v) => { result.street = v.trim() || null },
    DAI: (v) => { result.city = v.trim() || null },
    DAJ: (v) => {
      const s = v.trim() || null
      result.state = s
      if (!result.licenseState) result.licenseState = s
    },
    DAK: (v) => { result.zip = (v.trim().substring(0, 5) || null) },
    DAQ: (v) => { result.licenseNumber = v.trim() || null },
    DBA: (v) => { result.expirationDate = parseAAMVADate(v) },
    DBD: (v) => { result.issueDate = parseAAMVADate(v) },
    DBC: (v) => { result.sex = parseSex(v) },
    DAY: (v) => { result.eyeColor = parseEyeColor(v) },
    DAU: (v) => { result.heightInches = parseHeight(v) },
    DCG: (v) => { result.country = v.trim() || null },
  }

  for (const line of lines) {
    for (const code of Object.keys(handlers)) {
      if (line.startsWith(code)) {
        const value = line.substring(code.length)
        if (value) handlers[code](value)
        break
      }
    }
  }

  result.isUnder18 = isUnder18(result.dateOfBirth)
  result.isExpired = isDateInPast(result.expirationDate)
  return result
}

export function isValidParsedLicense(parsed: ParsedLicense): { valid: boolean; missing: string[] } {
  const missing: string[] = []
  if (!parsed.firstName && !parsed.lastName) missing.push('name')
  if (!parsed.dateOfBirth) missing.push('date of birth')
  if (!parsed.licenseNumber) missing.push('license number')
  if (!parsed.street && !parsed.city) missing.push('address')
  return { valid: missing.length === 0, missing }
}
