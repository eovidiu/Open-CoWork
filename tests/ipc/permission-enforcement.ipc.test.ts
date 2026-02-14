import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createPermissionService, type PermissionService } from '../../src/main/services/permission.service'
import { createTestDb } from '../helpers/test-db'
import type { PrismaClient } from '@prisma/client'

// Store registered handlers so we can call them directly
const registeredHandlers: Map<string, Function> = new Map()

// Permission service instance shared between handlers and tests
let sharedPermissionService: PermissionService

// Mock electron modules BEFORE importing the IPC modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler)
    })
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

// Mock createRateLimiter to disable rate limiting in tests
vi.mock('../../src/main/ipc/ipc-security', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/ipc/ipc-security')>(
    '../../src/main/ipc/ipc-security'
  )
  return {
    ...actual,
    createRateLimiter: () => ({
      check: () => true,
      getStats: () => ({ calls: 0, windowMs: 0, maxCalls: Infinity })
    })
  }
})

// Mock database module to provide the shared permission service
let testPrisma: PrismaClient
vi.mock('../../src/main/database', () => ({
  getDatabase: () => testPrisma,
  getPermissionService: () => sharedPermissionService
}))

// Mock IPC event with valid sender
const mockEvent = { sender: { id: 1 } }

// Helper to call an IPC handler
async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registeredHandlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`)
  }
  return handler(mockEvent, ...args) as Promise<T>
}

describe('Permission Enforcement in IPC Handlers', () => {
  let cleanup: () => Promise<void>
  let tempDir: string

  beforeAll(async () => {
    // Create test database and shared permission service
    const ctx = await createTestDb()
    testPrisma = ctx.prisma
    cleanup = ctx.cleanup
    sharedPermissionService = createPermissionService(testPrisma)

    // Create a temp directory for test files
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'perm-enforce-test-')))
    writeFileSync(join(tempDir, 'test-file.txt'), 'hello world')

    // Initialize sender validation
    const { setMainWindow } = await import('../../src/main/ipc/ipc-security')
    setMainWindow({ webContents: { id: 1 } } as any)

    // Import and register the handlers
    const { registerFileSystemHandlers } = await import('../../src/main/ipc/file-system.ipc')
    registerFileSystemHandlers()
  })

  afterAll(async () => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
    await cleanup()
  })

  beforeEach(() => {
    // Clear all session permissions between tests
    sharedPermissionService.clearSession()
  })

  // ─── fs:readFile permission enforcement ───────────────────────────────

  describe('fs:readFile permission enforcement', () => {
    it('should deny fs:readFile when no permission is granted', async () => {
      const filePath = join(tempDir, 'test-file.txt')
      await expect(callHandler('fs:readFile', filePath)).rejects.toThrow(
        /Permission denied: fs:readFile/
      )
    })

    it('should allow fs:readFile after granting session permission', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant permission for this specific path
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')

      const content = await callHandler<string>('fs:readFile', filePath)
      expect(content).toBe('hello world')
    })

    it('should allow fs:readFile after granting persistent permission', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant persistent permission
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'always')

      const content = await callHandler<string>('fs:readFile', filePath)
      expect(content).toBe('hello world')

      // Cleanup persistent permission
      await sharedPermissionService.revoke(filePath, 'fs:readFile')
    })

    it('should deny after revoking permission', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant then revoke
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')
      await sharedPermissionService.revoke(filePath, 'fs:readFile')

      await expect(callHandler('fs:readFile', filePath)).rejects.toThrow(
        /Permission denied: fs:readFile/
      )
    })

    it('should not grant cross-operation permission (readFile perm does not cover writeFile)', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant readFile permission only
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')

      // writeFile should still be denied
      await expect(
        callHandler('fs:writeFile', filePath, 'new content')
      ).rejects.toThrow(/Permission denied: fs:writeFile/)
    })
  })

  // ─── fs:writeFile permission enforcement ──────────────────────────────

  describe('fs:writeFile permission enforcement', () => {
    it('should deny fs:writeFile when no permission is granted', async () => {
      const filePath = join(tempDir, 'write-test.txt')
      await expect(
        callHandler('fs:writeFile', filePath, 'content')
      ).rejects.toThrow(/Permission denied: fs:writeFile/)
    })

    it('should allow fs:writeFile after granting permission', async () => {
      const filePath = join(tempDir, 'write-test.txt')

      await sharedPermissionService.grant(filePath, 'fs:writeFile', 'session')
      await callHandler('fs:writeFile', filePath, 'written content')

      // Grant read permission to verify the write worked
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')
      const content = await callHandler<string>('fs:readFile', filePath)
      expect(content).toBe('written content')
    })
  })

  // ─── fs:bash permission enforcement ───────────────────────────────────

  describe('fs:bash permission enforcement', () => {
    it('should deny fs:bash when no permission is granted for the CWD', async () => {
      await expect(
        callHandler('fs:bash', 'echo hello', { cwd: tempDir })
      ).rejects.toThrow(/Permission denied: fs:bash/)
    })

    it('should allow fs:bash after granting permission for the CWD', async () => {
      await sharedPermissionService.grant(tempDir, 'fs:bash', 'session')

      const result = await callHandler<{ stdout: string; exitCode: number }>(
        'fs:bash',
        'echo hello',
        { cwd: tempDir }
      )
      expect(result.stdout.trim()).toBe('hello')
      expect(result.exitCode).toBe(0)
    })

    it('should deny fs:bash for a different CWD without permission', async () => {
      // Grant permission for tempDir
      await sharedPermissionService.grant(tempDir, 'fs:bash', 'session')

      // Try to use a different directory as CWD
      const otherDir = realpathSync(mkdtempSync(join(tmpdir(), 'perm-other-')))
      try {
        await expect(
          callHandler('fs:bash', 'echo hello', { cwd: otherDir })
        ).rejects.toThrow(/Permission denied: fs:bash/)
      } finally {
        rmSync(otherDir, { recursive: true, force: true })
      }
    })
  })

  // ─── Shared instance behavior ─────────────────────────────────────────

  describe('shared permission service instance', () => {
    it('should share state across different handler types', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant via the shared service
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')

      // Should work through the handler
      const content = await callHandler<string>('fs:readFile', filePath)
      expect(content).toBe('hello world')
    })

    it('should clear session permissions for all handlers at once', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      // Grant multiple permissions
      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')
      await sharedPermissionService.grant(filePath, 'fs:writeFile', 'session')
      await sharedPermissionService.grant(tempDir, 'fs:bash', 'session')

      // All should work
      await callHandler<string>('fs:readFile', filePath)

      // Clear all session permissions
      sharedPermissionService.clearSession()

      // All should now fail
      await expect(callHandler('fs:readFile', filePath)).rejects.toThrow(
        /Permission denied/
      )
      await expect(
        callHandler('fs:writeFile', filePath, 'content')
      ).rejects.toThrow(/Permission denied/)
      await expect(
        callHandler('fs:bash', 'echo test', { cwd: tempDir })
      ).rejects.toThrow(/Permission denied/)
    })

    it('should list permissions from the shared instance', async () => {
      const filePath = join(tempDir, 'test-file.txt')

      await sharedPermissionService.grant(filePath, 'fs:readFile', 'session')
      await sharedPermissionService.grant(filePath, 'fs:writeFile', 'always')

      const permissions = await sharedPermissionService.list()
      expect(permissions.length).toBeGreaterThanOrEqual(2)

      const readPerm = permissions.find(
        (p) => p.path === filePath && p.operation === 'fs:readFile'
      )
      const writePerm = permissions.find(
        (p) => p.path === filePath && p.operation === 'fs:writeFile'
      )

      expect(readPerm).toBeDefined()
      expect(readPerm!.scope).toBe('session')
      expect(writePerm).toBeDefined()
      expect(writePerm!.scope).toBe('always')

      // Cleanup persistent permission
      await sharedPermissionService.revoke(filePath, 'fs:writeFile')
    })
  })

  // ─── Sensitive path checks still take precedence ──────────────────────

  describe('sensitive path blocking takes precedence over permissions', () => {
    it('should block sensitive paths even if permission is granted', async () => {
      // Even if someone grants permission, sensitive path validation happens first
      await sharedPermissionService.grant(
        '/home/user/.ssh/id_rsa',
        'fs:readFile',
        'session'
      )

      await expect(
        callHandler('fs:readFile', '/home/user/.ssh/id_rsa')
      ).rejects.toThrow('Access denied: path matches restricted pattern')
    })
  })
})
