import { ipcMain } from 'electron'
import { stat } from 'fs/promises'
import { secureHandler } from './ipc-security'
import { workspaceService } from '../services/workspace.service'

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:setRoot', secureHandler(async (_, root: unknown) => {
    if (typeof root !== 'string' || root.trim().length === 0) {
      throw new Error('Workspace root must be a non-empty string')
    }

    // Verify the directory exists and is actually a directory
    const rootStat = await stat(root)
    if (!rootStat.isDirectory()) {
      throw new Error('Workspace root must be a directory')
    }

    workspaceService.setWorkspaceRoot(root)
    return workspaceService.getWorkspaceRoot()
  }))

  ipcMain.handle('workspace:getRoot', secureHandler(async () => {
    return workspaceService.getWorkspaceRoot()
  }))

  ipcMain.handle('workspace:clear', secureHandler(async () => {
    workspaceService.clearWorkspaceRoot()
  }))
}
