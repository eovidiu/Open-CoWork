import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron — use inline fn to avoid hoisting issues
vi.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn()
      }
    }
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

import { session } from 'electron'
import { enforceContentSecurityPolicy } from '../../src/main/csp'

describe('Content Security Policy', () => {
  beforeEach(() => {
    vi.mocked(session.defaultSession.webRequest.onHeadersReceived).mockReset()
  })

  it('should register onHeadersReceived handler', () => {
    enforceContentSecurityPolicy()
    expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalledOnce()
  })

  it('should include localhost in connect-src for Ollama support', () => {
    enforceContentSecurityPolicy()
    const handler = vi.mocked(session.defaultSession.webRequest.onHeadersReceived).mock.calls[0][0] as Function

    const mockCallback = vi.fn()
    handler({ responseHeaders: {} }, mockCallback)

    const csp = mockCallback.mock.calls[0][0].responseHeaders['Content-Security-Policy'][0]
    expect(csp).toContain('http://localhost:*')
    expect(csp).toContain('http://127.0.0.1:*')
  })

  it('should include OpenRouter in connect-src', () => {
    enforceContentSecurityPolicy()
    const handler = vi.mocked(session.defaultSession.webRequest.onHeadersReceived).mock.calls[0][0] as Function

    const mockCallback = vi.fn()
    handler({ responseHeaders: {} }, mockCallback)

    const csp = mockCallback.mock.calls[0][0].responseHeaders['Content-Security-Policy'][0]
    expect(csp).toContain('https://openrouter.ai')
  })
})
