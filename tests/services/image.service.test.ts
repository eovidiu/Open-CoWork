import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import type { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock electron BEFORE importing modules that use it
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return tmpdir()
      }
      return tmpdir()
    })
  }
}))

// Import after mocking
import { createImageService } from '../../src/main/services/image.service'
import { createConversationService } from '../../src/main/services/conversation.service'

// Sample 1x1 PNG image as base64 data URL
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Same image without data URL prefix
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('ImageService', () => {
  let prisma: PrismaClient
  let cleanup: () => Promise<void>
  let imageService: ReturnType<typeof createImageService>
  let conversationService: ReturnType<typeof createConversationService>
  let imagesDir: string
  let conversationId: string

  beforeAll(async () => {
    const ctx = await createTestDb()
    prisma = ctx.prisma
    cleanup = ctx.cleanup

    // Create a temp directory for test images
    imagesDir = mkdtempSync(join(tmpdir(), 'open-cowork-images-test-'))

    imageService = createImageService(prisma, { imagesDir })
    conversationService = createConversationService(prisma)
  })

  afterAll(async () => {
    await cleanup()
    // Clean up the temp images directory
    if (existsSync(imagesDir)) {
      rmSync(imagesDir, { recursive: true, force: true })
    }
  })

  beforeEach(async () => {
    // Clean up images and conversations before each test
    await prisma.image.deleteMany()
    await prisma.conversation.deleteMany()

    // Create a fresh conversation for each test
    const conversation = await conversationService.create('Test Conversation')
    conversationId = conversation.id
  })

  describe('saveImage', () => {
    it('should save an image and return a sequence number', async () => {
      const sequenceNum = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot',
        sourceUrl: 'https://example.com'
      })

      expect(sequenceNum).toBe(1)
    })

    it('should auto-increment sequence numbers per conversation', async () => {
      const seq1 = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const seq2 = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const seq3 = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'upload'
      })

      expect(seq1).toBe(1)
      expect(seq2).toBe(2)
      expect(seq3).toBe(3)
    })

    it('should reset sequence numbers for different conversations', async () => {
      const conversation2 = await conversationService.create('Second Conversation')

      const seq1Conv1 = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const seq1Conv2 = await imageService.saveImage({
        conversationId: conversation2.id,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      expect(seq1Conv1).toBe(1)
      expect(seq1Conv2).toBe(1) // Each conversation starts at 1
    })

    it('should save the image file to disk', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      // Verify a file was created in the images directory
      const image = await prisma.image.findFirst({
        where: { conversationId }
      })

      expect(image).toBeDefined()
      const filePath = join(imagesDir, image!.filename)
      expect(existsSync(filePath)).toBe(true)
    })

    it('should handle base64 data without data URL prefix', async () => {
      const sequenceNum = await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_BASE64,
        mimeType: 'image/png',
        source: 'upload'
      })

      expect(sequenceNum).toBe(1)

      // Verify the image can be retrieved
      const imageData = await imageService.getImage(conversationId, 1)
      expect(imageData).not.toBeNull()
    })

    it('should store metadata correctly', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot',
        sourceUrl: 'https://example.com/page',
        sourceName: undefined
      })

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/jpeg',
        source: 'upload',
        sourceUrl: undefined,
        sourceName: 'my-image.jpg'
      })

      const images = await prisma.image.findMany({
        where: { conversationId },
        orderBy: { sequenceNum: 'asc' }
      })

      expect(images[0].source).toBe('screenshot')
      expect(images[0].sourceUrl).toBe('https://example.com/page')
      expect(images[0].mimeType).toBe('image/png')

      expect(images[1].source).toBe('upload')
      expect(images[1].sourceName).toBe('my-image.jpg')
      expect(images[1].mimeType).toBe('image/jpeg')
    })
  })

  describe('getImage', () => {
    it('should return null for non-existent image', async () => {
      const result = await imageService.getImage(conversationId, 999)
      expect(result).toBeNull()
    })

    it('should return the image as a data URL', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const imageDataUrl = await imageService.getImage(conversationId, 1)

      expect(imageDataUrl).not.toBeNull()
      expect(imageDataUrl).toMatch(/^data:image\/png;base64,/)
    })

    it('should return correct data for the requested sequence number', async () => {
      // Save multiple images
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const image1 = await imageService.getImage(conversationId, 1)
      const image2 = await imageService.getImage(conversationId, 2)

      expect(image1).not.toBeNull()
      expect(image2).not.toBeNull()
    })
  })

  describe('getImageMetadata', () => {
    it('should return null for non-existent image', async () => {
      const result = await imageService.getImageMetadata(conversationId, 999)
      expect(result).toBeNull()
    })

    it('should return metadata without image data', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot',
        sourceUrl: 'https://example.com'
      })

      const metadata = await imageService.getImageMetadata(conversationId, 1)

      expect(metadata).toBeDefined()
      expect(metadata!.sequenceNum).toBe(1)
      expect(metadata!.mimeType).toBe('image/png')
      expect(metadata!.source).toBe('screenshot')
      expect(metadata!.sourceUrl).toBe('https://example.com')
      expect(metadata!.description).toBeNull()
      expect(metadata!.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('updateDescription', () => {
    it('should update the cached description', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.updateDescription(conversationId, 1, 'A screenshot of a login page')

      const metadata = await imageService.getImageMetadata(conversationId, 1)
      expect(metadata!.description).toBe('A screenshot of a login page')
    })

    it('should allow updating description multiple times', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.updateDescription(conversationId, 1, 'First description')
      await imageService.updateDescription(conversationId, 1, 'Updated description')

      const metadata = await imageService.getImageMetadata(conversationId, 1)
      expect(metadata!.description).toBe('Updated description')
    })
  })

  describe('listImages', () => {
    it('should return empty array for conversation with no images', async () => {
      const images = await imageService.listImages(conversationId)
      expect(images).toEqual([])
    })

    it('should return all images for a conversation in order', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot',
        sourceUrl: 'https://page1.com'
      })

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/jpeg',
        source: 'upload',
        sourceName: 'photo.jpg'
      })

      const images = await imageService.listImages(conversationId)

      expect(images).toHaveLength(2)
      expect(images[0].sequenceNum).toBe(1)
      expect(images[0].source).toBe('screenshot')
      expect(images[1].sequenceNum).toBe(2)
      expect(images[1].source).toBe('upload')
    })

    it('should not return images from other conversations', async () => {
      const conversation2 = await conversationService.create('Second Conversation')

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.saveImage({
        conversationId: conversation2.id,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      const images1 = await imageService.listImages(conversationId)
      const images2 = await imageService.listImages(conversation2.id)

      expect(images1).toHaveLength(1)
      expect(images2).toHaveLength(1)
    })
  })

  describe('deleteConversationImages', () => {
    it('should delete all image files for a conversation', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      // Get the filenames before deletion
      const images = await prisma.image.findMany({
        where: { conversationId }
      })
      const filePaths = images.map((img) => join(imagesDir, img.filename))

      // Verify files exist
      filePaths.forEach((path) => {
        expect(existsSync(path)).toBe(true)
      })

      // Delete the conversation images
      await imageService.deleteConversationImages(conversationId)

      // Verify files are deleted
      filePaths.forEach((path) => {
        expect(existsSync(path)).toBe(false)
      })
    })

    it('should not delete images from other conversations', async () => {
      const conversation2 = await conversationService.create('Second Conversation')

      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      await imageService.saveImage({
        conversationId: conversation2.id,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      // Get the filename from conversation2
      const conv2Image = await prisma.image.findFirst({
        where: { conversationId: conversation2.id }
      })
      const conv2FilePath = join(imagesDir, conv2Image!.filename)

      // Delete images from conversation1 only
      await imageService.deleteConversationImages(conversationId)

      // Verify conversation2's image still exists
      expect(existsSync(conv2FilePath)).toBe(true)
    })

    it('should handle gracefully when files are already deleted', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      // Manually delete the file
      const image = await prisma.image.findFirst({
        where: { conversationId }
      })
      const filePath = join(imagesDir, image!.filename)
      rmSync(filePath)

      // Should not throw when trying to delete already-deleted file
      await expect(imageService.deleteConversationImages(conversationId)).resolves.not.toThrow()
    })
  })

  describe('cascade delete with conversations', () => {
    it('should delete images when conversation is deleted (via Prisma cascade)', async () => {
      await imageService.saveImage({
        conversationId,
        base64Data: SAMPLE_PNG_DATA_URL,
        mimeType: 'image/png',
        source: 'screenshot'
      })

      // First clean up the files (like the IPC handler does)
      await imageService.deleteConversationImages(conversationId)

      // Then delete the conversation (this will cascade delete DB records)
      await conversationService.delete(conversationId)

      // Verify no images exist for this conversation
      const images = await prisma.image.findMany({
        where: { conversationId }
      })
      expect(images).toHaveLength(0)
    })
  })
})
