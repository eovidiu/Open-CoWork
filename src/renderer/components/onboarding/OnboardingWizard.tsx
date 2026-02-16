import { useState, useEffect } from 'react'
import { Key, BarChart3, CheckCircle2, Cloud, Monitor, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useApiKey, useSettings } from '../../hooks/useSettings'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'
import {
  trackOnboardingStarted,
  trackOnboardingStepCompleted,
  trackOnboardingCompleted,
  setAnalyticsOptIn
} from '../../services/analytics'

type Provider = 'openrouter' | 'ollama'

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [ollamaChecking, setOllamaChecking] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [ollamaVersion, setOllamaVersion] = useState<string | null>(null)
  const setSelectedModel = useUIStore((s) => s.setSelectedModel)

  // Track onboarding started
  useEffect(() => {
    trackOnboardingStarted()
  }, [])
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [analyticsConsent, setAnalyticsConsent] = useState(false)
  const { setApiKey, isSettingKey } = useApiKey()
  const { updateSettings } = useSettings()

  const handleProviderSelect = async (provider: Provider) => {
    setSelectedProvider(provider)
    setOllamaError(null)

    if (provider === 'ollama') {
      setOllamaChecking(true)
      try {
        const result = await window.api.ollamaCheckConnection()
        if (result.connected) {
          setOllamaVersion(result.version || null)
          trackOnboardingStepCompleted('provider_ollama')
          updateSettings({ provider: 'ollama' })
          setSelectedModel('')
          setStep(2) // Skip API key step, go to analytics
        } else {
          setOllamaError(result.error || 'Could not connect to Ollama')
        }
      } catch {
        setOllamaError('Failed to check Ollama connection')
      } finally {
        setOllamaChecking(false)
      }
    } else {
      trackOnboardingStepCompleted('provider_openrouter')
      updateSettings({ provider: 'openrouter' })
      setStep(1) // Go to API key step
    }
  }

  const handleApiKeySave = async () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim())
      trackOnboardingStepCompleted('api_key')
      setStep(2)
    }
  }

  const handleComplete = async () => {
    updateSettings({
      analyticsOptIn: analyticsConsent,
      onboardingComplete: true
    })

    setAnalyticsOptIn(analyticsConsent)

    trackOnboardingStepCompleted('analytics')
    trackOnboardingCompleted({
      analyticsOptIn: analyticsConsent,
      hasApiKey: !!apiKeyInput.trim()
    })

    onComplete()
  }

  const steps = [
    {
      icon: Cloud,
      title: 'AI Provider',
      description: 'Choose how to run AI models'
    },
    {
      icon: Key,
      title: 'API Key Setup',
      description: 'Connect to OpenRouter'
    },
    {
      icon: BarChart3,
      title: 'Analytics',
      description: 'Help us improve Open CoWork'
    }
  ]

  // Determine effective number of progress dots based on provider choice
  const progressSteps =
    selectedProvider === 'ollama'
      ? [steps[0], steps[2]] // Provider → Analytics (skip API key)
      : steps

  const progressIndex =
    selectedProvider === 'ollama'
      ? step === 0
        ? 0
        : 1 // Map step 0→0, step 2→1
      : step

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-medium font-mono">Welcome to open co|work</h1>
          <p className="mt-2 text-muted-foreground">
            Let's get you set up in just a couple of steps
          </p>
        </div>

        {/* Progress Indicators */}
        <div className="flex justify-center gap-2">
          {progressSteps.map((_, index) => (
            <div
              key={index}
              className={cn(
                'h-2 w-12 rounded-full transition-colors',
                index <= progressIndex ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>

        {/* Step Content */}
        <div className="rounded-lg border bg-card p-6">
          {/* Step 0: Provider Selection */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Cloud className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">Choose AI Provider</h2>
                  <p className="text-sm text-muted-foreground">
                    Run models in the cloud or locally
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                <button
                  onClick={() => handleProviderSelect('openrouter')}
                  disabled={ollamaChecking}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent',
                    selectedProvider === 'openrouter' && 'border-primary bg-accent'
                  )}
                >
                  <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">OpenRouter (cloud)</div>
                    <div className="text-sm text-muted-foreground">
                      Access Claude, GPT-4, Gemini, and more via API key
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleProviderSelect('ollama')}
                  disabled={ollamaChecking}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent',
                    selectedProvider === 'ollama' && 'border-primary bg-accent'
                  )}
                >
                  <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      Ollama (local)
                      {ollamaChecking && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Run open-weight models privately on your machine
                    </div>
                  </div>
                </button>
              </div>

              {ollamaError && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p>{ollamaError}</p>
                    <p className="mt-1">
                      Make sure Ollama is running.{' '}
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Download Ollama
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {ollamaVersion && (
                <p className="text-xs text-muted-foreground">
                  Ollama v{ollamaVersion} detected
                </p>
              )}
            </div>
          )}

          {/* Step 1: API Key (OpenRouter only) */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Key className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">OpenRouter API Key</h2>
                  <p className="text-sm text-muted-foreground">Required for AI features</p>
                </div>
              </div>

              <Input
                type="password"
                placeholder="sk-or-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />

              <p className="text-xs text-muted-foreground">
                Don't have an API key?{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get one from OpenRouter
                </a>
              </p>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleApiKeySave}
                  disabled={!apiKeyInput.trim() || isSettingKey}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Analytics */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">Anonymous Analytics</h2>
                  <p className="text-sm text-muted-foreground">Optional and privacy-focused</p>
                </div>
              </div>

              <div className="rounded-md bg-muted p-4 text-sm">
                <p className="mb-2">We collect:</p>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  <li>Feature usage patterns</li>
                  <li>Error reports</li>
                  <li>Performance metrics</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                  We never collect your code, API keys, or personal data.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={analyticsConsent}
                  onChange={(e) => setAnalyticsConsent(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">I agree to share anonymous usage data</span>
              </label>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(selectedProvider === 'ollama' ? 0 : 1)}
                >
                  Back
                </Button>
                <Button className="flex-1" onClick={handleComplete}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Get Started
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
