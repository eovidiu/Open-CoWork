import { createOpenRouterClient } from './openrouter'
import { createOllamaClient } from './ollama'

export type AIProvider = 'openrouter' | 'ollama'

export interface AIClientOptions {
  ollamaBaseUrl?: string
}

export function createAIClient(provider: AIProvider, options?: AIClientOptions) {
  if (provider === 'ollama') {
    return createOllamaClient(options?.ollamaBaseUrl)
  }
  return createOpenRouterClient()
}
