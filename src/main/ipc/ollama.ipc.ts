import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { secureHandler } from './ipc-security'

async function getOllamaBaseUrl(): Promise<string> {
  const prisma = getDatabase()
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
  return settings?.ollamaBaseUrl || 'http://localhost:11434'
}

export function registerOllamaHandlers(): void {
  ipcMain.handle(
    'ollama:checkConnection',
    secureHandler(async (_event, baseUrl?: string) => {
      const url = baseUrl || (await getOllamaBaseUrl())
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${url}/api/version`, {
          signal: controller.signal
        })
        if (!response.ok) {
          return { connected: false, error: `Server returned ${response.status}` }
        }
        const data = await response.json()
        return { connected: true, version: data.version }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to connect to Ollama'
        return { connected: false, error: message }
      } finally {
        clearTimeout(timeout)
      }
    })
  )

  ipcMain.handle(
    'ollama:listModels',
    secureHandler(async (_event, baseUrl?: string) => {
      const url = baseUrl || (await getOllamaBaseUrl())
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch(`${url}/api/tags`, {
          signal: controller.signal
        })
        if (!response.ok) {
          return { models: [], error: `Server returned ${response.status}` }
        }
        const data = await response.json()
        const models = (data.models || []).map(
          (m: { name: string; size: number; modified_at: string }) => ({
            name: m.name,
            size: m.size,
            modifiedAt: m.modified_at
          })
        )
        return { models }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch models from Ollama'
        return { models: [], error: message }
      } finally {
        clearTimeout(timeout)
      }
    })
  )

  ipcMain.handle(
    'ollama:getModelInfo',
    secureHandler(async (_event, modelName: string, baseUrl?: string) => {
      const url = baseUrl || (await getOllamaBaseUrl())
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch(`${url}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName }),
          signal: controller.signal
        })
        if (!response.ok) {
          return { error: `Server returned ${response.status}` }
        }
        const data = await response.json()
        // Extract context length from model parameters if available
        let contextLength: number | undefined
        if (data.model_info) {
          // Ollama model_info contains keys like "<arch>.context_length"
          for (const [key, value] of Object.entries(data.model_info)) {
            if (key.endsWith('.context_length') && typeof value === 'number') {
              contextLength = value
              break
            }
          }
        }
        return {
          name: modelName,
          contextLength,
          parameters: data.parameters,
          template: data.template
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to get model info'
        return { error: message }
      } finally {
        clearTimeout(timeout)
      }
    })
  )
}
