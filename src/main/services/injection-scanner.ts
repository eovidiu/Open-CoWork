export interface InjectionScanResult {
  hasInjection: boolean
  patterns: string[]
  sanitized: string
}

// Each pattern category has a name and a test function that receives
// the NFKC-normalized content and returns all matched substrings.
interface PatternCategory {
  name: string
  detect: (content: string) => string[]
}

// Role override: lines starting with "system:", "assistant:", "user:" followed by
// instruction-like content (at least a few words). Must be at the start of a line
// and NOT inside a code block or JSON structure.
function detectRoleOverride(content: string): string[] {
  const matches: string[] = []
  // Match line-start (or string-start) role prefixes followed by substantive text.
  // Require at least 10 chars after the colon to avoid matching things like
  // "system: true" in YAML or "user: john" in config files.
  const pattern = /^[ \t]*(system|assistant|user)\s*:\s+(.{10,})/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const afterColon = match[2].trim().toLowerCase()
    // Skip common legitimate patterns: JSON-like values, simple assignments
    if (
      /^["'{[\d]/.test(afterColon) || // JSON value
      /^(true|false|null|none|undefined)\b/.test(afterColon) || // Boolean/null
      /^https?:\/\//.test(afterColon) // URL
    ) {
      continue
    }
    matches.push(match[0].trim())
  }
  return matches
}

// System prompt override: phrases that attempt to override or ignore prior instructions
function detectPromptOverride(content: string): string[] {
  const matches: string[] = []
  const phrases = [
    /ignore\s+(?:all\s+)?previous\s+instructions/gi,
    /ignore\s+all\s+prior\b/gi,
    /ignore\s+(?:the\s+)?above\s+instructions/gi,
    /disregard\s+(?:all\s+)?(?:the\s+)?above/gi,
    /disregard\s+(?:all\s+)?previous/gi,
    /disregard\s+(?:all\s+)?prior/gi,
    /override\s+system\s+prompt/gi,
    /new\s+instructions\s*:/gi,
    /you\s+are\s+now\s+(?:a\s+|in\s+)?(?:different|new|my|evil|unrestricted|jailbr)/gi,
    /forget\s+(?:all\s+)?(?:your\s+)?(?:previous|prior|above)\s+(?:instructions|rules|guidelines)/gi,
    /do\s+not\s+follow\s+(?:any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules)/gi,
    /entering\s+(?:a\s+)?(?:new\s+)?(?:special|debug|developer|admin)\s+mode/gi,
    /activate\s+(?:developer|debug|admin|root|sudo|unrestricted)\s+mode/gi,
  ]
  for (const phrase of phrases) {
    let match: RegExpExecArray | null
    // Reset lastIndex for global regexes
    phrase.lastIndex = 0
    while ((match = phrase.exec(content)) !== null) {
      matches.push(match[0])
    }
  }
  return matches
}

// Tool call injection: strings that look like JSON tool_calls or function_call objects,
// or XML-style tool_call tags
function detectToolCallInjection(content: string): string[] {
  const matches: string[] = []
  const patterns = [
    /\{\s*"tool_calls"\s*:/gi,
    /\{\s*"function_call"\s*:/gi,
    /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/gi,
    /<tool_call>/gi,
    /<\/tool_call>/gi,
    /<function_call>/gi,
    /<\/function_call>/gi,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(content)) !== null) {
      matches.push(match[0])
    }
  }
  return matches
}

// Delimiter injection: strings that try to break out of context with fake boundaries
function detectDelimiterInjection(content: string): string[] {
  const matches: string[] = []
  const patterns = [
    /#{3,}\s*END\s*(?:SYSTEM|INSTRUCTIONS|PROMPT|CONTEXT)\s*#{3,}/gi,
    /-{3,}\s*END\s*(?:SYSTEM|INSTRUCTIONS|PROMPT|CONTEXT)\s*-{3,}/gi,
    /`{3}\s*system\b/gi,
    /={3,}\s*END\s*(?:SYSTEM|INSTRUCTIONS|PROMPT|CONTEXT)\s*={3,}/gi,
    /<\/?(?:system_prompt|system_instructions|instructions|system_message)>/gi,
    /\[(?:SYSTEM|INST|SYS)\]/gi,
    /<<\s*(?:SYS|SYSTEM|INST)\s*>>/gi,
    /<\|(?:im_start|im_end|system|endoftext)\|>/gi,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(content)) !== null) {
      matches.push(match[0])
    }
  }
  return matches
}

// All pattern categories for the primary scan
const PATTERN_CATEGORIES: PatternCategory[] = [
  { name: 'role_override', detect: detectRoleOverride },
  { name: 'prompt_override', detect: detectPromptOverride },
  { name: 'tool_call_injection', detect: detectToolCallInjection },
  { name: 'delimiter_injection', detect: detectDelimiterInjection },
]

// Detect base64-encoded blocks, decode them, and re-scan the decoded content
function detectBase64Injection(content: string): string[] {
  const matches: string[] = []
  // Match base64 blocks: at least 20 chars of valid base64, possibly with whitespace
  const base64Pattern = /(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g
  let b64Match: RegExpExecArray | null
  while ((b64Match = base64Pattern.exec(content)) !== null) {
    const candidate = b64Match[0]
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf-8')
      // Only consider it if the decoded content is mostly printable ASCII
      const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length
      if (printableRatio < 0.8) continue

      // Re-scan decoded content with primary patterns (no recursion into base64 again)
      for (const category of PATTERN_CATEGORIES) {
        const innerMatches = category.detect(decoded)
        for (const inner of innerMatches) {
          matches.push(`base64(${inner})`)
        }
      }
    } catch {
      // Not valid base64, skip
    }
  }
  return matches
}

// Normalize unicode using NFKC to catch homoglyph attacks.
// For example, fullwidth "ｓｙｓｔｅｍ" normalizes to "system".
function normalizeUnicode(content: string): string {
  return content.normalize('NFKC')
}

// Check if content has non-ASCII characters that normalize differently under NFKC,
// which may indicate homoglyph usage
function detectHomoglyphAttempt(original: string, normalized: string): boolean {
  return original !== normalized
}

// Wrap each detected injection pattern in a visible marker
function sanitize(content: string, detectedStrings: string[]): string {
  let result = content
  for (const detected of detectedStrings) {
    // For base64-wrapped detections, the actual string in content is the base64 block,
    // not the decoded content. We skip direct replacement for those since the base64
    // block itself is opaque. Instead, we prepend a warning.
    if (detected.startsWith('base64(')) {
      continue
    }
    // Escape special regex chars in the detected string
    const escaped = detected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(escaped, 'gi')
    result = result.replace(pattern, (match) => `[INJECTION PATTERN DETECTED: ${match}]`)
  }

  // If there were base64 injection detections, prepend a warning
  const base64Detections = detectedStrings.filter((d) => d.startsWith('base64('))
  if (base64Detections.length > 0) {
    const warnings = base64Detections
      .map((d) => `[INJECTION PATTERN DETECTED IN BASE64: ${d}]`)
      .join('\n')
    result = `${warnings}\n${result}`
  }

  return result
}

export function scanForInjection(content: string, filename?: string): InjectionScanResult {
  if (!content || content.length === 0) {
    return { hasInjection: false, patterns: [], sanitized: content }
  }

  // Skip scanning for known binary/data file extensions where injection patterns
  // would be false positives
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase()
    const skipExtensions = [
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
      'pdf', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
      'woff', 'woff2', 'ttf', 'otf', 'eot',
      'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
      'exe', 'dll', 'so', 'dylib', 'o', 'a',
      'db', 'sqlite', 'sqlite3',
    ]
    if (ext && skipExtensions.includes(ext)) {
      return { hasInjection: false, patterns: [], sanitized: content }
    }
  }

  // Normalize unicode (NFKC) to catch homoglyph attacks
  const normalized = normalizeUnicode(content)
  const hadHomoglyphs = detectHomoglyphAttempt(content, normalized)

  const detectedPatterns: string[] = []
  const detectedStrings: string[] = []

  // Run all pattern categories against the normalized content
  for (const category of PATTERN_CATEGORIES) {
    const matches = category.detect(normalized)
    if (matches.length > 0) {
      detectedPatterns.push(category.name)
      detectedStrings.push(...matches)
    }
  }

  // Check for base64-encoded injections
  const base64Matches = detectBase64Injection(normalized)
  if (base64Matches.length > 0) {
    detectedPatterns.push('base64_injection')
    detectedStrings.push(...base64Matches)
  }

  // If homoglyphs were detected and any injection was found, note it
  if (hadHomoglyphs && detectedPatterns.length > 0) {
    detectedPatterns.push('unicode_homoglyph')
  }

  if (detectedPatterns.length === 0) {
    return { hasInjection: false, patterns: [], sanitized: content }
  }

  // Sanitize the normalized content (use normalized so homoglyphs are resolved)
  const sanitized = sanitize(normalized, detectedStrings)

  return {
    hasInjection: true,
    patterns: [...new Set(detectedPatterns)],
    sanitized,
  }
}
