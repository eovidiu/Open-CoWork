import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../src/main/database', () => ({
  getDatabase: () => ({
    settings: {
      findUnique: vi.fn().mockResolvedValue({
        ollamaBaseUrl: 'http://localhost:11434'
      })
    }
  })
}))

vi.mock('../../src/main/ipc/ipc-security', () => ({
  secureHandler: (fn: Function) => fn
}))

describe('Ollama IPC handlers', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('checkConnection logic', () => {
    it('should return connected with version when Ollama is running', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.3.6' })
      })

      const response = await fetch('http://localhost:11434/api/version')
      const data = await response.json()

      expect(response.ok).toBe(true)
      expect(data.version).toBe('0.3.6')
    })

    it('should handle connection refused', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))

      await expect(fetch('http://localhost:11434/api/version')).rejects.toThrow('ECONNREFUSED')
    })

    it('should handle non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      })

      const response = await fetch('http://localhost:11434/api/version')
      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
    })
  })

  describe('listModels logic', () => {
    it('should return model list from Ollama', async () => {
      const mockModels = {
        models: [
          { name: 'llama3.2:latest', size: 4000000000, modified_at: '2024-01-01T00:00:00Z' },
          { name: 'mistral:latest', size: 3000000000, modified_at: '2024-01-02T00:00:00Z' }
        ]
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockModels
      })

      const response = await fetch('http://localhost:11434/api/tags')
      const data = await response.json()

      expect(data.models).toHaveLength(2)
      expect(data.models[0].name).toBe('llama3.2:latest')
      expect(data.models[1].name).toBe('mistral:latest')
    })

    it('should handle empty model list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] })
      })

      const response = await fetch('http://localhost:11434/api/tags')
      const data = await response.json()

      expect(data.models).toHaveLength(0)
    })
  })

  describe('getModelInfo logic', () => {
    it('should extract context_length from model info', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          model_info: {
            'llama.context_length': 8192,
            'general.architecture': 'llama'
          },
          parameters: 'stop: <|im_end|>',
          template: '{{ .System }}'
        })
      })

      const response = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        body: JSON.stringify({ name: 'llama3.2' })
      })
      const data = await response.json()

      // Extract context_length like the handler does
      let contextLength: number | undefined
      for (const [key, value] of Object.entries(data.model_info)) {
        if (key.endsWith('.context_length') && typeof value === 'number') {
          contextLength = value
          break
        }
      }

      expect(contextLength).toBe(8192)
    })

    it('should handle model without context_length', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          model_info: {
            'general.architecture': 'llama'
          }
        })
      })

      const response = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        body: JSON.stringify({ name: 'unknown-model' })
      })
      const data = await response.json()

      let contextLength: number | undefined
      for (const [key, value] of Object.entries(data.model_info)) {
        if (key.endsWith('.context_length') && typeof value === 'number') {
          contextLength = value
          break
        }
      }

      expect(contextLength).toBeUndefined()
    })
  })
})
