import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import type { PrismaClient } from '@prisma/client'
import { tmpdir } from 'os'

// Store registered handlers so we can call them directly
const registeredHandlers: Map<string, Function> = new Map()

// Mock electron modules BEFORE importing the IPC module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler)
    })
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const str = buffer.toString()
      return str.startsWith('encrypted:') ? str.slice('encrypted:'.length) : str
    })
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

// Mock the database module to use our test database
let testPrisma: PrismaClient
vi.mock('../../src/main/database', () => ({
  getDatabase: () => testPrisma
}))

// Mock fs/promises for the secure storage file operations
const mockFileStore: Map<string, Buffer> = new Map()
let lastWriteMode: number | undefined

vi.mock('fs/promises', () => ({
  access: vi.fn(async (path: string) => {
    if (mockFileStore.has(path)) return undefined
    throw new Error('ENOENT')
  }),
  readFile: vi.fn(async (path: string) => {
    const data = mockFileStore.get(path)
    if (!data) throw new Error('ENOENT')
    return data
  }),
  writeFile: vi.fn(async (path: string, data: Buffer, options?: { mode?: number }) => {
    mockFileStore.set(path, data)
    if (options?.mode !== undefined) {
      lastWriteMode = options.mode
    }
  }),
  unlink: vi.fn(async (path: string) => {
    if (mockFileStore.has(path)) {
      mockFileStore.delete(path)
      return
    }
    // Ignore if file doesn't exist (matches implementation behavior)
  })
}))

describe('Auth Secrets IPC Handlers', () => {
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    // Create test database
    const ctx = await createTestDb()
    testPrisma = ctx.prisma
    cleanup = ctx.cleanup

    // Set a temp path for the userData directory
    process.env.TEST_USER_DATA_PATH = tmpdir()

    // Import and register the settings IPC handlers
    const { registerSettingsHandlers } = await import('../../src/main/ipc/settings.ipc')
    registerSettingsHandlers()
  })

  afterAll(async () => {
    await cleanup()
  })

  beforeEach(() => {
    // Clear the mock file store between tests so API key state is fresh
    mockFileStore.clear()
    lastWriteMode = undefined
  })

  // Helper to call an IPC handler
  async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler = registeredHandlers.get(channel)
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`)
    }
    // First arg to handler is the IPC event (we pass null)
    return handler(null, ...args) as Promise<T>
  }

  describe('handler registration', () => {
    it('should register the settings:setApiKey handler', () => {
      expect(registeredHandlers.has('settings:setApiKey')).toBe(true)
    })

    it('should register the settings:getApiKeyMasked handler', () => {
      expect(registeredHandlers.has('settings:getApiKeyMasked')).toBe(true)
    })

    it('should register the settings:getApiKey handler', () => {
      expect(registeredHandlers.has('settings:getApiKey')).toBe(true)
    })

    it('should register the settings:deleteApiKey handler', () => {
      expect(registeredHandlers.has('settings:deleteApiKey')).toBe(true)
    })

    it('should register all expected settings handlers', () => {
      expect(registeredHandlers.has('settings:get')).toBe(true)
      expect(registeredHandlers.has('settings:update')).toBe(true)
      expect(registeredHandlers.has('settings:getApiKey')).toBe(true)
      expect(registeredHandlers.has('settings:setApiKey')).toBe(true)
      expect(registeredHandlers.has('settings:deleteApiKey')).toBe(true)
      expect(registeredHandlers.has('settings:getApiKeyMasked')).toBe(true)
    })
  })

  describe('settings:setApiKey - API key format validation', () => {
    it('should accept a valid OpenRouter key (sk-or- prefix)', async () => {
      const validKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await expect(callHandler('settings:setApiKey', validKey)).resolves.not.toThrow()
    })

    it('should accept a valid OpenAI-style key (sk- prefix)', async () => {
      const validKey = 'sk-abcdefghijklmnopqrstuvwxyz1234567890'
      await expect(callHandler('settings:setApiKey', validKey)).resolves.not.toThrow()
    })

    it('should reject an empty string', async () => {
      await expect(callHandler('settings:setApiKey', '')).rejects.toThrow(
        'API key cannot be empty'
      )
    })

    it('should reject a whitespace-only string', async () => {
      await expect(callHandler('settings:setApiKey', '   ')).rejects.toThrow(
        'API key cannot be empty'
      )
    })

    it('should reject null/undefined', async () => {
      await expect(callHandler('settings:setApiKey', null)).rejects.toThrow(
        'API key cannot be empty'
      )
    })

    it('should reject undefined', async () => {
      await expect(callHandler('settings:setApiKey', undefined)).rejects.toThrow(
        'API key cannot be empty'
      )
    })

    it('should reject a key with an invalid prefix', async () => {
      const invalidKey = 'pk-or-v1-abcdefghijklmnopqrstuvwxyz12345'
      await expect(callHandler('settings:setApiKey', invalidKey)).rejects.toThrow(
        'Invalid API key format'
      )
    })

    it('should reject a key that is too short (under 20 chars)', async () => {
      const shortKey = 'sk-or-short'
      await expect(callHandler('settings:setApiKey', shortKey)).rejects.toThrow(
        'API key appears too short'
      )
    })

    it('should accept a key with exactly 20 characters', async () => {
      // 'sk-or-' is 6 chars, so we need 14 more to get to 20
      const key20 = 'sk-or-12345678901234'
      expect(key20.length).toBe(20)
      await expect(callHandler('settings:setApiKey', key20)).resolves.not.toThrow()
    })

    it('should reject a key with 19 characters', async () => {
      const key19 = 'sk-or-1234567890123'
      expect(key19.length).toBe(19)
      await expect(callHandler('settings:setApiKey', key19)).rejects.toThrow(
        'API key appears too short'
      )
    })

    it('should accept a very long key', async () => {
      const longKey = 'sk-or-' + 'a'.repeat(500)
      await expect(callHandler('settings:setApiKey', longKey)).resolves.not.toThrow()
    })

    it('should accept a key with special characters after prefix', async () => {
      const specialKey = 'sk-or-abc!@#$%^&*()_+-=[]{}|;:,.<>?1234'
      await expect(callHandler('settings:setApiKey', specialKey)).resolves.not.toThrow()
    })

    it('should reject a non-string value', async () => {
      await expect(callHandler('settings:setApiKey', 12345)).rejects.toThrow(
        'API key cannot be empty'
      )
    })
  })

  describe('settings:getApiKeyMasked - masked display', () => {
    it('should return null when no key is stored', async () => {
      const result = await callHandler<null>('settings:getApiKeyMasked')
      expect(result).toBeNull()
    })

    it('should return masked key info when a key is stored', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await callHandler('settings:setApiKey', testKey)

      const result = await callHandler<{
        exists: boolean
        masked: string
        length: number
      }>('settings:getApiKeyMasked')

      expect(result).not.toBeNull()
      expect(result!.exists).toBe(true)
      expect(result!.length).toBe(testKey.length)
    })

    it('should show only last 4 characters in masked output', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz7890'
      await callHandler('settings:setApiKey', testKey)

      const result = await callHandler<{
        exists: boolean
        masked: string
        length: number
      }>('settings:getApiKeyMasked')

      expect(result).not.toBeNull()
      // The masked format is '••••••••' + last 4 chars
      expect(result!.masked).toBe('••••••••7890')
    })

    it('should mask correctly for the minimum-length key', async () => {
      const minKey = 'sk-or-12345678901234' // exactly 20 chars
      await callHandler('settings:setApiKey', minKey)

      const result = await callHandler<{
        exists: boolean
        masked: string
        length: number
      }>('settings:getApiKeyMasked')

      expect(result).not.toBeNull()
      // Last 4 chars of 'sk-or-12345678901234' = '1234'
      expect(result!.masked).toBe('••••••••1234')
      expect(result!.length).toBe(20)
    })

    it('should not expose the full key in the masked response', async () => {
      const testKey = 'sk-or-v1-supersecretkey1234567890abcdef'
      await callHandler('settings:setApiKey', testKey)

      const result = await callHandler<{
        exists: boolean
        masked: string
        length: number
      }>('settings:getApiKeyMasked')

      // The masked output should NOT contain the full key
      expect(result!.masked).not.toBe(testKey)
      expect(result!.masked).not.toContain('supersecret')
      // It should only contain the bullet chars and last 4 chars
      expect(result!.masked).toMatch(/^•+.{4}$/)
    })

    it('should return null after the key is deleted', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await callHandler('settings:setApiKey', testKey)

      // Verify it exists first
      const beforeDelete = await callHandler<{ exists: boolean } | null>(
        'settings:getApiKeyMasked'
      )
      expect(beforeDelete).not.toBeNull()

      // Delete the key
      await callHandler('settings:deleteApiKey')

      // Verify it now returns null
      const afterDelete = await callHandler<null>('settings:getApiKeyMasked')
      expect(afterDelete).toBeNull()
    })
  })

  describe('file permissions', () => {
    it('should write the API key file with mode 0o600', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await callHandler('settings:setApiKey', testKey)

      expect(lastWriteMode).toBe(0o600)
    })
  })

  describe('settings:getApiKey - round trip', () => {
    it('should store and retrieve the exact key value', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await callHandler('settings:setApiKey', testKey)

      const retrieved = await callHandler<string | null>('settings:getApiKey')
      expect(retrieved).toBe(testKey)
    })

    it('should return null when no key is stored', async () => {
      const retrieved = await callHandler<string | null>('settings:getApiKey')
      expect(retrieved).toBeNull()
    })
  })

  describe('settings:deleteApiKey', () => {
    it('should delete a stored key', async () => {
      const testKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890'
      await callHandler('settings:setApiKey', testKey)

      await callHandler('settings:deleteApiKey')

      const retrieved = await callHandler<string | null>('settings:getApiKey')
      expect(retrieved).toBeNull()
    })

    it('should not throw when deleting a non-existent key', async () => {
      await expect(callHandler('settings:deleteApiKey')).resolves.not.toThrow()
    })
  })
})
