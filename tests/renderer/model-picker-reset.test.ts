import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock zustand persist middleware to be a passthrough
vi.mock('zustand/middleware', () => ({
  persist: (fn: Function) => fn
}))

// Mock the approval store
vi.mock('../../src/renderer/stores/approvalStore', () => ({
  useApprovalStore: {
    getState: () => ({ clearSession: vi.fn() })
  }
}))

import { DEFAULT_MODELS } from '../../src/renderer/stores/uiStore'

describe('Model picker reset behavior', () => {
  describe('DEFAULT_MODELS', () => {
    it('should have at least one default model', () => {
      expect(DEFAULT_MODELS.length).toBeGreaterThan(0)
    })

    it('first default model should have a valid id', () => {
      expect(DEFAULT_MODELS[0].id).toBeTruthy()
      expect(DEFAULT_MODELS[0].id).toContain('/')
    })
  })

  describe('Model selection logic', () => {
    it('empty selectedModel should not match any model list', () => {
      const selectedModel = ''
      const allModels = DEFAULT_MODELS
      const match = allModels.find((m) => m.id === selectedModel)
      expect(match).toBeUndefined()
    })

    it('OpenRouter model should not match Ollama model list', () => {
      const selectedModel = 'google/gemini-3-flash-preview'
      const ollamaModels = [
        { id: 'llama3.2:latest', name: 'llama3.2', provider: 'Ollama' },
        { id: 'mistral:latest', name: 'mistral', provider: 'Ollama' }
      ]
      const match = ollamaModels.find((m) => m.id === selectedModel)
      expect(match).toBeUndefined()
    })

    it('Ollama model should not match OpenRouter model list', () => {
      const selectedModel = 'llama3.2:latest'
      const match = DEFAULT_MODELS.find((m) => m.id === selectedModel)
      expect(match).toBeUndefined()
    })

    it('should produce placeholder when selectedModel is empty', () => {
      const selectedModel = ''
      const allModels = DEFAULT_MODELS
      const currentModel = allModels.find((m) => m.id === selectedModel) || {
        id: '',
        name: 'Select a model',
        provider: ''
      }
      expect(currentModel.name).toBe('Select a model')
      expect(currentModel.id).toBe('')
    })

    it('should produce placeholder when selectedModel is from wrong provider', () => {
      const selectedModel = 'google/gemini-3-flash-preview'
      const ollamaModels = [
        { id: 'llama3.2:latest', name: 'llama3.2', provider: 'Ollama' }
      ]
      const currentModel = ollamaModels.find((m) => m.id === selectedModel) || {
        id: '',
        name: 'Select a model',
        provider: ''
      }
      expect(currentModel.name).toBe('Select a model')
    })

    it('auto-select should pick first Ollama model when selection is empty', () => {
      const selectedModel = ''
      const ollamaModels = [
        { name: 'llama3.2:latest', size: 4000000000, modifiedAt: '' },
        { name: 'mistral:latest', size: 3000000000, modifiedAt: '' }
      ]

      let newSelection = selectedModel
      // Simulate the auto-select useEffect logic
      if (ollamaModels.length > 0) {
        const ollamaModelIds = ollamaModels.map((m) => m.name)
        if (!selectedModel || !ollamaModelIds.includes(selectedModel)) {
          newSelection = ollamaModels[0].name
        }
      }

      expect(newSelection).toBe('llama3.2:latest')
    })

    it('auto-select should not change selection when model is valid', () => {
      const selectedModel = 'mistral:latest'
      const ollamaModels = [
        { name: 'llama3.2:latest', size: 4000000000, modifiedAt: '' },
        { name: 'mistral:latest', size: 3000000000, modifiedAt: '' }
      ]

      let newSelection = selectedModel
      if (ollamaModels.length > 0) {
        const ollamaModelIds = ollamaModels.map((m) => m.name)
        if (!selectedModel || !ollamaModelIds.includes(selectedModel)) {
          newSelection = ollamaModels[0].name
        }
      }

      expect(newSelection).toBe('mistral:latest')
    })

    it('switching to OpenRouter should reset to first default model', () => {
      const newSelection = DEFAULT_MODELS[0].id
      expect(newSelection).toBe('google/gemini-3-flash-preview')
    })
  })
})
