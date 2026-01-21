import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export interface SaveImageInput {
  conversationId: string
  base64Data: string // base64 data URL (data:image/png;base64,...)
  mimeType: string
  source: 'upload' | 'screenshot' | 'viewImage'
  sourceUrl?: string
  sourceName?: string
}

export interface ImageMetadata {
  id: string
  sequenceNum: number
  mimeType: string
  source: string
  sourceUrl: string | null
  sourceName: string | null
  description: string | null
  createdAt: Date
}

export interface ImageServiceOptions {
  imagesDir?: string // Optional custom directory for testing
}

export function createImageService(prisma: PrismaClient, options?: ImageServiceOptions) {
  // Ensure images directory exists
  const imagesDir = options?.imagesDir || path.join(app.getPath('userData'), 'images')
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  /**
   * Get the file extension from a mime type
   */
  function getExtFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    }
    return mimeToExt[mimeType] || 'png'
  }

  /**
   * Extract base64 data from a data URL
   */
  function extractBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
    return match ? match[1] : dataUrl
  }

  return {
    /**
     * Save an image to the registry
     * Returns the sequenceNum (1-indexed ID for this conversation)
     */
    async saveImage(input: SaveImageInput): Promise<number> {
      const { conversationId, base64Data, mimeType, source, sourceUrl, sourceName } = input

      // Get next sequence number for this conversation
      const lastImage = await prisma.image.findFirst({
        where: { conversationId },
        orderBy: { sequenceNum: 'desc' }
      })
      const sequenceNum = (lastImage?.sequenceNum || 0) + 1

      // Generate unique filename
      const ext = getExtFromMimeType(mimeType)
      const filename = `${crypto.randomUUID()}.${ext}`
      const filepath = path.join(imagesDir, filename)

      // Extract base64 and save to file
      const base64 = extractBase64(base64Data)
      const buffer = Buffer.from(base64, 'base64')
      fs.writeFileSync(filepath, buffer)

      // Create database record
      await prisma.image.create({
        data: {
          conversationId,
          sequenceNum,
          filename,
          mimeType,
          source,
          sourceUrl,
          sourceName
        }
      })

      return sequenceNum
    },

    /**
     * Get an image as a base64 data URL
     */
    async getImage(conversationId: string, sequenceNum: number): Promise<string | null> {
      const image = await prisma.image.findUnique({
        where: {
          conversationId_sequenceNum: { conversationId, sequenceNum }
        }
      })

      if (!image) return null

      const filepath = path.join(imagesDir, image.filename)
      if (!fs.existsSync(filepath)) {
        console.error(`[ImageService] Image file not found: ${filepath}`)
        return null
      }

      const buffer = fs.readFileSync(filepath)
      const base64 = buffer.toString('base64')
      return `data:${image.mimeType};base64,${base64}`
    },

    /**
     * Get image metadata without the actual image data
     */
    async getImageMetadata(
      conversationId: string,
      sequenceNum: number
    ): Promise<ImageMetadata | null> {
      const image = await prisma.image.findUnique({
        where: {
          conversationId_sequenceNum: { conversationId, sequenceNum }
        }
      })

      if (!image) return null

      return {
        id: image.id,
        sequenceNum: image.sequenceNum,
        mimeType: image.mimeType,
        source: image.source,
        sourceUrl: image.sourceUrl,
        sourceName: image.sourceName,
        description: image.description,
        createdAt: image.createdAt
      }
    },

    /**
     * Update/cache the description for an image
     */
    async updateDescription(
      conversationId: string,
      sequenceNum: number,
      description: string
    ): Promise<void> {
      await prisma.image.update({
        where: {
          conversationId_sequenceNum: { conversationId, sequenceNum }
        },
        data: { description }
      })
    },

    /**
     * List all images for a conversation
     */
    async listImages(conversationId: string): Promise<ImageMetadata[]> {
      const images = await prisma.image.findMany({
        where: { conversationId },
        orderBy: { sequenceNum: 'asc' }
      })

      return images.map((image) => ({
        id: image.id,
        sequenceNum: image.sequenceNum,
        mimeType: image.mimeType,
        source: image.source,
        sourceUrl: image.sourceUrl,
        sourceName: image.sourceName,
        description: image.description,
        createdAt: image.createdAt
      }))
    },

    /**
     * Delete all images for a conversation (called when conversation is deleted)
     * Note: The cascade delete in Prisma will handle the DB records,
     * but we need to clean up the files manually
     */
    async deleteConversationImages(conversationId: string): Promise<void> {
      const images = await prisma.image.findMany({
        where: { conversationId }
      })

      for (const image of images) {
        const filepath = path.join(imagesDir, image.filename)
        if (fs.existsSync(filepath)) {
          try {
            fs.unlinkSync(filepath)
          } catch (err) {
            console.error(`[ImageService] Failed to delete file: ${filepath}`, err)
          }
        }
      }
    }
  }
}

export type ImageService = ReturnType<typeof createImageService>
