import { resolve } from 'path'
import { realpath } from 'fs/promises'

const GLOBAL_EXCEPTIONS: string[] = [
  '/tmp/',
  '/var/folders/',
  ...(process.env.HOME ? [`${process.env.HOME}/.config/`] : []),
  ...(process.env.HOME ? [`${process.env.HOME}/Downloads/`] : [])
]

export function createWorkspaceService() {
  let workspaceRoot: string | null = null

  function setWorkspaceRoot(root: string): void {
    workspaceRoot = resolve(root)
  }

  function getWorkspaceRoot(): string | null {
    return workspaceRoot
  }

  function clearWorkspaceRoot(): void {
    workspaceRoot = null
  }

  function isGlobalException(normalizedPath: string): boolean {
    for (const exception of GLOBAL_EXCEPTIONS) {
      if (normalizedPath.startsWith(exception)) {
        return true
      }
    }
    return false
  }

  function isInsideRoot(normalizedPath: string, root: string): boolean {
    // Exact match (the workspace root itself)
    if (normalizedPath === root) {
      return true
    }
    // Path is a child: must start with root + separator
    // Ensure we don't match /project-evil when root is /project
    const rootWithSep = root.endsWith('/') ? root : root + '/'
    return normalizedPath.startsWith(rootWithSep)
  }

  async function isWithinWorkspace(filePath: string): Promise<boolean> {
    // Permissive mode: no workspace set, everything allowed
    if (workspaceRoot === null) {
      return true
    }

    const normalized = resolve(filePath)

    // Check global exceptions on the normalized path first
    if (isGlobalException(normalized)) {
      return true
    }

    // Resolve symlinks to get the real path
    let resolvedPath: string
    try {
      resolvedPath = await realpath(normalized)
    } catch {
      // File may not exist yet (for writes), use normalized path
      resolvedPath = normalized
    }

    // Check global exceptions on the resolved path too
    if (isGlobalException(resolvedPath)) {
      return true
    }

    return isInsideRoot(resolvedPath, workspaceRoot)
  }

  async function validateWorkspacePath(filePath: string): Promise<void> {
    const allowed = await isWithinWorkspace(filePath)
    if (!allowed) {
      throw new Error(
        `Access denied: path is outside the workspace boundary. ` +
        `Workspace root: ${workspaceRoot}, requested path: ${resolve(filePath)}`
      )
    }
  }

  return {
    setWorkspaceRoot,
    getWorkspaceRoot,
    clearWorkspaceRoot,
    isWithinWorkspace,
    validateWorkspacePath
  }
}

// Singleton instance used across the app
export const workspaceService = createWorkspaceService()

export type WorkspaceService = ReturnType<typeof createWorkspaceService>
