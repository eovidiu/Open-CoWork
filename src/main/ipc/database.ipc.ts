import { ipcMain } from 'electron'
import { getDatabase } from '../database'

export function registerDatabaseHandlers(): void {
  const prisma = getDatabase()

  // Conversations
  ipcMain.handle('db:conversations:list', async () => {
    return prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' }
    })
  })

  ipcMain.handle('db:conversations:get', async (_, id: string) => {
    return prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { toolCalls: true }
        }
      }
    })
  })

  ipcMain.handle('db:conversations:create', async (_, title: string) => {
    return prisma.conversation.create({
      data: { title }
    })
  })

  ipcMain.handle('db:conversations:update', async (_, id: string, data: { title?: string; pinned?: boolean }) => {
    return prisma.conversation.update({
      where: { id },
      data
    })
  })

  ipcMain.handle('db:conversations:delete', async (_, id: string) => {
    return prisma.conversation.delete({
      where: { id }
    })
  })

  // Messages
  ipcMain.handle('db:messages:list', async (_, conversationId: string) => {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { toolCalls: true }
    })
  })

  ipcMain.handle(
    'db:messages:create',
    async (
      _,
      data: {
        conversationId: string
        role: string
        content: string
        thinking?: string
      }
    ) => {
      // Also update conversation's updatedAt
      await prisma.conversation.update({
        where: { id: data.conversationId },
        data: { updatedAt: new Date() }
      })

      return prisma.message.create({
        data,
        include: { toolCalls: true }
      })
    }
  )

  ipcMain.handle(
    'db:messages:update',
    async (_, id: string, data: { content?: string; thinking?: string }) => {
      return prisma.message.update({
        where: { id },
        data,
        include: { toolCalls: true }
      })
    }
  )

  // Tool Calls
  ipcMain.handle(
    'db:toolCalls:create',
    async (
      _,
      data: {
        messageId: string
        toolName: string
        input: string
        output?: string
        status?: string
      }
    ) => {
      return prisma.toolCall.create({
        data: {
          messageId: data.messageId,
          toolName: data.toolName,
          input: data.input,
          output: data.output,
          status: data.status || 'pending'
        }
      })
    }
  )

  ipcMain.handle(
    'db:toolCalls:update',
    async (_, id: string, data: { output?: string; status?: string }) => {
      return prisma.toolCall.update({
        where: { id },
        data
      })
    }
  )

  // Skills
  ipcMain.handle('db:skills:list', async () => {
    return prisma.skill.findMany({
      orderBy: { name: 'asc' }
    })
  })

  ipcMain.handle('db:skills:listEnabled', async () => {
    return prisma.skill.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' }
    })
  })

  ipcMain.handle(
    'db:skills:create',
    async (
      _,
      data: {
        name: string
        description?: string
        content: string
        sourceUrl?: string
      }
    ) => {
      return prisma.skill.create({ data })
    }
  )

  ipcMain.handle(
    'db:skills:update',
    async (_, id: string, data: { enabled?: boolean; content?: string }) => {
      return prisma.skill.update({
        where: { id },
        data
      })
    }
  )

  ipcMain.handle('db:skills:delete', async (_, id: string) => {
    return prisma.skill.delete({
      where: { id }
    })
  })
}
