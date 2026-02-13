import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { createConversationService } from '../services/conversation.service'
import { createMessageService } from '../services/message.service'
import { createSkillService } from '../services/skill.service'
import { createImageService, type ImageService } from '../services/image.service'
import type {
  CreateMessageInput,
  UpdateMessageInput,
  CreateToolCallInput,
  UpdateToolCallInput,
  CreateSkillInput,
  UpdateSkillInput,
  UpdateConversationInput
} from '../../shared/types'
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

export function registerDatabaseHandlers(): void {
  const prisma = getDatabase()
  const conversationService = createConversationService(prisma)
  const messageService = createMessageService(prisma)
  const skillService = createSkillService(prisma)

  // Rate limiter for moderate operations
  const moderateLimiter = createRateLimiter(60, 60000) // 60 calls per minute

  // Conversations
  ipcMain.handle('db:conversations:list', secureHandler(async () => {
    return conversationService.list()
  }, moderateLimiter))

  ipcMain.handle('db:conversations:get', secureHandler(async (_, id: string) => {
    return conversationService.get(id)
  }, moderateLimiter))

  ipcMain.handle('db:conversations:create', secureHandler(async (_, title: string) => {
    return conversationService.create(title)
  }, moderateLimiter))

  ipcMain.handle('db:conversations:update', secureHandler(async (_, id: string, data: UpdateConversationInput) => {
    return conversationService.update(id, data)
  }, moderateLimiter))

  ipcMain.handle('db:conversations:delete', secureHandler(async (_, id: string) => {
    // Clean up image files before deleting the conversation
    // (Prisma cascade will handle DB records, but we need to delete files)
    await getImageService().deleteConversationImages(id)
    return conversationService.delete(id)
  }, moderateLimiter))

  // Messages
  ipcMain.handle('db:messages:list', secureHandler(async (_, conversationId: string) => {
    return messageService.list(conversationId)
  }, moderateLimiter))

  ipcMain.handle('db:messages:create', secureHandler(async (_, data: CreateMessageInput) => {
    return messageService.create(data)
  }, moderateLimiter))

  ipcMain.handle('db:messages:update', secureHandler(async (_, id: string, data: UpdateMessageInput) => {
    return messageService.update(id, data)
  }, moderateLimiter))

  // Tool Calls
  ipcMain.handle('db:toolCalls:create', secureHandler(async (_, data: CreateToolCallInput) => {
    return messageService.createToolCall(data)
  }, moderateLimiter))

  ipcMain.handle('db:toolCalls:update', secureHandler(async (_, id: string, data: UpdateToolCallInput) => {
    return messageService.updateToolCall(id, data)
  }, moderateLimiter))

  // Skills
  ipcMain.handle('db:skills:list', secureHandler(async () => {
    return skillService.list()
  }, moderateLimiter))

  ipcMain.handle('db:skills:listEnabled', secureHandler(async () => {
    return skillService.listEnabled()
  }, moderateLimiter))

  ipcMain.handle('db:skills:create', secureHandler(async (_, data: CreateSkillInput) => {
    return skillService.create(data)
  }, moderateLimiter))

  ipcMain.handle('db:skills:update', secureHandler(async (_, id: string, data: UpdateSkillInput) => {
    return skillService.update(id, data)
  }, moderateLimiter))

  ipcMain.handle('db:skills:delete', secureHandler(async (_, id: string) => {
    return skillService.delete(id)
  }, moderateLimiter))
}
