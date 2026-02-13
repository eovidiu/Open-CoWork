import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir, stat, access } from 'fs/promises'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import fg from 'fast-glob'

// Allowlist of permitted executables for bash commands
const ALLOWED_EXECUTABLES = [
  'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'find', 'grep', 'awk', 'sed',
  'echo', 'pwd', 'whoami', 'date', 'which', 'file', 'diff', 'git', 'node', 'npm',
  'npx', 'pnpm', 'python', 'python3', 'pip', 'pip3', 'curl', 'wget', 'tar', 'gzip',
  'gunzip', 'zip', 'unzip', 'mkdir', 'cp', 'mv', 'touch', 'chmod', 'tee', 'xargs',
  'env', 'sh', 'bash', 'zsh'
]

export function registerFileSystemHandlers(): void {
  ipcMain.handle('fs:readFile', async (_, path: string) => {
    const content = await readFile(path, 'utf-8')
    return content
  })

  // Read file as base64 (for binary files like images)
  ipcMain.handle('fs:readFileBase64', async (_, path: string) => {
    const buffer = await readFile(path)
    const base64 = buffer.toString('base64')

    // Determine MIME type from extension
    const ext = path.split('.').pop()?.toLowerCase() || ''
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
  })

  ipcMain.handle('fs:writeFile', async (_, path: string, content: string) => {
    await writeFile(path, content, 'utf-8')
  })

  ipcMain.handle('fs:readDirectory', async (_, path: string) => {
    const entries = await readdir(path, { withFileTypes: true })
    const results = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(path, entry.name)
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
  })

  ipcMain.handle('fs:exists', async (_, path: string) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

  // Glob - find files matching a pattern
  ipcMain.handle('fs:glob', async (_, pattern: string, cwd?: string) => {
    const basePath = cwd || process.cwd()
    const matches = await fg(pattern, {
      cwd: basePath,
      onlyFiles: false,
      dot: false, // Skip hidden files by default
      absolute: true,
      stats: true,
      suppressErrors: true
    })

    return matches.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.stats?.isDirectory() || false,
      size: entry.stats?.size,
      modifiedAt: entry.stats?.mtime
    }))
  })

  // Grep - search file contents for a pattern
  ipcMain.handle('fs:grep', async (_, pattern: string, searchPath: string, options?: { maxResults?: number }) => {
    const maxResults = options?.maxResults || 100
    const results: Array<{
      file: string
      line: number
      content: string
      match: string
    }> = []

    // Get all text files in the path
    const resolvedPath = resolve(searchPath)
    const pathStat = await stat(resolvedPath).catch(() => null)

    if (!pathStat) {
      throw new Error(`Path not found: ${searchPath}`)
    }

    // Build regex from pattern (escape special chars for literal search)
    let regex: RegExp
    try {
      regex = new RegExp(pattern, 'gi')
    } catch {
      // If invalid regex, escape and treat as literal
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(escaped, 'gi')
    }

    // Get files to search
    let filesToSearch: string[] = []
    if (pathStat.isDirectory()) {
      // Find all text files in directory (returns strings when stats is false)
      filesToSearch = await fg(['**/*'], {
        cwd: resolvedPath,
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
      filesToSearch = [resolvedPath]
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
  })

  // Bash - execute shell commands (with allowlist validation)
  ipcMain.handle('fs:bash', async (_, command: string, options?: { cwd?: string; timeout?: number }) => {
    const cwd = options?.cwd || process.cwd()
    const timeout = options?.timeout || 30000 // 30 second default timeout

    // Validate CWD exists and is a directory
    try {
      const cwdStat = await stat(cwd)
      if (!cwdStat.isDirectory()) {
        throw new Error(`CWD is not a directory: ${cwd}`)
      }
    } catch (error) {
      throw new Error(`Invalid CWD: ${cwd} - ${error instanceof Error ? error.message : 'does not exist'}`)
    }

    // Block command substitution — cannot be statically validated
    if (/\$\(/.test(command) || /`/.test(command)) {
      throw new Error(
        'Command blocked for security: command substitution ($() and backticks) is not allowed'
      )
    }

    // Split on all pipeline/chain/sequence operators and validate every command
    const segments = command.trim().split(/\s*(?:\|{1,2}|&&|;)\s*/)
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
    }

    // Use spawn with sh -c after full pipeline validation
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd,
        shell: false, // We're explicitly using sh, no need for additional shell
        timeout
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`))
      })

      child.on('close', (code) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
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
  })

  // Dialog handlers
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options)
  })

  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(options)
  })
}
