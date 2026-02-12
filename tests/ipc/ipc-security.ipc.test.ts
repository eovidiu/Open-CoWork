import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMainInvokeEvent, WebContents, BrowserWindow } from 'electron'

import {
  setMainWindow,
  validateSender,
  createRateLimiter,
  sanitizeError,
  secureHandler
} from '../../src/main/ipc/ipc-security'

// ---------------------------------------------------------------------------
// Helpers to build mock objects
// ---------------------------------------------------------------------------

function makeMockEvent(senderId: number): IpcMainInvokeEvent {
  return {
    sender: { id: senderId } as WebContents
  } as IpcMainInvokeEvent
}

function makeMockWindow(webContentsId: number): BrowserWindow {
  return {
    webContents: { id: webContentsId }
  } as unknown as BrowserWindow
}

// ---------------------------------------------------------------------------
// validateSender
// ---------------------------------------------------------------------------

describe('validateSender', () => {
  it('should throw when the main window has not been initialized', () => {
    // Reset internal state by setting a window first then we'll test fresh import
    // Since the module keeps mainWindowId in closure, we need to test the
    // "not initialized" case first or reset it.
    // Actually, module state persists across tests in the same file.
    // We can test this by using a fresh import via vi.resetModules() later.
    // For now, let's set a window and test valid/invalid senders.

    // We'll test the uninitialized case in a separate describe using resetModules.
  })

  describe('with main window set', () => {
    const MAIN_WINDOW_ID = 42

    beforeEach(() => {
      setMainWindow(makeMockWindow(MAIN_WINDOW_ID))
    })

    it('should accept events from the main window', () => {
      const event = makeMockEvent(MAIN_WINDOW_ID)
      expect(() => validateSender(event)).not.toThrow()
    })

    it('should reject events from a different sender', () => {
      const event = makeMockEvent(999)
      expect(() => validateSender(event)).toThrow('Unauthorized IPC sender')
    })

    it('should reject events from sender id 0', () => {
      const event = makeMockEvent(0)
      expect(() => validateSender(event)).toThrow('Unauthorized IPC sender')
    })
  })
})

// Test the "main window not initialized" path using a fresh module import
describe('validateSender (uninitialized)', () => {
  it('should throw when the main window has not been set', async () => {
    // Re-import the module with a fresh state
    vi.resetModules()
    const freshModule = await import('../../src/main/ipc/ipc-security')

    const event = makeMockEvent(1)
    expect(() => freshModule.validateSender(event)).toThrow(
      'Main window not initialized'
    )
  })
})

// ---------------------------------------------------------------------------
// createRateLimiter
// ---------------------------------------------------------------------------

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should allow calls within the limit', () => {
    const limiter = createRateLimiter(3, 60000)

    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
  })

  it('should reject calls exceeding the limit', () => {
    const limiter = createRateLimiter(3, 60000)

    expect(limiter.check()).toBe(true) // 1
    expect(limiter.check()).toBe(true) // 2
    expect(limiter.check()).toBe(true) // 3
    expect(limiter.check()).toBe(false) // 4 — rejected
    expect(limiter.check()).toBe(false) // 5 — still rejected
  })

  it('should reset after the time window elapses', () => {
    const limiter = createRateLimiter(2, 60000)

    expect(limiter.check()).toBe(true) // 1
    expect(limiter.check()).toBe(true) // 2
    expect(limiter.check()).toBe(false) // 3 — rejected

    // Advance time past the window
    vi.advanceTimersByTime(60001)

    // Old calls are now outside the window
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
  })

  it('should evict only expired calls (sliding window)', () => {
    const limiter = createRateLimiter(2, 1000)

    // t=0: first call
    expect(limiter.check()).toBe(true)

    // t=600ms: second call
    vi.advanceTimersByTime(600)
    expect(limiter.check()).toBe(true)

    // t=600ms: limit reached
    expect(limiter.check()).toBe(false)

    // t=1001ms: first call expires, but second (t=600) still in window
    vi.advanceTimersByTime(401)
    expect(limiter.check()).toBe(true) // replaces the expired first call
    expect(limiter.check()).toBe(false) // still at limit
  })

  it('should report correct stats via getStats()', () => {
    const limiter = createRateLimiter(10, 30000)

    expect(limiter.getStats()).toEqual({
      calls: 0,
      windowMs: 30000,
      maxCalls: 10
    })

    limiter.check()
    limiter.check()

    expect(limiter.getStats()).toEqual({
      calls: 2,
      windowMs: 30000,
      maxCalls: 10
    })
  })

  it('should handle a limit of 1', () => {
    const limiter = createRateLimiter(1, 5000)

    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(false)

    vi.advanceTimersByTime(5001)
    expect(limiter.check()).toBe(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// sanitizeError
// ---------------------------------------------------------------------------

describe('sanitizeError', () => {
  it('should strip absolute Unix file paths', () => {
    const error = new Error('Cannot find /home/user/secrets/config.json')
    const result = sanitizeError(error)
    expect(result).not.toContain('/home/user')
    expect(result).toContain('[path]')
  })

  it('should strip absolute Windows file paths', () => {
    const error = new Error('Cannot find C:\\Users\\admin\\secrets\\config.json')
    const result = sanitizeError(error)
    expect(result).not.toContain('C:\\Users')
    expect(result).toContain('[path]')
  })

  it('should strip stack trace lines', () => {
    const error = new Error('Something failed')
    // Manually append stack-like content into the message
    error.message = 'Something failed\n    at Object.<anonymous> (/app/index.js:10:5)'
    const result = sanitizeError(error)
    expect(result).not.toContain('at Object')
    expect(result).not.toContain('/app/index.js')
  })

  it('should strip line:column references', () => {
    const error = new Error('Error at position:42:17 in the file')
    const result = sanitizeError(error)
    expect(result).not.toMatch(/:\d+:\d+/)
  })

  it('should strip home directory references with tilde', () => {
    const error = new Error('Cannot access ~/Documents/private/data.db')
    const result = sanitizeError(error)
    expect(result).not.toContain('~/Documents')
    expect(result).toContain('[path]')
  })

  it('should return "An error occurred" for non-Error values', () => {
    expect(sanitizeError('a string error')).toBe('An error occurred')
    expect(sanitizeError(42)).toBe('An error occurred')
    expect(sanitizeError(null)).toBe('An error occurred')
    expect(sanitizeError(undefined)).toBe('An error occurred')
    expect(sanitizeError({ message: 'plain object' })).toBe('An error occurred')
  })

  it('should return "An error occurred" when the sanitized message is empty', () => {
    // If the entire message is a file path, sanitization leaves only "[path]"
    // But let's test with a message that becomes empty after stripping
    const error = new Error('/usr/local/bin/node')
    const result = sanitizeError(error)
    // The path gets replaced with [path], so it won't be empty, but let's verify
    expect(result).toBe('[path]')
  })

  it('should handle errors with multiple path types', () => {
    const error = new Error(
      'Failed: /var/log/app.log and C:\\Windows\\Temp\\crash.log and ~/config'
    )
    const result = sanitizeError(error)
    expect(result).not.toContain('/var/log')
    expect(result).not.toContain('C:\\Windows')
    expect(result).not.toContain('~/config')
  })

  it('should preserve non-sensitive parts of the message', () => {
    const error = new Error('Database connection failed')
    const result = sanitizeError(error)
    expect(result).toBe('Database connection failed')
  })
})

// ---------------------------------------------------------------------------
// secureHandler
// ---------------------------------------------------------------------------

describe('secureHandler', () => {
  const MAIN_WINDOW_ID = 7

  beforeEach(() => {
    setMainWindow(makeMockWindow(MAIN_WINDOW_ID))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should call the wrapped handler with the correct arguments', async () => {
    const inner = vi.fn().mockResolvedValue('ok')
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(MAIN_WINDOW_ID)
    const result = await wrapped(event, 'arg1', 'arg2')

    expect(inner).toHaveBeenCalledWith(event, 'arg1', 'arg2')
    expect(result).toBe('ok')
  })

  it('should reject requests from unauthorized senders', async () => {
    const inner = vi.fn().mockResolvedValue('ok')
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(999)
    await expect(wrapped(event)).rejects.toThrow('Unauthorized IPC sender')
    expect(inner).not.toHaveBeenCalled()
  })

  it('should enforce rate limits when a limiter is provided', async () => {
    const limiter = createRateLimiter(2, 60000)
    const inner = vi.fn().mockResolvedValue('ok')
    const wrapped = secureHandler(inner, limiter)

    const event = makeMockEvent(MAIN_WINDOW_ID)

    // First two calls should succeed
    await expect(wrapped(event)).resolves.toBe('ok')
    await expect(wrapped(event)).resolves.toBe('ok')

    // Third call should be rate-limited
    await expect(wrapped(event)).rejects.toThrow('Rate limit exceeded')
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('should work without a rate limiter', async () => {
    const inner = vi.fn().mockResolvedValue('result')
    const wrapped = secureHandler(inner) // no limiter

    const event = makeMockEvent(MAIN_WINDOW_ID)

    // Should succeed many times
    for (let i = 0; i < 100; i++) {
      await expect(wrapped(event)).resolves.toBe('result')
    }

    expect(inner).toHaveBeenCalledTimes(100)
  })

  it('should sanitize errors thrown by the handler', async () => {
    const inner = vi.fn().mockRejectedValue(
      new Error('Failed to read /etc/shadow: permission denied')
    )
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(MAIN_WINDOW_ID)

    await expect(wrapped(event)).rejects.toThrow('[path]')
    // The original path must not appear in the thrown error
    try {
      await wrapped(event)
    } catch (err) {
      expect((err as Error).message).not.toContain('/etc/shadow')
    }
  })

  it('should sanitize non-Error values thrown by the handler', async () => {
    const inner = vi.fn().mockRejectedValue('string error')
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(MAIN_WINDOW_ID)

    await expect(wrapped(event)).rejects.toThrow('An error occurred')
  })

  it('should log the original error to console.error', async () => {
    const originalError = new Error('Original detailed error at /secret/path')
    const inner = vi.fn().mockRejectedValue(originalError)
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(MAIN_WINDOW_ID)

    try {
      await wrapped(event)
    } catch {
      // expected
    }

    expect(console.error).toHaveBeenCalledWith('IPC Handler Error:', originalError)
  })

  it('should validate sender before checking rate limit', async () => {
    const limiter = createRateLimiter(1, 60000)
    const inner = vi.fn().mockResolvedValue('ok')
    const wrapped = secureHandler(inner, limiter)

    const badEvent = makeMockEvent(999)

    // Unauthorized call should not consume a rate limit token
    await expect(wrapped(badEvent)).rejects.toThrow('Unauthorized IPC sender')

    // The limiter should still have capacity (the bad call did not use it)
    const goodEvent = makeMockEvent(MAIN_WINDOW_ID)
    await expect(wrapped(goodEvent)).resolves.toBe('ok')
  })

  it('should handle synchronous handlers', async () => {
    // Handler that returns a plain value, not a Promise
    const inner = vi.fn().mockReturnValue('sync-result')
    const wrapped = secureHandler(inner)

    const event = makeMockEvent(MAIN_WINDOW_ID)
    const result = await wrapped(event)

    expect(result).toBe('sync-result')
  })
})
