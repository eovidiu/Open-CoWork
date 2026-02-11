import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

let mainWindowId: number | null = null

/**
 * Set the main window reference for IPC sender validation
 */
export function setMainWindow(win: BrowserWindow): void {
  mainWindowId = win.webContents.id
}

/**
 * Validate that the IPC event sender is the main window
 * Throws an error if validation fails
 */
export function validateSender(event: IpcMainInvokeEvent): void {
  if (mainWindowId === null) {
    throw new Error('Main window not initialized')
  }
  if (event.sender.id !== mainWindowId) {
    throw new Error('Unauthorized IPC sender')
  }
}

/**
 * Rate limiter for IPC channels
 */
interface RateLimiter {
  check(): boolean
  getStats(): { calls: number; windowMs: number; maxCalls: number }
}

/**
 * Create a rate limiter for an IPC channel
 * @param maxCalls Maximum number of calls allowed in the time window
 * @param windowMs Time window in milliseconds
 */
export function createRateLimiter(maxCalls: number, windowMs: number): RateLimiter {
  const calls: number[] = []

  return {
    check(): boolean {
      const now = Date.now()
      // Remove calls outside the time window
      while (calls.length > 0 && calls[0] < now - windowMs) {
        calls.shift()
      }

      if (calls.length >= maxCalls) {
        return false // Rate limit exceeded
      }

      calls.push(now)
      return true
    },
    getStats() {
      return { calls: calls.length, windowMs, maxCalls }
    }
  }
}

/**
 * Sanitize error messages to prevent information leakage
 * Strips file paths, stack traces, and detailed system information
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message

    // Remove absolute file paths
    let sanitized = message.replace(/\/[^\s:]+/g, '[path]')

    // Remove Windows paths (C:\Users\...)
    sanitized = sanitized.replace(/[A-Za-z]:\\[^\s:]+/g, '[path]')

    // Remove stack trace indicators
    sanitized = sanitized.replace(/\s+at\s+.+/g, '')

    // Remove line:column references
    sanitized = sanitized.replace(/:\d+:\d+/g, '')

    // Remove home directory references
    sanitized = sanitized.replace(/~\/[^\s:]+/g, '[path]')

    return sanitized.trim() || 'An error occurred'
  }

  return 'An error occurred'
}

/**
 * Wrap an IPC handler with security checks
 * @param handler The handler function to wrap
 * @param limiter Optional rate limiter for the channel
 */
export function secureHandler<T extends unknown[], R>(
  handler: (event: IpcMainInvokeEvent, ...args: T) => Promise<R> | R,
  limiter?: RateLimiter
) {
  return async (event: IpcMainInvokeEvent, ...args: T): Promise<R> => {
    try {
      // Always validate sender
      validateSender(event)

      // Check rate limit if provided
      if (limiter && !limiter.check()) {
        throw new Error('Rate limit exceeded. Please try again later.')
      }

      // Execute the handler
      return await handler(event, ...args)
    } catch (error) {
      // Log the full error in the main process for debugging
      console.error('IPC Handler Error:', error)

      // Return sanitized error to renderer
      throw new Error(sanitizeError(error))
    }
  }
}
