import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { createPermissionService } from '../services/permission.service'
import { secureHandler } from './ipc-security'

export function registerPermissionHandlers(): void {
  const prisma = getDatabase()
  const permissionService = createPermissionService(prisma)

  ipcMain.handle('permissions:check', secureHandler(async (_, path: string, operation: string) => {
    return permissionService.check(path, operation)
  }))

  ipcMain.handle(
    'permissions:grant',
    secureHandler(async (_, path: string, operation: string, scope: string) => {
      return permissionService.grant(path, operation, scope)
    })
  )

  ipcMain.handle('permissions:revoke', secureHandler(async (_, path: string, operation: string) => {
    return permissionService.revoke(path, operation)
  }))

  ipcMain.handle('permissions:list', secureHandler(async () => {
    return permissionService.list()
  }))

  ipcMain.handle('permissions:clearSession', secureHandler(async () => {
    return permissionService.clearSession()
  }))
}
