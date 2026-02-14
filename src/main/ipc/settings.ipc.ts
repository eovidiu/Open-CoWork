import { ipcMain, safeStorage, app } from 'electron'
import { getDatabase } from '../database'
import {
  createSettingsService,
  type SecureStorageBackend
} from '../services/settings.service'
import type { UpdateSettingsInput } from '../../shared/types'
import { secureHandler } from './ipc-security'
import { validateArgs, settingsApiKeySchema } from './ipc-validation'

// Electron-specific secure storage implementation
export function createElectronSecureStorage(): SecureStorageBackend {
  const getKeyPath = async () => {
    const path = await import('path')
    return path.join(app.getPath('userData'), '.api-key')
  }

  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),

    get: async () => {
      const fs = await import('fs/promises')
      const keyPath = await getKeyPath()

      const exists = await fs
        .access(keyPath)
        .then(() => true)
        .catch(() => false)
      if (!exists) return null

      const encrypted = await fs.readFile(keyPath)
      return safeStorage.decryptString(encrypted)
    },

    set: async (value: string) => {
      const fs = await import('fs/promises')
      const keyPath = await getKeyPath()

      const encrypted = safeStorage.encryptString(value)
      await fs.writeFile(keyPath, encrypted, { mode: 0o600 })
    },

    delete: async () => {
      const fs = await import('fs/promises')
      const keyPath = await getKeyPath()

      await fs.unlink(keyPath).catch(() => {
        // Ignore if file doesn't exist
      })
    }
  }
}

export function registerSettingsHandlers(): void {
  const prisma = getDatabase()
  const secureStorage = createElectronSecureStorage()
  const settingsService = createSettingsService(prisma, secureStorage)

  // Settings from database
  ipcMain.handle('settings:get', secureHandler(async () => {
    return settingsService.get()
  }))

  ipcMain.handle('settings:update', secureHandler(async (_, data: UpdateSettingsInput) => {
    return settingsService.update(data)
  }))

  // Secure storage for API key
  // Note: getApiKey handler removed -- the decrypted key never leaves the main process.
  // The key is injected into OpenRouter requests via session.webRequest.onBeforeSendHeaders.

  ipcMain.handle('settings:setApiKey', secureHandler(async (_, key: unknown) => {
    const checkedKey = validateArgs(settingsApiKeySchema, key)
    // Validate API key format (Zod already ensures non-empty string)
    // OpenRouter keys start with 'sk-or-'
    if (!checkedKey.startsWith('sk-or-') && !checkedKey.startsWith('sk-')) {
      throw new Error('Invalid API key format. OpenRouter keys typically start with "sk-or-"')
    }
    if (checkedKey.length < 20) {
      throw new Error('API key appears too short to be valid')
    }
    return settingsService.setApiKey(checkedKey)
  }))

  ipcMain.handle('settings:deleteApiKey', secureHandler(async () => {
    return settingsService.deleteApiKey()
  }))

  // Check if API key exists without exposing its value
  ipcMain.handle('settings:hasApiKey', secureHandler(async () => {
    const key = await settingsService.getApiKey()
    return !!key
  }))

  // Return masked API key for UI display (avoids exposing full key to renderer)
  ipcMain.handle('settings:getApiKeyMasked', secureHandler(async () => {
    const key = await settingsService.getApiKey()
    if (!key) return null
    return {
      exists: true,
      masked: '••••••••' + key.slice(-4),
      length: key.length
    }
  }))

  // App paths
  ipcMain.handle('app:getPath', secureHandler(async () => {
    return app.getPath('userData')
  }))

  ipcMain.handle('app:getHomePath', secureHandler(async () => {
    return app.getPath('home')
  }))
}
