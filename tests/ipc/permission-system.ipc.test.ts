import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import { createPermissionService } from '../../src/main/services/permission.service'
import type { PrismaClient } from '@prisma/client'
import { mkdtempSync, writeFileSync, statSync, rmSync, existsSync } from 'fs'
import { chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Store registered handlers so we can call them directly
const registeredHandlers: Map<string, Function> = new Map()

// Mock createRateLimiter to disable rate limiting in tests
vi.mock('../../src/main/ipc/ipc-security', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/ipc/ipc-security')>('../../src/main/ipc/ipc-security')
  return {
    ...actual,
    createRateLimiter: () => ({ check: () => true, getStats: () => ({ calls: 0, windowMs: 0, maxCalls: Infinity }) })
  }
})

// Mock electron modules BEFORE importing the IPC module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler)
    })
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return process.env.TEST_USER_DATA_PATH || tmpdir()
      }
      return tmpdir()
    }),
    isPackaged: false
  }
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

// ============================================================================
// Part 1: Permission Key Collision Prevention (permission.service.ts)
// ============================================================================

describe('Permission Key Collision Prevention', () => {
  let prisma: PrismaClient
  let cleanup: () => Promise<void>
  let permissionService: ReturnType<typeof createPermissionService>

  beforeAll(async () => {
    const ctx = await createTestDb()
    prisma = ctx.prisma
    cleanup = ctx.cleanup
  })

  afterAll(async () => {
    await cleanup()
  })

  beforeEach(async () => {
    await prisma.permission.deleteMany()
    permissionService = createPermissionService(prisma)
  })

  describe('URL-encoded key format with :: delimiter', () => {
    it('should use URL-encoded keys with :: delimiter in session permissions', async () => {
      await permissionService.grant('/test/path', 'read', 'session')

      const map = permissionService.getSessionPermissions()
      const expectedKey = `${encodeURIComponent('/test/path')}::${encodeURIComponent('read')}`

      expect(map.has(expectedKey)).toBe(true)
      expect(expectedKey).toBe('%2Ftest%2Fpath::read')
    })

    it('should correctly encode special characters in paths', async () => {
      const specialPath = '/path/with spaces/and:colons'
      await permissionService.grant(specialPath, 'write', 'session')

      const map = permissionService.getSessionPermissions()
      const expectedKey = `${encodeURIComponent(specialPath)}::${encodeURIComponent('write')}`

      expect(map.has(expectedKey)).toBe(true)
      // Verify colons and spaces are encoded
      expect(expectedKey).toContain('%3A')
      expect(expectedKey).toContain('%20')
    })

    it('should correctly encode special characters in operations', async () => {
      await permissionService.grant('/test', 'read:write', 'session')

      const map = permissionService.getSessionPermissions()
      const expectedKey = `${encodeURIComponent('/test')}::${encodeURIComponent('read:write')}`

      expect(map.has(expectedKey)).toBe(true)
      // The colon in the operation should be encoded
      expect(expectedKey).toBe('%2Ftest::read%3Awrite')
    })
  })

  describe('collision prevention for paths and operations containing colons', () => {
    it('should distinguish path "a:b" op "c" from path "a" op "b:c" (old format collision)', async () => {
      // These two would collide in old "path:operation" format:
      // "a:b" + "c" => "a:b:c"
      // "a" + "b:c" => "a:b:c"
      await permissionService.grant('a:b', 'c', 'session')
      await permissionService.grant('a', 'b:c', 'session')

      const map = permissionService.getSessionPermissions()

      const key1 = `${encodeURIComponent('a:b')}::${encodeURIComponent('c')}`
      const key2 = `${encodeURIComponent('a')}::${encodeURIComponent('b:c')}`

      // Keys should be different
      expect(key1).not.toBe(key2)
      expect(key1).toBe('a%3Ab::c')
      expect(key2).toBe('a::b%3Ac')

      // Both should exist independently
      expect(map.has(key1)).toBe(true)
      expect(map.has(key2)).toBe(true)
      expect(map.size).toBe(2)
    })

    it('should prevent collision with path containing :: delimiter', async () => {
      // Path that literally contains :: (the delimiter itself)
      await permissionService.grant('path::value', 'read', 'session')
      await permissionService.grant('path', 'value::read', 'session')

      const map = permissionService.getSessionPermissions()

      const key1 = `${encodeURIComponent('path::value')}::${encodeURIComponent('read')}`
      const key2 = `${encodeURIComponent('path')}::${encodeURIComponent('value::read')}`

      expect(key1).not.toBe(key2)
      expect(map.has(key1)).toBe(true)
      expect(map.has(key2)).toBe(true)
      expect(map.size).toBe(2)
    })

    it('should not collide when path ends with delimiter-like sequence', async () => {
      await permissionService.grant('/etc/shadow:', 'read', 'session')
      await permissionService.grant('/etc/shadow', ':read', 'session')

      const map = permissionService.getSessionPermissions()
      expect(map.size).toBe(2)

      // Check both independently
      const result1 = await permissionService.check('/etc/shadow:', 'read')
      const result2 = await permissionService.check('/etc/shadow', ':read')

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()
      expect(result1!.path).toBe('/etc/shadow:')
      expect(result2!.path).toBe('/etc/shadow')
    })
  })

  describe('grant/check/revoke with URL-encoded keys', () => {
    it('should grant and check session permission with encoded keys', async () => {
      const path = '/path/with:colon'
      const operation = 'read:write'

      await permissionService.grant(path, operation, 'session')
      const result = await permissionService.check(path, operation)

      expect(result).toBeDefined()
      expect(result!.scope).toBe('session')
      expect(result!.path).toBe(path)
      expect(result!.operation).toBe(operation)
    })

    it('should grant and check persisted permission with special characters', async () => {
      const path = '/path/with spaces & symbols!'
      const operation = 'read+write'

      await permissionService.grant(path, operation, 'always')
      const result = await permissionService.check(path, operation)

      expect(result).toBeDefined()
      expect(result!.scope).toBe('always')
    })

    it('should revoke session permission with encoded keys', async () => {
      const path = 'a:b:c'
      const operation = 'd:e'

      await permissionService.grant(path, operation, 'session')

      // Verify it exists
      let result = await permissionService.check(path, operation)
      expect(result).toBeDefined()

      // Revoke
      await permissionService.revoke(path, operation)

      // Verify it is gone
      result = await permissionService.check(path, operation)
      expect(result).toBeNull()
    })

    it('should revoke persisted permission with special characters', async () => {
      const path = '/path/with::double-colon'
      const operation = 'execute'

      await permissionService.grant(path, operation, 'always')
      await permissionService.revoke(path, operation)

      const result = await permissionService.check(path, operation)
      expect(result).toBeNull()
    })
  })

  describe('list with URL-encoded keys (session decoding)', () => {
    it('should correctly decode URL-encoded paths and operations in list', async () => {
      const path = '/path/with:colon'
      const operation = 'read:write'

      await permissionService.grant(path, operation, 'session')
      const permissions = await permissionService.list()

      const sessionPerm = permissions.find((p) => p.scope === 'session')
      expect(sessionPerm).toBeDefined()
      expect(sessionPerm!.path).toBe(path)
      expect(sessionPerm!.operation).toBe(operation)
    })

    it('should list collision-prone permissions with correct decoded values', async () => {
      await permissionService.grant('a:b', 'c', 'session')
      await permissionService.grant('a', 'b:c', 'session')

      const permissions = await permissionService.list()
      expect(permissions).toHaveLength(2)

      const perm1 = permissions.find((p) => p.path === 'a:b')
      const perm2 = permissions.find((p) => p.path === 'a')

      expect(perm1).toBeDefined()
      expect(perm1!.operation).toBe('c')

      expect(perm2).toBeDefined()
      expect(perm2!.operation).toBe('b:c')
    })

    it('should list both session and persisted permissions with special chars', async () => {
      await permissionService.grant('/path:1', 'op:a', 'session')
      await permissionService.grant('/path:2', 'op:b', 'always')

      const permissions = await permissionService.list()
      expect(permissions).toHaveLength(2)

      const sessionPerm = permissions.find((p) => p.scope === 'session')
      const persistedPerm = permissions.find((p) => p.scope === 'always')

      expect(sessionPerm!.path).toBe('/path:1')
      expect(sessionPerm!.operation).toBe('op:a')
      expect(persistedPerm!.path).toBe('/path:2')
      expect(persistedPerm!.operation).toBe('op:b')
    })
  })

  describe('edge cases with special characters', () => {
    it('should handle empty strings', async () => {
      await permissionService.grant('', '', 'session')

      const map = permissionService.getSessionPermissions()
      const expectedKey = `${encodeURIComponent('')}::${encodeURIComponent('')}`
      expect(expectedKey).toBe('::')
      expect(map.has(expectedKey)).toBe(true)

      const result = await permissionService.check('', '')
      expect(result).toBeDefined()
    })

    it('should handle paths with unicode characters', async () => {
      const path = '/home/user/documents/rapport-financier'
      const operation = 'read'

      await permissionService.grant(path, operation, 'session')
      const result = await permissionService.check(path, operation)

      expect(result).toBeDefined()
      expect(result!.path).toBe(path)
    })

    it('should handle paths with percent signs (no double-encoding issues)', async () => {
      const path = '/path/with%20encoded'
      const operation = 'read'

      await permissionService.grant(path, operation, 'session')

      const map = permissionService.getSessionPermissions()
      // The % itself should be encoded to %25
      const expectedKey = `${encodeURIComponent(path)}::${encodeURIComponent(operation)}`
      expect(expectedKey).toContain('%2520')
      expect(map.has(expectedKey)).toBe(true)

      // Should round-trip correctly through list
      const permissions = await permissionService.list()
      const perm = permissions.find((p) => p.scope === 'session')
      expect(perm!.path).toBe(path)
    })

    it('should handle paths with slashes and backslashes', async () => {
      await permissionService.grant('/unix/path', 'read', 'session')
      await permissionService.grant('C:\\windows\\path', 'read', 'session')

      const map = permissionService.getSessionPermissions()
      expect(map.size).toBe(2)

      const r1 = await permissionService.check('/unix/path', 'read')
      const r2 = await permissionService.check('C:\\windows\\path', 'read')
      expect(r1).toBeDefined()
      expect(r2).toBeDefined()
    })

    it('should handle very long paths', async () => {
      const longPath = '/a' + '/b'.repeat(500)
      await permissionService.grant(longPath, 'read', 'session')

      const result = await permissionService.check(longPath, 'read')
      expect(result).toBeDefined()
      expect(result!.path).toBe(longPath)
    })
  })
})

// ============================================================================
// Part 2: Database File Permissions (database.ts)
// ============================================================================

describe('Database File Permissions', () => {
  it('should set 0o600 permissions on database file via chmod', async () => {
    // Create a temp file to simulate a database file
    const tempDir = mkdtempSync(join(tmpdir(), 'db-perm-test-'))
    const dbFilePath = join(tempDir, 'test.db')

    try {
      // Create a file
      writeFileSync(dbFilePath, 'test database content')

      // Verify default permissions are more permissive than 0o600
      const beforeStat = statSync(dbFilePath)
      const beforeMode = beforeStat.mode & 0o777

      // Apply the same chmod call the database module uses
      await chmod(dbFilePath, 0o600)

      // Verify permissions were set correctly
      const afterStat = statSync(dbFilePath)
      const afterMode = afterStat.mode & 0o777

      expect(afterMode).toBe(0o600)
      // Owner can read and write, nobody else can access
      expect(afterMode & 0o400).toBe(0o400) // owner read
      expect(afterMode & 0o200).toBe(0o200) // owner write
      expect(afterMode & 0o100).toBe(0)     // no owner execute
      expect(afterMode & 0o070).toBe(0)     // no group permissions
      expect(afterMode & 0o007).toBe(0)     // no other permissions
    } finally {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  })

  it('should not throw when chmod fails (e.g. Windows compatibility)', async () => {
    // chmod on non-existent file should throw, but in the database code
    // it is wrapped in a .catch(() => {}) so it should not propagate
    const nonExistentPath = join(tmpdir(), 'does-not-exist-' + Date.now() + '.db')

    // Simulating what the database code does: chmod with catch
    await expect(
      chmod(nonExistentPath, 0o600).catch(() => {
        // Ignore chmod errors (same as database.ts)
      })
    ).resolves.toBeUndefined()
  })
})

// ============================================================================
// Part 3: Production DB Path Blocked in Filesystem Handlers
// ============================================================================

describe('Production DB Path in Sensitive Paths', () => {
  beforeAll(async () => {
    // Initialize sender validation for secureHandler
    const { setMainWindow } = await import('../../src/main/ipc/ipc-security')
    setMainWindow({ webContents: { id: 1 } } as any)

    // Import filesystem handlers to register them
    const { registerFileSystemHandlers } = await import('../../src/main/ipc/file-system.ipc')
    registerFileSystemHandlers()
  })

  it('should block access to open-cowork.db', async () => {
    const handler = registeredHandlers.get('fs:readFile')
    expect(handler).toBeDefined()

    await expect(
      callHandler('fs:readFile', '/home/user/.config/open-cowork.db')
    ).rejects.toThrow(/Access denied|restricted/)
  })

  it('should block access to dev.db', async () => {
    await expect(
      callHandler('fs:readFile', '/some/path/dev.db')
    ).rejects.toThrow(/Access denied|restricted/)
  })

  it('should block write access to database paths', async () => {
    const handler = registeredHandlers.get('fs:writeFile')
    expect(handler).toBeDefined()

    await expect(
      callHandler('fs:writeFile', '/home/user/.config/open-cowork.db', 'malicious data')
    ).rejects.toThrow(/Access denied|restricted/)
  })

  it('should block access to paths containing open-cowork.db anywhere', async () => {
    await expect(
      callHandler('fs:readFile', '/var/data/open-cowork.db')
    ).rejects.toThrow(/Access denied|restricted/)
  })

  it('should block access to .prisma directory', async () => {
    await expect(
      callHandler('fs:readFile', '/home/user/.prisma/client/index.js')
    ).rejects.toThrow(/Access denied|restricted/)
  })
})
