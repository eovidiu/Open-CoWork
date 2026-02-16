import { useState, useEffect } from 'react'
import { ChevronDown, Plus, X, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useUIStore, DEFAULT_MODELS } from '../../stores/uiStore'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../lib/utils'

interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
}

interface ModelPickerProps {
  variant?: 'default' | 'minimal'
}

export function ModelPicker({ variant = 'default' }: ModelPickerProps) {
  const { selectedModel, setSelectedModel, customModels, addCustomModel, removeCustomModel } =
    useUIStore()
  const { settings } = useSettings()
  const [isOpen, setIsOpen] = useState(false)
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customModelId, setCustomModelId] = useState('')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaError, setOllamaError] = useState<string | null>(null)

  const isOllama = settings?.provider === 'ollama'

  // Fetch Ollama models when provider is ollama (on mount and when dropdown opens)
  useEffect(() => {
    if (isOllama) {
      window.api
        .ollamaListModels()
        .then((result) => {
          if (result.error) {
            setOllamaError(result.error)
            setOllamaModels([])
          } else {
            setOllamaModels(result.models)
            setOllamaError(null)
          }
        })
        .catch(() => {
          setOllamaError('Failed to connect to Ollama')
          setOllamaModels([])
        })
    }
  }, [isOllama, isOpen])

  // Auto-select first Ollama model when selection is empty or stale
  useEffect(() => {
    if (isOllama && ollamaModels.length > 0) {
      const ollamaModelIds = ollamaModels.map((m) => m.name)
      if (!selectedModel || !ollamaModelIds.includes(selectedModel)) {
        setSelectedModel(ollamaModels[0].name)
      }
    }
  }, [isOllama, ollamaModels, selectedModel, setSelectedModel])

  const allModels = isOllama
    ? ollamaModels.map((m) => ({
        id: m.name,
        name: m.name.split(':')[0],
        provider: 'Ollama'
      }))
    : [...DEFAULT_MODELS, ...customModels]

  const currentModel = allModels.find((m) => m.id === selectedModel) || {
    id: '',
    name: 'Select a model',
    provider: ''
  }

  const handleAddCustomModel = () => {
    if (customModelId.trim()) {
      if (isOllama) {
        // For Ollama, just set the model name directly
        setSelectedModel(customModelId.trim())
        setCustomModelId('')
        setShowAddCustom(false)
      } else {
        const parts = customModelId.trim().split('/')
        const provider = parts[0] || 'Custom'
        const name = parts.slice(1).join('/') || customModelId
        addCustomModel({
          id: customModelId.trim(),
          name,
          provider
        })
        setSelectedModel(customModelId.trim())
        setCustomModelId('')
        setShowAddCustom(false)
      }
    }
  }

  return (
    <div className="relative">
      {variant === 'minimal' ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="font-medium">{currentModel.name}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
        </button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="font-medium">{currentModel.name}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
        </Button>
      )}

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border bg-popover p-2 shadow-lg">
            <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
              {isOllama ? 'Local Models' : 'Select Model'}
            </div>

            {isOllama && ollamaError && (
              <div className="mb-2 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Ollama not detected. Is it running?</span>
              </div>
            )}

            <div className="max-h-64 space-y-1 overflow-y-auto">
              {allModels.length === 0 && isOllama && !ollamaError && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No models installed. Run <code className="bg-muted px-1 rounded">ollama pull llama3.2</code> to get started.
                </div>
              )}

              {allModels.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    'flex items-center justify-between rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent',
                    selectedModel === model.id && 'bg-accent'
                  )}
                  onClick={() => {
                    setSelectedModel(model.id)
                    setIsOpen(false)
                  }}
                >
                  <div>
                    <div className="font-medium">{model.name}</div>
                    <div className="text-xs text-muted-foreground">{model.provider}</div>
                  </div>
                  {!isOllama && customModels.some((m) => m.id === model.id) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeCustomModel(model.id)
                        if (selectedModel === model.id) {
                          setSelectedModel(DEFAULT_MODELS[0].id)
                        }
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-2 border-t pt-2">
              {showAddCustom ? (
                <div className="space-y-2">
                  <Input
                    placeholder={isOllama ? 'e.g. llama3.2' : 'e.g. openai/gpt-4o'}
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddCustomModel()
                      if (e.key === 'Escape') setShowAddCustom(false)
                    }}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleAddCustomModel}>
                      {isOllama ? 'Use' : 'Add'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setShowAddCustom(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-xs"
                  onClick={() => setShowAddCustom(true)}
                >
                  <Plus className="h-3 w-3" />
                  {isOllama ? 'Use custom model name' : 'Add custom model'}
                </Button>
              )}

              {!isOllama && (
                <a
                  href="https://openrouter.ai/models"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  Browse models on OpenRouter
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
