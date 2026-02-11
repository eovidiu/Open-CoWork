import { ipcMain, safeStorage, app } from 'electron'
import { getDatabase } from '../database'
import {
  createSettingsService,
  type SecureStorageBackend
} from '../services/settings.service'
import type { UpdateSettingsInput } from '../../shared/types'
import { secureHandler } from './ipc-security'

// Electron-specific secure storage implementation
function createElectronSecureStorage(): SecureStorageBackend {
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
      await fs.writeFile(keyPath, encrypted)
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
  ipcMain.handle('settings:getApiKey', secureHandler(async () => {
    return settingsService.getApiKey()
  }))

  ipcMain.handle('settings:setApiKey', secureHandler(async (_, key: string) => {
    return settingsService.setApiKey(key)
  }))

  ipcMain.handle('settings:deleteApiKey', secureHandler(async () => {
    return settingsService.deleteApiKey()
  }))

  // App paths
  ipcMain.handle('app:getPath', secureHandler(async () => {
    return app.getPath('userData')
  }))

  ipcMain.handle('app:getHomePath', secureHandler(async () => {
    return app.getPath('home')
  }))
}
