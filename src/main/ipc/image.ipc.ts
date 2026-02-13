import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { createImageService, type SaveImageInput, type ImageService } from '../services/image.service'
import { secureHandler, createRateLimiter } from './ipc-security'

// Lazy-loaded image service to ensure database is fully initialized
let imageService: ImageService | null = null

function getImageService(): ImageService {
  if (!imageService) {
    const prisma = getDatabase()
    imageService = createImageService(prisma)
  }
  return imageService
}

export function registerImageHandlers(): void {
  // Rate limiter for moderate operations
  const moderateLimiter = createRateLimiter(60, 60000) // 60 calls per minute

  // Save image to registry
  ipcMain.handle(
    'image:save',
    secureHandler(async (
      _,
      conversationId: string,
      base64Data: string,
      mimeType: string,
      source: 'upload' | 'screenshot' | 'viewImage',
      meta?: { url?: string; filename?: string }
    ) => {
      const input: SaveImageInput = {
        conversationId,
        base64Data,
        mimeType,
        source,
        sourceUrl: meta?.url,
        sourceName: meta?.filename
      }
      return getImageService().saveImage(input)
    }, moderateLimiter)
  )

  // Get image by conversation ID and sequence number
  ipcMain.handle('image:get', secureHandler(async (_, conversationId: string, sequenceNum: number) => {
    return getImageService().getImage(conversationId, sequenceNum)
  }, moderateLimiter))

  // Get image metadata (without actual image data)
  ipcMain.handle('image:getMetadata', secureHandler(async (_, conversationId: string, sequenceNum: number) => {
    return getImageService().getImageMetadata(conversationId, sequenceNum)
  }, moderateLimiter))

  // Update/cache image description
  ipcMain.handle(
    'image:updateDescription',
    secureHandler(async (_, conversationId: string, sequenceNum: number, description: string) => {
      await getImageService().updateDescription(conversationId, sequenceNum, description)
      return { success: true }
    }, moderateLimiter)
  )

  // List all images for a conversation
  ipcMain.handle('image:list', secureHandler(async (_, conversationId: string) => {
    return getImageService().listImages(conversationId)
  }, moderateLimiter))

  // Delete conversation images (called before conversation deletion)
  ipcMain.handle('image:deleteConversationImages', secureHandler(async (_, conversationId: string) => {
    await getImageService().deleteConversationImages(conversationId)
    return { success: true }
  }, moderateLimiter))
}

export { createImageService }
