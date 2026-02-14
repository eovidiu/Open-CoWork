export const CREDENTIAL_PLACEHOLDER = '[CREDENTIAL REDACTED]'

interface CredentialPattern {
  name: string
  regex: RegExp
}

// Each pattern uses non-greedy quantifiers and bounded repetitions to
// avoid catastrophic backtracking. Order matters: more specific patterns
// (JWT, GitHub tokens) should come before generic ones (generic-secret)
// so the match names reflect the most precise classification.
const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  {
    name: 'aws-key',
    regex: /AKIA[0-9A-Z]{16}/g
  },
  {
    name: 'private-key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    name: 'jwt',
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g
  },
  {
    name: 'github-token',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g
  },
  {
    name: 'slack-token',
    regex: /xox[bpors]-[0-9a-zA-Z-]+/g
  },
  {
    name: 'stripe-key',
    regex: /(?:sk|pk)_(?:test|live)_[a-zA-Z0-9]{20,}/g
  },
  {
    name: 'connection-string',
    regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/g
  },
  {
    name: 'bearer-token',
    regex: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/g
  },
  {
    name: 'api-key',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)['":\s=]+['"]?[a-zA-Z0-9_-]{20,}/gi
  },
  {
    name: 'generic-secret',
    regex: /(?:secret|password|passwd|token)['":\s=]+['"]?[^\s'"]{8,}/gi
  }
]

export function scanForCredentials(text: string): {
  hasCredentials: boolean
  redacted: string
  matches: string[]
} {
  if (!text) {
    return { hasCredentials: false, redacted: text, matches: [] }
  }

  const matchedNames = new Set<string>()
  let redacted = text

  for (const pattern of CREDENTIAL_PATTERNS) {
    // Reset lastIndex since we reuse the regex object
    pattern.regex.lastIndex = 0

    if (pattern.regex.test(redacted)) {
      matchedNames.add(pattern.name)
      pattern.regex.lastIndex = 0
      redacted = redacted.replace(pattern.regex, CREDENTIAL_PLACEHOLDER)
    }
  }

  return {
    hasCredentials: matchedNames.size > 0,
    redacted,
    matches: Array.from(matchedNames)
  }
}

export function redactCredentials(text: string): string {
  return scanForCredentials(text).redacted
}
