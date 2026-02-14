export interface PiiMatch {
  type: string // e.g., 'email', 'phone', 'ssn', 'credit-card', 'address'
  value: string // the matched text (for display in warning)
  index: number // position in text
}

interface PiiPattern {
  type: string
  regex: RegExp
  validate?: (match: string) => boolean
}

/**
 * Luhn algorithm to validate credit card numbers.
 * Returns true if the digit sequence passes the Luhn check.
 */
function luhnCheck(digits: string): boolean {
  let sum = 0
  let alternate = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alternate) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alternate = !alternate
  }
  return sum % 10 === 0
}

// Each pattern uses non-greedy quantifiers and bounded repetitions to
// avoid catastrophic backtracking. More specific patterns (SSN, credit card)
// come before more general ones (address) for precise classification.
const PII_PATTERNS: PiiPattern[] = [
  {
    type: 'ssn',
    // SSN: xxx-xx-xxxx where first group is not 000, 666, or 9xx
    regex: /\b(?!000|666|9\d\d)([0-8]\d{2})-(?!00)(\d{2})-(?!0000)(\d{4})\b/g
  },
  {
    type: 'credit-card',
    // Card numbers: 13-19 digits starting with 3, 4, 5, or 6, with optional spaces/dashes
    // Only matches digit groups that look like card formatting (not hex or mixed content)
    regex: /\b([3-6]\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g,
    validate: (match: string) => {
      const digits = match.replace(/[\s-]/g, '')
      // Must be 13-19 digits
      if (digits.length < 13 || digits.length > 19) return false
      // Must be all digits (reject hex or mixed alphanumeric)
      if (!/^\d+$/.test(digits)) return false
      // Must pass Luhn check
      return luhnCheck(digits)
    }
  },
  {
    type: 'email',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
  },
  {
    type: 'phone',
    // US phone formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
    // International: +CC followed by 7-14 digits with optional spaces/dashes
    // Negative lookbehind for digits/dots to avoid matching IP addresses and version numbers
    regex: /(?<!\d)(?<!\d\.)(?:\+1[\s.-]?)(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})|(?<!\d)(?<!\d\.)(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4})\b|(?<!\d)\+(?:[2-9]\d{0,2})[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g,
    validate: (match: string) => {
      // Reject if it looks like an IP address (4 dot-separated groups)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(match)) return false
      // Reject version-number-like patterns (e.g., 3.14.159)
      const parts = match.split('.')
      if (parts.length >= 3 && parts.every((p) => /^\d{1,3}$/.test(p))) return false
      return true
    }
  },
  {
    type: 'address',
    // Street address: number + one or more words + common street suffix
    // Word boundary ensures we don't match in the middle of other content
    regex: /\b\d{1,6}\s+(?:[A-Z][a-zA-Z]+\s+){0,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy)\b/g
  }
]

/**
 * Scan text for PII patterns.
 * Returns an array of PII matches found in the text.
 */
export function scanForPii(text: string): PiiMatch[] {
  if (!text) return []

  const matches: PiiMatch[] = []

  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex since we reuse the regex object
    pattern.regex.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0]

      // Run optional validator to reduce false positives
      if (pattern.validate && !pattern.validate(value)) {
        continue
      }

      matches.push({
        type: pattern.type,
        value,
        index: match.index
      })
    }
  }

  // Sort by index for consistent ordering
  matches.sort((a, b) => a.index - b.index)

  return matches
}

/**
 * Check whether text contains any PII.
 */
export function hasPii(text: string): boolean {
  return scanForPii(text).length > 0
}

/**
 * Redact PII in text by replacing matches with [TYPE REDACTED] placeholders.
 * Processes replacements from end to start to preserve index positions.
 */
export function redactPii(text: string): string {
  if (!text) return text

  const matches = scanForPii(text)
  if (matches.length === 0) return text

  // Sort by index descending so replacements don't shift positions
  const sorted = [...matches].sort((a, b) => b.index - a.index)

  let result = text
  for (const match of sorted) {
    const placeholder = `[${match.type.toUpperCase()} REDACTED]`
    result = result.slice(0, match.index) + placeholder + result.slice(match.index + match.value.length)
  }

  return result
}
