import { createHash } from 'crypto'
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

interface AuditEntry {
  timestamp: string
  actor: 'agent' | 'user' | 'system'
  action: string
  target: string
  result: 'success' | 'denied' | 'error'
  details?: Record<string, unknown>
  previousHash?: string
}

type AuditInput = Omit<AuditEntry, 'timestamp' | 'previousHash'>

interface IntegrityResult {
  valid: boolean
  brokenAt?: number
}

function computeHash(entryWithoutHash: Record<string, unknown>): string {
  const content = JSON.stringify(entryWithoutHash)
  return createHash('sha256').update(content).digest('hex')
}

class AuditLogService {
  private logPath: string
  private lastHash: string = ''

  constructor(logDir: string) {
    this.logPath = join(logDir, 'audit.jsonl')
  }

  log(input: AuditInput): void {
    // Ensure the directory exists before writing
    const dir = this.logPath.substring(0, this.logPath.lastIndexOf('/'))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const entryData: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      target: input.target,
      result: input.result,
      previousHash: this.lastHash
    }

    if (input.details !== undefined) {
      entryData.details = input.details
    }

    const hash = computeHash(entryData)
    const fullEntry = { ...entryData, hash }

    appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8')
    this.lastHash = hash
  }

  getLogPath(): string {
    return this.logPath
  }

  verifyIntegrity(): IntegrityResult {
    if (!existsSync(this.logPath)) {
      return { valid: true }
    }

    const content = readFileSync(this.logPath, 'utf-8').trim()
    if (content.length === 0) {
      return { valid: true }
    }

    const lines = content.split('\n')
    let expectedPreviousHash = ''

    for (let i = 0; i < lines.length; i++) {
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(lines[i])
      } catch {
        return { valid: false, brokenAt: i }
      }

      // Verify the chain link: this entry's previousHash must match the last entry's hash
      if (entry.previousHash !== expectedPreviousHash) {
        return { valid: false, brokenAt: i }
      }

      // Recompute the hash from the entry data (everything except the hash field)
      const storedHash = entry.hash as string
      const { hash: _, ...entryWithoutHash } = entry
      const recomputedHash = computeHash(entryWithoutHash)

      if (recomputedHash !== storedHash) {
        return { valid: false, brokenAt: i }
      }

      expectedPreviousHash = storedHash
    }

    return { valid: true }
  }
}

export function createAuditLogService(logDir: string): AuditLogService {
  return new AuditLogService(logDir)
}

// Module-level singleton for use across IPC handlers
export let auditLogService: AuditLogService

export function initAuditLog(logDir: string): void {
  auditLogService = createAuditLogService(logDir)
}
