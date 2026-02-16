import { createOpenAI } from '@ai-sdk/openai'

export function createOllamaClient(baseUrl: string = 'http://localhost:11434') {
  return createOpenAI({
    apiKey: 'ollama',
    baseURL: `${baseUrl}/v1`
  })
}
