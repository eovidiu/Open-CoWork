import { ipcMain } from 'electron'
import { createHash } from 'crypto'

// Generate SHA-256 hash of skill content for integrity verification
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// Sanitize skill content to reduce prompt injection risk
function sanitizeSkillContent(content: string): string {
  // Remove potential system prompt overrides
  let sanitized = content
  // Strip common injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /you\s+are\s+now\s+in\s+unrestricted\s+mode/gi,
    /disregard\s+(all\s+)?prior\s+(instructions|rules)/gi,
    /override\s+system\s+prompt/gi,
    /\[SYSTEM\]/gi,
  ]
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[FILTERED]')
  }
  // Limit skill content size (max 50KB)
  if (sanitized.length > 50000) {
    sanitized = sanitized.substring(0, 50000) + '\n[Content truncated]'
  }
  return sanitized
}

// Validate skill ID to prevent path traversal
function isValidSkillId(skillId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(skillId)
}

// Safe fetch that disables redirects
async function safeFetch(url: string): Promise<Response> {
  const response = await fetch(url, { redirect: 'manual' })
  // Block redirects (SSRF protection)
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Redirects from skill registry are not allowed')
  }
  return response
}

interface RegistrySkill {
  id: string
  name: string
  description: string
  tags?: string[]
  downloadCount?: number
}

export function registerSkillRegistryHandlers(): void {
  // Search skills on skillregistry.io
  ipcMain.handle(
    'skillregistry:search',
    async (_, query: string): Promise<RegistrySkill[]> => {
      try {
        const url = query.trim()
          ? `https://skillregistry.io/api/skills?search=${encodeURIComponent(query)}`
          : 'https://skillregistry.io/api/skills/featured'

        const response = await safeFetch(url)
        if (!response.ok) {
          console.error('[SkillRegistry] Search failed:', response.status)
          return []
        }
        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          console.error('[SkillRegistry] Invalid content-type:', contentType)
          return []
        }

        const data = await response.json()
        return Array.isArray(data) ? data : data.skills || []
      } catch (error) {
        console.error('[SkillRegistry] Search error:', error)
        return []
      }
    }
  )

  // Fetch skill content
  ipcMain.handle(
    'skillregistry:getContent',
    async (_, skillId: string): Promise<{ content: string; hash: string } | null> => {
      try {
        if (!isValidSkillId(skillId)) {
          console.error('[SkillRegistry] Invalid skill ID:', skillId)
          return null
        }

        const response = await safeFetch(`https://skillregistry.io/skills/${skillId}`)
        if (!response.ok) {
          console.error('[SkillRegistry] Content fetch failed:', response.status)
          return null
        }

        const rawContent = await response.text()

        // Enforce size limit
        if (rawContent.length > 100000) {
          console.error('[SkillRegistry] Skill content exceeds 100KB limit')
          return null
        }

        const sanitized = sanitizeSkillContent(rawContent)
        const hash = hashContent(sanitized)

        return { content: sanitized, hash }
      } catch (error) {
        console.error('[SkillRegistry] Content fetch error:', error)
        return null
      }
    }
  )

  // Verify skill content integrity
  ipcMain.handle('skillregistry:verifyHash', async (_, content: string, expectedHash: string): Promise<boolean> => {
    return hashContent(content) === expectedHash
  })
}
