import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAuditLogService } from '../../src/main/services/audit-log.service'

describe('AuditLogService', () => {
  let tempDir: string
  let cleanup: () => void

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'audit-log-test-'))
    cleanup = () => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  })

  afterEach(() => {
    cleanup()
  })

  describe('log', () => {
    it('should create a JSONL file when logging an entry', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls -la',
        result: 'success'
      })

      const logPath = service.getLogPath()
      expect(existsSync(logPath)).toBe(true)

      const content = readFileSync(logPath, 'utf-8').trim()
      const lines = content.split('\n')
      expect(lines).toHaveLength(1)

      const entry = JSON.parse(lines[0])
      expect(entry.actor).toBe('agent')
      expect(entry.action).toBe('tool:bash')
      expect(entry.target).toBe('ls -la')
      expect(entry.result).toBe('success')
    })

    it('should include an ISO 8601 timestamp', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'user',
        action: 'permission:grant',
        target: '/home/user/project',
        result: 'success'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry.timestamp).toBeDefined()
      // Verify it parses as a valid date
      const parsed = new Date(entry.timestamp)
      expect(parsed.toISOString()).toBe(entry.timestamp)
    })

    it('should include optional details when provided', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'system',
        action: 'file:write',
        target: '/tmp/test.txt',
        result: 'success',
        details: { size: 1024, encoding: 'utf-8' }
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry.details).toEqual({ size: 1024, encoding: 'utf-8' })
    })

    it('should not include details field when not provided', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'echo hello',
        result: 'success'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry.details).toBeUndefined()
    })

    it('should contain all required fields', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'git status',
        result: 'error'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry).toHaveProperty('timestamp')
      expect(entry).toHaveProperty('actor')
      expect(entry).toHaveProperty('action')
      expect(entry).toHaveProperty('target')
      expect(entry).toHaveProperty('result')
      expect(entry).toHaveProperty('hash')
      expect(entry).toHaveProperty('previousHash')
    })
  })

  describe('hash chain', () => {
    it('should set previousHash to empty string for the first entry', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls',
        result: 'success'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry.previousHash).toBe('')
    })

    it('should chain hashes across multiple entries', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls',
        result: 'success'
      })

      service.log({
        actor: 'agent',
        action: 'file:write',
        target: '/tmp/out.txt',
        result: 'success'
      })

      service.log({
        actor: 'user',
        action: 'permission:grant',
        target: '/home',
        result: 'success'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const lines = content.split('\n')
      expect(lines).toHaveLength(3)

      const entry1 = JSON.parse(lines[0])
      const entry2 = JSON.parse(lines[1])
      const entry3 = JSON.parse(lines[2])

      // First entry has empty previousHash
      expect(entry1.previousHash).toBe('')

      // Second entry's previousHash should be first entry's hash
      expect(entry2.previousHash).toBe(entry1.hash)

      // Third entry's previousHash should be second entry's hash
      expect(entry3.previousHash).toBe(entry2.hash)
    })

    it('should produce a 64-character hex hash (SHA-256)', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'echo test',
        result: 'success'
      })

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const entry = JSON.parse(content)

      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('verifyIntegrity', () => {
    it('should return valid for a clean log with one entry', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls',
        result: 'success'
      })

      const result = service.verifyIntegrity()
      expect(result.valid).toBe(true)
      expect(result.brokenAt).toBeUndefined()
    })

    it('should return valid for a clean log with multiple entries', () => {
      const service = createAuditLogService(tempDir)

      for (let i = 0; i < 10; i++) {
        service.log({
          actor: 'agent',
          action: `action:${i}`,
          target: `target-${i}`,
          result: 'success'
        })
      }

      const result = service.verifyIntegrity()
      expect(result.valid).toBe(true)
      expect(result.brokenAt).toBeUndefined()
    })

    it('should detect tampering when a line is modified', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls',
        result: 'success'
      })

      service.log({
        actor: 'agent',
        action: 'file:write',
        target: '/tmp/file.txt',
        result: 'success'
      })

      service.log({
        actor: 'user',
        action: 'permission:grant',
        target: '/home',
        result: 'success'
      })

      // Tamper with the second line
      const logPath = service.getLogPath()
      const content = readFileSync(logPath, 'utf-8')
      const lines = content.split('\n')
      const tampered = JSON.parse(lines[1])
      tampered.target = '/tmp/EVIL.txt'
      lines[1] = JSON.stringify(tampered)
      writeFileSync(logPath, lines.join('\n'))

      const result = service.verifyIntegrity()
      expect(result.valid).toBe(false)
      expect(result.brokenAt).toBe(1) // 0-indexed line number
    })

    it('should detect a broken chain link when previousHash is altered', () => {
      const service = createAuditLogService(tempDir)

      service.log({
        actor: 'agent',
        action: 'tool:bash',
        target: 'ls',
        result: 'success'
      })

      service.log({
        actor: 'agent',
        action: 'file:read',
        target: '/tmp/data.json',
        result: 'success'
      })

      // Tamper with the chain by altering previousHash on second entry
      const logPath = service.getLogPath()
      const content = readFileSync(logPath, 'utf-8')
      const lines = content.split('\n')
      const tampered = JSON.parse(lines[1])
      tampered.previousHash = 'aaaa' + tampered.previousHash.substring(4)
      // Recalculate hash to make it look consistent within the line (but chain is broken)
      lines[1] = JSON.stringify(tampered)
      writeFileSync(logPath, lines.join('\n'))

      const result = service.verifyIntegrity()
      expect(result.valid).toBe(false)
    })

    it('should return valid for an empty log file', () => {
      const service = createAuditLogService(tempDir)

      // Don't write anything - the file won't exist
      const result = service.verifyIntegrity()
      expect(result.valid).toBe(true)
    })
  })

  describe('log directory', () => {
    it('should create the log directory if it does not exist', () => {
      const nestedDir = join(tempDir, 'deeply', 'nested', 'audit')

      expect(existsSync(nestedDir)).toBe(false)

      const service = createAuditLogService(nestedDir)
      service.log({
        actor: 'system',
        action: 'startup',
        target: 'app',
        result: 'success'
      })

      expect(existsSync(nestedDir)).toBe(true)
      expect(existsSync(service.getLogPath())).toBe(true)
    })
  })

  describe('getLogPath', () => {
    it('should return a path inside the provided log directory', () => {
      const service = createAuditLogService(tempDir)
      const logPath = service.getLogPath()

      expect(logPath.startsWith(tempDir)).toBe(true)
      expect(logPath.endsWith('.jsonl')).toBe(true)
    })
  })

  describe('multiple entries maintain chain', () => {
    it('should maintain a valid chain across many entries', () => {
      const service = createAuditLogService(tempDir)

      const actors: Array<'agent' | 'user' | 'system'> = ['agent', 'user', 'system']
      const results: Array<'success' | 'denied' | 'error'> = ['success', 'denied', 'error']

      for (let i = 0; i < 50; i++) {
        service.log({
          actor: actors[i % 3],
          action: `action:${i}`,
          target: `target-${i}`,
          result: results[i % 3],
          ...(i % 2 === 0 ? { details: { index: i } } : {})
        })
      }

      const content = readFileSync(service.getLogPath(), 'utf-8').trim()
      const lines = content.split('\n')
      expect(lines).toHaveLength(50)

      // Verify chain manually
      let prevHash = ''
      for (let i = 0; i < lines.length; i++) {
        const entry = JSON.parse(lines[i])
        expect(entry.previousHash).toBe(prevHash)
        prevHash = entry.hash
      }

      // Also verify via the service method
      const result = service.verifyIntegrity()
      expect(result.valid).toBe(true)
    })
  })
})
