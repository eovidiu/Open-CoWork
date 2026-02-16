import { describe, it, expect } from 'vitest'

/**
 * Tests the API key guard logic from useChat.sendMessage.
 * The actual guard is: if (settings?.provider !== 'ollama' && !hasApiKey) { error }
 * We test the boolean logic directly since useChat is a React hook
 * that requires full renderer context to test.
 */
function shouldBlockForMissingApiKey(
  provider: string | undefined,
  hasApiKey: boolean
): boolean {
  return provider !== 'ollama' && !hasApiKey
}

describe('API key guard logic', () => {
  it('should NOT block when provider is ollama and no API key', () => {
    expect(shouldBlockForMissingApiKey('ollama', false)).toBe(false)
  })

  it('should NOT block when provider is ollama and has API key', () => {
    expect(shouldBlockForMissingApiKey('ollama', true)).toBe(false)
  })

  it('should block when provider is openrouter and no API key', () => {
    expect(shouldBlockForMissingApiKey('openrouter', false)).toBe(true)
  })

  it('should NOT block when provider is openrouter and has API key', () => {
    expect(shouldBlockForMissingApiKey('openrouter', true)).toBe(false)
  })

  it('should block when provider is undefined and no API key (safe default)', () => {
    expect(shouldBlockForMissingApiKey(undefined, false)).toBe(true)
  })

  it('should NOT block when provider is undefined but has API key', () => {
    expect(shouldBlockForMissingApiKey(undefined, true)).toBe(false)
  })
})
