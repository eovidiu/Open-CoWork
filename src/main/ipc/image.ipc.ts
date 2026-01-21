import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { createImageService, type SaveImageInput, type ImageService } from '../services/image.service'

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
  // Save image to registry
  ipcMain.handle(
    'image:save',
    async (
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
    }
  )

  // Get image by conversation ID and sequence number
  ipcMain.handle('image:get', async (_, conversationId: string, sequenceNum: number) => {
    return getImageService().getImage(conversationId, sequenceNum)
  })

  // Get image metadata (without actual image data)
  ipcMain.handle('image:getMetadata', async (_, conversationId: string, sequenceNum: number) => {
    return getImageService().getImageMetadata(conversationId, sequenceNum)
  })

  // Update/cache image description
  ipcMain.handle(
    'image:updateDescription',
    async (_, conversationId: string, sequenceNum: number, description: string) => {
      await getImageService().updateDescription(conversationId, sequenceNum, description)
      return { success: true }
    }
  )

  // List all images for a conversation
  ipcMain.handle('image:list', async (_, conversationId: string) => {
    return getImageService().listImages(conversationId)
  })

  // Delete conversation images (called before conversation deletion)
  ipcMain.handle('image:deleteConversationImages', async (_, conversationId: string) => {
    await getImageService().deleteConversationImages(conversationId)
    return { success: true }
  })
}

export { createImageService }
