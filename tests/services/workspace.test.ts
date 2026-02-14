import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resolve } from 'path'
import { tmpdir } from 'os'

// Mock fs/promises.realpath so we can control symlink resolution
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    realpath: vi.fn(async (p: string) => p)
  }
})

import { createWorkspaceService } from '../../src/main/services/workspace.service'
import { realpath } from 'fs/promises'

const mockedRealpath = vi.mocked(realpath)

describe('WorkspaceService', () => {
  let service: ReturnType<typeof createWorkspaceService>

  beforeEach(() => {
    service = createWorkspaceService()
    mockedRealpath.mockImplementation(async (p: string) => p as string)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setWorkspaceRoot / getWorkspaceRoot / clearWorkspaceRoot', () => {
    it('should return null when no workspace root is set', () => {
      expect(service.getWorkspaceRoot()).toBeNull()
    })

    it('should set and return the workspace root', () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(service.getWorkspaceRoot()).toBe(resolve('/Users/dev/project'))
    })

    it('should resolve the workspace root to an absolute path', () => {
      service.setWorkspaceRoot('/Users/dev/../dev/project')
      expect(service.getWorkspaceRoot()).toBe(resolve('/Users/dev/project'))
    })

    it('should clear the workspace root', () => {
      service.setWorkspaceRoot('/Users/dev/project')
      service.clearWorkspaceRoot()
      expect(service.getWorkspaceRoot()).toBeNull()
    })

    it('should allow overwriting the workspace root', () => {
      service.setWorkspaceRoot('/Users/dev/project-a')
      service.setWorkspaceRoot('/Users/dev/project-b')
      expect(service.getWorkspaceRoot()).toBe(resolve('/Users/dev/project-b'))
    })
  })

  describe('isWithinWorkspace', () => {
    it('should allow all paths when no workspace root is set (permissive mode)', async () => {
      expect(await service.isWithinWorkspace('/any/random/path')).toBe(true)
      expect(await service.isWithinWorkspace('/etc/something')).toBe(true)
      expect(await service.isWithinWorkspace('/Users/dev/secret')).toBe(true)
    })

    it('should allow paths within the workspace root', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/Users/dev/project/src/main.ts')).toBe(true)
      expect(await service.isWithinWorkspace('/Users/dev/project/package.json')).toBe(true)
    })

    it('should allow the workspace root itself', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/Users/dev/project')).toBe(true)
    })

    it('should allow the workspace root with trailing slash', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/Users/dev/project/')).toBe(true)
    })

    it('should reject paths outside the workspace root', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/Users/dev/other-project/file.ts')).toBe(false)
      expect(await service.isWithinWorkspace('/Users/dev/projectx/file.ts')).toBe(false)
    })

    it('should reject parent directory traversal', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/Users/dev/project/../other/file.ts')).toBe(false)
    })

    it('should allow paths in /tmp/ (global exception)', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/tmp/some-temp-file')).toBe(true)
    })

    it('should allow paths in /var/folders/ (macOS temp, global exception)', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace('/var/folders/xx/yy/T/temp-file')).toBe(true)
    })

    it('should allow paths in HOME/.config/ (global exception)', async () => {
      const home = process.env.HOME
      if (!home) return // skip on environments without HOME
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace(`${home}/.config/some-app/config.json`)).toBe(true)
    })

    it('should allow paths in HOME/Downloads/ (global exception)', async () => {
      const home = process.env.HOME
      if (!home) return
      service.setWorkspaceRoot('/Users/dev/project')
      expect(await service.isWithinWorkspace(`${home}/Downloads/file.pdf`)).toBe(true)
    })

    it('should reject symlinks that resolve outside the workspace', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      // The path looks like it's in the workspace, but realpath resolves it outside
      mockedRealpath.mockResolvedValueOnce('/Users/dev/secret-repo/stolen.txt')
      expect(await service.isWithinWorkspace('/Users/dev/project/link-to-secret')).toBe(false)
    })

    it('should allow symlinks that resolve within the workspace', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      mockedRealpath.mockResolvedValueOnce('/Users/dev/project/actual/file.ts')
      expect(await service.isWithinWorkspace('/Users/dev/project/symlinked-file')).toBe(true)
    })

    it('should use the normalized path when realpath fails (file does not exist)', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      mockedRealpath.mockRejectedValueOnce(new Error('ENOENT'))
      // Path is within workspace, realpath fails, falls back to normalized path
      expect(await service.isWithinWorkspace('/Users/dev/project/new-file.ts')).toBe(true)
    })

    it('should use the normalized path when realpath fails and reject if outside', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      mockedRealpath.mockRejectedValueOnce(new Error('ENOENT'))
      expect(await service.isWithinWorkspace('/Users/dev/other/new-file.ts')).toBe(false)
    })

    it('should not be confused by prefix-matching paths', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      // /Users/dev/project-evil is NOT inside /Users/dev/project
      expect(await service.isWithinWorkspace('/Users/dev/project-evil/malware.ts')).toBe(false)
    })
  })

  describe('validateWorkspacePath', () => {
    it('should not throw when no workspace root is set', async () => {
      await expect(service.validateWorkspacePath('/any/path')).resolves.not.toThrow()
    })

    it('should not throw for paths inside workspace', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      await expect(
        service.validateWorkspacePath('/Users/dev/project/src/file.ts')
      ).resolves.not.toThrow()
    })

    it('should throw for paths outside workspace', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      await expect(
        service.validateWorkspacePath('/Users/dev/other/file.ts')
      ).rejects.toThrow('Access denied: path is outside the workspace boundary')
    })

    it('should not throw for global exception paths', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      await expect(service.validateWorkspacePath('/tmp/temp-file')).resolves.not.toThrow()
    })

    it('should throw with informative error message including the path', async () => {
      service.setWorkspaceRoot('/Users/dev/project')
      await expect(
        service.validateWorkspacePath('/Users/dev/other/secret.txt')
      ).rejects.toThrow(/outside the workspace boundary/)
    })
  })

  describe('edge cases', () => {
    it('should handle root as workspace', async () => {
      service.setWorkspaceRoot('/')
      expect(await service.isWithinWorkspace('/any/path/at/all')).toBe(true)
    })

    it('should handle nested workspace paths', async () => {
      service.setWorkspaceRoot('/Users/dev/project/packages/core')
      expect(await service.isWithinWorkspace('/Users/dev/project/packages/core/src/index.ts')).toBe(true)
      expect(await service.isWithinWorkspace('/Users/dev/project/packages/other/src/index.ts')).toBe(false)
    })

    it('should handle paths with trailing separators consistently', async () => {
      service.setWorkspaceRoot('/Users/dev/project/')
      expect(await service.isWithinWorkspace('/Users/dev/project/file.ts')).toBe(true)
      expect(await service.isWithinWorkspace('/Users/dev/project')).toBe(true)
    })

    it('should handle case sensitivity (unix paths are case-sensitive)', async () => {
      service.setWorkspaceRoot('/Users/dev/Project')
      // On a case-sensitive filesystem, these are different paths
      // We test the logical behavior: the service should do exact prefix matching
      expect(await service.isWithinWorkspace('/Users/dev/Project/file.ts')).toBe(true)
      // /Users/dev/project is NOT the same as /Users/dev/Project on case-sensitive FS
      expect(await service.isWithinWorkspace('/Users/dev/project/file.ts')).toBe(false)
    })
  })
})
