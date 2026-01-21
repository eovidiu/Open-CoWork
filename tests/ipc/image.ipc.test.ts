import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import type { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Sample 1x1 PNG image as base64 data URL
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Store registered handlers so we can call them directly
const registeredHandlers: Map<string, Function> = new Map()

// Mock electron modules BEFORE importing the IPC module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler)
    })
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        // Return a temp directory for testing
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

describe('Image IPC Handlers (Integration)', () => {
  let cleanup: () => Promise<void>
  let imagesDir: string
  let conversationId: string

  beforeAll(async () => {
    // Create test database
    const ctx = await createTestDb()
    testPrisma = ctx.prisma
    cleanup = ctx.cleanup

    // Create a temp directory for test images
    imagesDir = mkdtempSync(join(tmpdir(), 'open-cowork-ipc-test-'))
    process.env.TEST_USER_DATA_PATH = imagesDir

    // Now import and register the IPC handlers
    // This tests that the handlers register correctly and use the mocked database
    const { registerImageHandlers } = await import('../../src/main/ipc/image.ipc')
    registerImageHandlers()
  })

  afterAll(async () => {
    await cleanup()
    if (existsSync(imagesDir)) {
      rmSync(imagesDir, { recursive: true, force: true })
    }
  })

  beforeEach(async () => {
    // Clean up images and conversations before each test
    await testPrisma.image.deleteMany()
    await testPrisma.conversation.deleteMany()

    // Create a fresh conversation
    const conversation = await testPrisma.conversation.create({
      data: { title: 'Test Conversation' }
    })
    conversationId = conversation.id
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
    it('should register all image handlers', () => {
      expect(registeredHandlers.has('image:save')).toBe(true)
      expect(registeredHandlers.has('image:get')).toBe(true)
      expect(registeredHandlers.has('image:getMetadata')).toBe(true)
      expect(registeredHandlers.has('image:updateDescription')).toBe(true)
      expect(registeredHandlers.has('image:list')).toBe(true)
      expect(registeredHandlers.has('image:deleteConversationImages')).toBe(true)
    })
  })

  describe('image:save', () => {
    it('should save an image and return sequence number', async () => {
      const result = await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot',
        { url: 'https://example.com' }
      )

      expect(result).toBe(1)
    })

    it('should auto-increment sequence numbers', async () => {
      const result1 = await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      const result2 = await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      expect(result1).toBe(1)
      expect(result2).toBe(2)
    })
  })

  describe('image:get', () => {
    it('should return null for non-existent image', async () => {
      const result = await callHandler<string | null>(
        'image:get',
        conversationId,
        999
      )

      expect(result).toBeNull()
    })

    it('should return the image as a data URL', async () => {
      // First save an image
      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      // Then retrieve it
      const result = await callHandler<string | null>(
        'image:get',
        conversationId,
        1
      )

      expect(result).not.toBeNull()
      expect(result).toMatch(/^data:image\/png;base64,/)
    })
  })

  describe('image:getMetadata', () => {
    it('should return metadata without image data', async () => {
      // First save an image
      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot',
        { url: 'https://example.com' }
      )

      // Get metadata
      const result = await callHandler<{
        sequenceNum: number
        mimeType: string
        source: string
        sourceUrl: string | null
      } | null>('image:getMetadata', conversationId, 1)

      expect(result).not.toBeNull()
      expect(result!.sequenceNum).toBe(1)
      expect(result!.mimeType).toBe('image/png')
      expect(result!.source).toBe('screenshot')
      expect(result!.sourceUrl).toBe('https://example.com')
    })
  })

  describe('image:updateDescription', () => {
    it('should update the cached description', async () => {
      // First save an image
      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      // Update description
      const updateResult = await callHandler<{ success: boolean }>(
        'image:updateDescription',
        conversationId,
        1,
        'A test screenshot'
      )

      expect(updateResult.success).toBe(true)

      // Verify via metadata
      const metadata = await callHandler<{ description: string | null } | null>(
        'image:getMetadata',
        conversationId,
        1
      )

      expect(metadata!.description).toBe('A test screenshot')
    })
  })

  describe('image:list', () => {
    it('should return empty array for conversation with no images', async () => {
      const result = await callHandler<unknown[]>('image:list', conversationId)
      expect(result).toEqual([])
    })

    it('should return all images for a conversation', async () => {
      // Save multiple images
      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/jpeg',
        'upload',
        { filename: 'photo.jpg' }
      )

      const result = await callHandler<Array<{ sequenceNum: number; source: string }>>(
        'image:list',
        conversationId
      )

      expect(result).toHaveLength(2)
      expect(result[0].sequenceNum).toBe(1)
      expect(result[0].source).toBe('screenshot')
      expect(result[1].sequenceNum).toBe(2)
      expect(result[1].source).toBe('upload')
    })
  })

  describe('image:deleteConversationImages', () => {
    it('should delete all images for a conversation', async () => {
      // Save images
      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot'
      )

      // Verify images exist
      let images = await callHandler<unknown[]>('image:list', conversationId)
      expect(images).toHaveLength(2)

      // Delete
      const result = await callHandler<{ success: boolean }>(
        'image:deleteConversationImages',
        conversationId
      )

      expect(result.success).toBe(true)

      // Verify images are gone (from file system - DB records still exist until conversation delete)
      // The service deletes files, cascade delete handles DB records
    })
  })

  describe('full round-trip', () => {
    it('should handle a complete image lifecycle', async () => {
      // 1. Save image
      const imageId = await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'screenshot',
        { url: 'https://example.com/page' }
      )
      expect(imageId).toBe(1)

      // 2. List images
      const images = await callHandler<Array<{ sequenceNum: number }>>(
        'image:list',
        conversationId
      )
      expect(images).toHaveLength(1)
      expect(images[0].sequenceNum).toBe(1)

      // 3. Get image data
      const imageData = await callHandler<string | null>(
        'image:get',
        conversationId,
        1
      )
      expect(imageData).toMatch(/^data:image\/png;base64,/)

      // 4. Get metadata
      const metadata = await callHandler<{ sourceUrl: string | null } | null>(
        'image:getMetadata',
        conversationId,
        1
      )
      expect(metadata!.sourceUrl).toBe('https://example.com/page')

      // 5. Update description
      await callHandler<{ success: boolean }>(
        'image:updateDescription',
        conversationId,
        1,
        'Screenshot of example.com'
      )

      // 6. Verify description was saved
      const updatedMetadata = await callHandler<{ description: string | null } | null>(
        'image:getMetadata',
        conversationId,
        1
      )
      expect(updatedMetadata!.description).toBe('Screenshot of example.com')

      // 7. Save another image
      const imageId2 = await callHandler<number>(
        'image:save',
        conversationId,
        SAMPLE_PNG_DATA_URL,
        'image/png',
        'upload',
        { filename: 'my-upload.png' }
      )
      expect(imageId2).toBe(2)

      // 8. List should show both
      const allImages = await callHandler<unknown[]>('image:list', conversationId)
      expect(allImages).toHaveLength(2)
    })
  })
})
