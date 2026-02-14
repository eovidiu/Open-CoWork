import { ipcMain } from 'electron'
import { getPermissionService } from '../database'
import { auditLogService } from '../services/audit-log.service'
import { secureHandler } from './ipc-security'

export function registerPermissionHandlers(): void {
  const permissionService = getPermissionService()

  ipcMain.handle('permissions:check', secureHandler(async (_, path: string, operation: string) => {
    return permissionService.check(path, operation)
  }))

  ipcMain.handle(
    'permissions:grant',
    secureHandler(async (_, path: string, operation: string, scope: string) => {
      const result = await permissionService.grant(path, operation, scope)
      auditLogService?.log({
        actor: 'user',
        action: 'permission:grant',
        target: path,
        result: 'success',
        details: { operation, scope }
      })
      return result
    })
  )

  ipcMain.handle('permissions:revoke', secureHandler(async (_, path: string, operation: string) => {
    await permissionService.revoke(path, operation)
    auditLogService?.log({
      actor: 'user',
      action: 'permission:revoke',
      target: path,
      result: 'success',
      details: { operation }
    })
  }))

  ipcMain.handle('permissions:list', secureHandler(async () => {
    return permissionService.list()
  }))

  ipcMain.handle('permissions:clearSession', secureHandler(async () => {
    return permissionService.clearSession()
  }))
}
