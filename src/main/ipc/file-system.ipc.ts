import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir, stat, access, realpath } from 'fs/promises'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import fg from 'fast-glob'
import { secureHandler, createRateLimiter } from './ipc-security'
import { getPermissionService } from '../database'
import { processTracker } from '../services/process-tracker'
import { redactCredentials } from '../services/credential-scanner'
import { scanForInjection } from '../services/injection-scanner'
import { workspaceService } from '../services/workspace.service'
import { auditLogService } from '../services/audit-log.service'
import {
  validateArgs,
  fsPathSchema,
  fsWriteFileSchema,
  fsBashSchema,
  fsGlobSchema,
  fsGrepSchema
} from './ipc-validation'

// Sensitive paths that should never be accessed
const SENSITIVE_PATHS = [
  '/.ssh/', '/.aws/', '/.gnupg/', '/.config/gcloud/',
  '/etc/shadow', '/etc/passwd', '/etc/sudoers',
  '/.keychain/', '/.credential', '/.netrc',
  '/dev.db', '/.prisma/', '/open-cowork.db',
]

// Max file sizes
const MAX_READ_SIZE = 50 * 1024 * 1024  // 50MB
const MAX_WRITE_SIZE = 50 * 1024 * 1024  // 50MB
const MAX_GLOB_RESULTS = 1000
const MAX_GREP_RESULTS = 500

// Validate and normalize a file path
async function validatePath(inputPath: string): Promise<string> {
  // Normalize the path
  const normalized = resolve(inputPath)

  // Resolve symlinks to get the real path
  let realPath: string
  try {
    realPath = await realpath(normalized)
  } catch {
    // File may not exist yet (for writes), use normalized path
    realPath = normalized
  }

  // Check against sensitive paths
  const lowerPath = realPath.toLowerCase()
  for (const sensitive of SENSITIVE_PATHS) {
    if (lowerPath.includes(sensitive.toLowerCase())) {
      throw new Error(`Access denied: path matches restricted pattern`)
    }
  }

  return realPath
}

// Check file size before reading
async function checkFileSize(filePath: string, maxSize: number): Promise<void> {
  const fileStat = await stat(filePath)
  if (fileStat.size > maxSize) {
    throw new Error(`File too large: ${(fileStat.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${(maxSize / 1024 / 1024).toFixed(0)}MB`)
  }
}

// Allowlist of permitted executables for bash commands
const ALLOWED_EXECUTABLES = [
  'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'find', 'grep', 'sed',
  'echo', 'pwd', 'whoami', 'date', 'which', 'file', 'diff', 'git',
  'npm', 'pnpm', 'tar', 'gzip',
  'gunzip', 'zip', 'unzip', 'mkdir', 'cp', 'mv', 'touch', 'chmod', 'tee', 'xargs'
]

// Arguments that allow specific executables to bypass the allowlist (matched per-token)
const BLOCKED_ARGUMENTS: Record<string, RegExp[]> = {
  find: [/^-exec$/, /^-execdir$/, /^-delete$/],
  sed: [/\/e['"]?$/, /\/e\b/],
  git: [/^-c$/],
  npm: [/^exec$/, /^run-script$/],
  pnpm: [/^exec$/, /^dlx$/]
}

export function registerFileSystemHandlers(): void {
  // Rate limiters
  const moderateLimiter = createRateLimiter(60, 60000) // 60 calls per minute
  const expensiveLimiter = createRateLimiter(10, 60000) // 10 calls per minute

  ipcMain.handle('fs:readFile', secureHandler(async (_, path: unknown) => {
    const checkedPath = validateArgs(fsPathSchema, path)
    const validPath = await validatePath(checkedPath)
    await workspaceService.validateWorkspacePath(validPath)
    await checkFileSize(validPath, MAX_READ_SIZE)
    const content = await readFile(validPath, 'utf-8')
    const scanResult = scanForInjection(content, validPath)
    if (scanResult.hasInjection) {
      console.warn(`[injection-scanner] Detected patterns in ${validPath}: ${scanResult.patterns.join(', ')}`)
      return redactCredentials(scanResult.sanitized)
    }
    return redactCredentials(content)
  }, moderateLimiter))

  // Read file as base64 (for binary files like images)
  ipcMain.handle('fs:readFileBase64', secureHandler(async (_, path: unknown) => {
    const checkedPath = validateArgs(fsPathSchema, path)
    const validPath = await validatePath(checkedPath)
    await workspaceService.validateWorkspacePath(validPath)
    await checkFileSize(validPath, MAX_READ_SIZE)
    const buffer = await readFile(validPath)
    const base64 = buffer.toString('base64')

    // Determine MIME type from extension
    const ext = validPath.split('.').pop()?.toLowerCase() || ''
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      pdf: 'application/pdf'
    }
    const mimeType = mimeTypes[ext] || 'application/octet-stream'

    return {
      base64,
      mimeType,
      dataUrl: `data:${mimeType};base64,${base64}`
    }
  }, moderateLimiter))

  ipcMain.handle('fs:writeFile', secureHandler(async (_, path: unknown, content: unknown) => {
    const validated = validateArgs(fsWriteFileSchema, { path, content })
    const validPath = await validatePath(validated.path)
    await workspaceService.validateWorkspacePath(validPath)
    const permissionService = getPermissionService()
    const perm = await permissionService.check(validPath, 'fs:writeFile')
    if (!perm) {
      throw new Error(`Permission denied: fs:writeFile on ${validPath}`)
    }
    if (validated.content.length > MAX_WRITE_SIZE) {
      throw new Error(`Content too large: exceeds ${(MAX_WRITE_SIZE / 1024 / 1024).toFixed(0)}MB write limit`)
    }
    await writeFile(validPath, validated.content, 'utf-8')
    auditLogService?.log({
      actor: 'agent',
      action: 'file:write',
      target: validPath,
      result: 'success'
    })
  }, moderateLimiter))

  ipcMain.handle('fs:readDirectory', secureHandler(async (_, path: unknown) => {
    const checkedPath = validateArgs(fsPathSchema, path)
    const validPath = await validatePath(checkedPath)
    await workspaceService.validateWorkspacePath(validPath)
    const entries = await readdir(validPath, { withFileTypes: true })
    const results = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(validPath, entry.name)
        const stats = await stat(fullPath).catch(() => null)
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats?.size,
          modifiedAt: stats?.mtime
        }
      })
    )
    return results
  }, moderateLimiter))

  ipcMain.handle('fs:exists', secureHandler(async (_, path: unknown) => {
    try {
      const checkedPath = validateArgs(fsPathSchema, path)
      const validPath = await validatePath(checkedPath)
      await access(validPath)
      return true
    } catch {
      return false
    }
  }))

  // Glob - find files matching a pattern
  ipcMain.handle('fs:glob', secureHandler(async (_, pattern: unknown, cwd?: unknown) => {
    const validated = validateArgs(fsGlobSchema, { pattern, cwd })
    const basePath = validated.cwd ? await validatePath(validated.cwd) : process.cwd()
    await workspaceService.validateWorkspacePath(basePath)

    // Block patterns that start at filesystem root
    if (validated.pattern.startsWith('/') || validated.pattern.startsWith('/*')) {
      throw new Error('Glob patterns starting at filesystem root are not allowed')
    }

    const matches = await fg(validated.pattern, {
      cwd: basePath,
      onlyFiles: false,
      dot: false,
      absolute: true,
      stats: true,
      suppressErrors: true,
    })

    // Enforce result limit
    const limited = matches.slice(0, MAX_GLOB_RESULTS)

    return limited.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.stats?.isDirectory() || false,
      size: entry.stats?.size,
      modifiedAt: entry.stats?.mtime,
      ...(matches.length > MAX_GLOB_RESULTS ? { truncated: true, totalMatches: matches.length } : {})
    }))
  }, expensiveLimiter))

  // Grep - search file contents for a pattern
  ipcMain.handle('fs:grep', secureHandler(async (_, pattern: unknown, searchPath: unknown, options?: unknown) => {
    const validated = validateArgs(fsGrepSchema, { pattern, searchPath, options })
    const maxResults = Math.min(validated.options?.maxResults || 100, MAX_GREP_RESULTS)
    const results: Array<{
      file: string
      line: number
      content: string
      match: string
    }> = []

    // Get all text files in the path
    const resolvedPath = resolve(validated.searchPath)

    // Validate the search path
    const validSearchPath = await validatePath(resolvedPath)
    await workspaceService.validateWorkspacePath(validSearchPath)

    const pathStat = await stat(validSearchPath).catch(() => null)

    if (!pathStat) {
      throw new Error(`Path not found: ${validated.searchPath}`)
    }

    // Build regex from pattern (escape special chars for literal search)
    let regex: RegExp
    try {
      regex = new RegExp(validated.pattern, 'gi')
    } catch {
      // If invalid regex, escape and treat as literal
      const escaped = validated.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(escaped, 'gi')
    }

    // Get files to search
    let filesToSearch: string[] = []
    if (pathStat.isDirectory()) {
      // Find all text files in directory (returns strings when stats is false)
      filesToSearch = await fg(['**/*'], {
        cwd: validSearchPath,
        onlyFiles: true,
        absolute: true,
        dot: false,
        suppressErrors: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/*.min.js',
          '**/*.map'
        ]
      })
    } else {
      filesToSearch = [validSearchPath]
    }

    // Search each file
    for (const filePath of filesToSearch) {
      if (results.length >= maxResults) break

      try {
        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break

          const line = lines[i]
          const matches = line.match(regex)
          if (matches) {
            results.push({
              file: filePath,
              line: i + 1,
              content: line.trim().substring(0, 200), // Limit line length
              match: matches[0]
            })
          }
        }
      } catch {
        // Skip files that can't be read (binary, permissions, etc.)
      }
    }

    return results
  }, expensiveLimiter))

  // Bash - execute shell commands (with allowlist validation)
  ipcMain.handle('fs:bash', secureHandler(async (_, command: unknown, options?: unknown) => {
    const validated = validateArgs(fsBashSchema, { command, ...(options != null && typeof options === 'object' ? options : {}) })
    const timeout = validated.timeout || 30000 // 30 second default timeout

    // Validate CWD against sensitive paths and workspace boundary, then check it exists and is a directory
    const cwd = validated.cwd ? await validatePath(validated.cwd) : process.cwd()
    await workspaceService.validateWorkspacePath(cwd)
    try {
      const cwdStat = await stat(cwd)
      if (!cwdStat.isDirectory()) {
        throw new Error(`CWD is not a directory: ${cwd}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CWD is not')) throw error
      throw new Error(`Invalid CWD: ${cwd} - ${error instanceof Error ? error.message : 'does not exist'}`)
    }

    const permissionService = getPermissionService()
    const perm = await permissionService.check(cwd, 'fs:bash')
    if (!perm) {
      throw new Error(`Permission denied: fs:bash in ${cwd}`)
    }

    // Block command substitution — cannot be statically validated
    if (/\$\(/.test(validated.command) || /`/.test(validated.command)) {
      throw new Error(
        'Command blocked for security: command substitution ($() and backticks) is not allowed'
      )
    }

    // Split on all pipeline/chain/sequence operators and validate every command
    const segments = validated.command.trim().split(/\s*(?:\|{1,2}|&&|;)\s*/)
    if (segments.length === 0 || segments.every((s) => !s.trim())) {
      throw new Error('Invalid command: empty or malformed')
    }

    for (const segment of segments) {
      const trimmed = segment.trim()
      if (!trimmed) continue

      // Strip leading env var assignments (e.g. FOO=bar cmd)
      const withoutEnvVars = trimmed.replace(/^(\S+=\S*\s+)*/, '')
      const programMatch = withoutEnvVars.match(/^\s*(\S+)/)
      if (!programMatch) continue

      // Extract the program name (handle full paths like /usr/bin/ls)
      const programPath = programMatch[1]
      const programName = programPath.split('/').pop() || programPath

      // Validate against allowlist
      if (!ALLOWED_EXECUTABLES.includes(programName)) {
        throw new Error(
          `Command blocked for security: "${programName}" is not in the allowlist. ` +
          `Allowed executables: ${ALLOWED_EXECUTABLES.join(', ')}`
        )
      }

      // Check for blocked arguments on specific executables
      const blockedPatterns = BLOCKED_ARGUMENTS[programName]
      if (blockedPatterns) {
        const args = withoutEnvVars.substring(programMatch[0].length).trim()
        const argTokens = args.split(/\s+/).filter(Boolean)
        for (const pattern of blockedPatterns) {
          for (const token of argTokens) {
            if (pattern.test(token)) {
              throw new Error(
                `Command blocked for security: "${programName}" with blocked argument pattern. ` +
                `This argument combination is not allowed.`
              )
            }
          }
        }
      }
    }

    // Use spawn with sh -c after full pipeline validation
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', validated.command], {
        cwd,
        shell: false, // We're explicitly using sh, no need for additional shell
        timeout,
        detached: process.platform !== 'win32' // Own process group for POSIX group kill
      })

      // Track the child process so killAll can terminate it on abort
      if (child.pid) {
        processTracker.track(child.pid, validated.command)
      }

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        if (child.pid) processTracker.untrack(child.pid)
        reject(new Error(`Failed to execute command: ${error.message}`))
      })

      child.on('close', (code) => {
        if (child.pid) processTracker.untrack(child.pid)
        auditLogService?.log({
          actor: 'agent',
          action: 'tool:bash',
          target: validated.command,
          result: code === 0 ? 'success' : 'error',
          details: { cwd, exitCode: code || 0 }
        })
        resolve({
          stdout: redactCredentials(stdout || ''),
          stderr: redactCredentials(stderr || ''),
          exitCode: code || 0
        })
      })

      // Handle timeout
      const timeoutId = setTimeout(() => {
        child.kill()
        reject(new Error(`Command timed out after ${timeout / 1000} seconds`))
      }, timeout)

      child.on('exit', () => {
        clearTimeout(timeoutId)
      })
    })
  }, expensiveLimiter))

  // Kill all tracked child processes (used when user aborts)
  ipcMain.handle('process:killAll', secureHandler(async () => {
    return processTracker.killAll()
  }))

  // Dialog handlers
  ipcMain.handle('dialog:open', secureHandler(async (_, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options)
  }))

  ipcMain.handle('dialog:save', secureHandler(async (_, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(options)
  }))
}
