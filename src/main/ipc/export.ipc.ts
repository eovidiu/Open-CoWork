import { ipcMain, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import { getDatabase } from '../database'
import { createConversationService } from '../services/conversation.service'
import { createExportService } from '../services/export.service'
import { secureHandler } from './ipc-security'

// Sensitive paths that should never be written to
const SENSITIVE_PATHS = [
  '/.ssh/', '/.aws/', '/.gnupg/', '/.config/gcloud/',
  '/etc/', '/.keychain/', '/.credential', '/.netrc',
  '/dev.db', '/.prisma/',
]

/**
 * Validates that the export path is not in a sensitive directory.
 * Defense-in-depth: the save dialog already constrains choices, but this
 * prevents accidental writes to critical system directories.
 */
function validateExportPath(filePath: string): void {
  const normalized = resolve(filePath).toLowerCase()

  for (const sensitive of SENSITIVE_PATHS) {
    if (normalized.includes(sensitive.toLowerCase())) {
      throw new Error('Cannot export to sensitive system directory')
    }
  }
}

export function registerExportHandlers(): void {
  const prisma = getDatabase()
  const conversationService = createConversationService(prisma)
  const exportService = createExportService()

  ipcMain.handle('export:markdown', secureHandler(async (_, conversationId: string) => {
    // Get the conversation with messages
    const conversation = await conversationService.get(conversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }

    // Convert to markdown
    const markdown = exportService.toMarkdown(conversation)

    // Generate a safe filename from the title
    const safeTitle = conversation.title
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .substring(0, 50)
    const defaultFilename = `${safeTitle}.md`

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export Chat as Markdown',
      defaultPath: defaultFilename,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    // Validate the export path (defense-in-depth)
    validateExportPath(result.filePath)

    // Write the file
    await writeFile(result.filePath, markdown, 'utf-8')

    return { success: true, filePath: result.filePath }
  }))
}
