import { describe, it, expect, vi } from 'vitest'

// Mock the AI SDK
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((config) => {
    // Return a mock that exposes the config for testing
    const client = (model: string) => ({ model, config })
    client._config = config
    return client
  })
}))

import { createAIClient } from '../../src/renderer/services/ai/client-factory'
import { createOpenAI } from '@ai-sdk/openai'

describe('createAIClient', () => {
  it('should create an OpenRouter client with correct baseURL', () => {
    const client = createAIClient('openrouter')
    // The mock captures the config
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://openrouter.ai/api/v1'
      })
    )
  })

  it('should create an Ollama client with default baseURL', () => {
    vi.mocked(createOpenAI).mockClear()
    const client = createAIClient('ollama')
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama'
      })
    )
  })

  it('should create an Ollama client with custom baseURL', () => {
    vi.mocked(createOpenAI).mockClear()
    const client = createAIClient('ollama', {
      ollamaBaseUrl: 'http://192.168.1.100:11434'
    })
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://192.168.1.100:11434/v1',
        apiKey: 'ollama'
      })
    )
  })

  it('should use placeholder API key for OpenRouter', () => {
    vi.mocked(createOpenAI).mockClear()
    const client = createAIClient('openrouter')
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: '__injected_by_main__'
      })
    )
  })
})

describe('getContextLimitForProvider', () => {
  it('should return OpenRouter context limits for known models', async () => {
    const { getContextLimit } = await import(
      '../../src/renderer/services/ai/openrouter'
    )
    expect(getContextLimit('anthropic/claude-sonnet-4')).toBe(200000)
    expect(getContextLimit('openai/gpt-4o')).toBe(128000)
  })

  it('should return default for unknown OpenRouter models', async () => {
    const { getContextLimit } = await import(
      '../../src/renderer/services/ai/openrouter'
    )
    expect(getContextLimit('unknown/model')).toBe(100000)
  })

  it('should strip :online suffix when looking up context limits', async () => {
    const { getContextLimit } = await import(
      '../../src/renderer/services/ai/openrouter'
    )
    expect(getContextLimit('anthropic/claude-sonnet-4:online')).toBe(200000)
  })
})
