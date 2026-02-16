import { useState, useEffect } from 'react'
import { Trash2, Globe, ChevronRight, Shield, Cloud, Monitor, Loader2, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useSettings, useApiKey, useAvailableBrowsers } from '../../hooks/useSettings'
import { useUIStore, DEFAULT_MODELS } from '../../stores/uiStore'
import { cn } from '../../lib/utils'
import { BrowserSelectionDialog } from './BrowserSelectionDialog'
import { PrivacyPolicyDialog } from '../privacy/PrivacyPolicy'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings()
  const { hasApiKey, maskedKey, setApiKey, deleteApiKey, isSettingKey } = useApiKey()
  const { browsers } = useAvailableBrowsers()
  const setSelectedModel = useUIStore((s) => s.setSelectedModel)
  const [newApiKey, setNewApiKey] = useState('')
  const [showBrowserDialog, setShowBrowserDialog] = useState(false)
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<{
    checking: boolean
    connected: boolean
    version?: string
    error?: string
  }>({ checking: false, connected: false })
  const [ollamaUrlInput, setOllamaUrlInput] = useState('')

  const isOllama = settings?.provider === 'ollama'

  // Sync local URL input with settings
  useEffect(() => {
    if (settings?.ollamaBaseUrl) {
      setOllamaUrlInput(settings.ollamaBaseUrl)
    }
  }, [settings?.ollamaBaseUrl])

  // Check Ollama connection when dialog opens and provider is Ollama
  useEffect(() => {
    if (open && isOllama) {
      checkOllamaConnection()
    }
  }, [open, isOllama])

  const checkOllamaConnection = async (baseUrl?: string) => {
    setOllamaStatus({ checking: true, connected: false })
    try {
      const result = await window.api.ollamaCheckConnection(baseUrl)
      setOllamaStatus({
        checking: false,
        connected: result.connected,
        version: result.version,
        error: result.error
      })
    } catch {
      setOllamaStatus({ checking: false, connected: false, error: 'Connection check failed' })
    }
  }

  const handleProviderSwitch = async (provider: 'openrouter' | 'ollama') => {
    if (provider === 'ollama') {
      await checkOllamaConnection()
      // Only switch if connected
      const result = await window.api.ollamaCheckConnection()
      if (result.connected) {
        updateSettings({ provider: 'ollama' })
        setSelectedModel('')
      }
    } else {
      if (!hasApiKey) {
        // Don't switch yet — user needs to enter a key first
        return
      }
      updateSettings({ provider: 'openrouter' })
      setSelectedModel(DEFAULT_MODELS[0].id)
    }
  }

  const handleOllamaUrlSave = () => {
    const url = ollamaUrlInput.trim()
    if (url) {
      updateSettings({ ollamaBaseUrl: url })
      checkOllamaConnection(url)
    }
  }

  const isNonLocalUrl =
    ollamaUrlInput &&
    !ollamaUrlInput.includes('localhost') &&
    !ollamaUrlInput.includes('127.0.0.1')

  const selectedBrowser = browsers.find((b) => b.id === settings?.preferredBrowser)

  const handleSaveApiKey = () => {
    if (newApiKey.trim()) {
      setApiKey(newApiKey.trim())
      setNewApiKey('')
    }
  }

  const handleDeleteApiKey = () => {
    deleteApiKey()
    setNewApiKey('')
  }

  const handleThemeChange = (theme: string) => {
    updateSettings({ theme })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your Open CoWork preferences</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Provider Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">AI Provider</label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'flex-1 gap-2',
                  !isOllama && 'border-primary bg-primary/10'
                )}
                onClick={() => handleProviderSwitch('openrouter')}
              >
                <Cloud className="h-4 w-4" />
                OpenRouter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'flex-1 gap-2',
                  isOllama && 'border-primary bg-primary/10'
                )}
                onClick={() => handleProviderSwitch('ollama')}
              >
                <Monitor className="h-4 w-4" />
                Ollama
                {ollamaStatus.checking && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </Button>
            </div>

            {/* Ollama status indicator */}
            {isOllama && (
              <div className="flex items-center gap-2 text-xs">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    ollamaStatus.connected ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                {ollamaStatus.connected ? (
                  <span className="text-muted-foreground">
                    Connected{ollamaStatus.version ? ` (v${ollamaStatus.version})` : ''}
                  </span>
                ) : (
                  <span className="text-destructive">
                    {ollamaStatus.error || 'Not connected'}
                  </span>
                )}
              </div>
            )}

            {/* Switch to OpenRouter without API key warning */}
            {!isOllama && !hasApiKey && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Enter an API key below to use OpenRouter</span>
              </div>
            )}
          </div>

          {/* Ollama URL (when Ollama is active) */}
          {isOllama && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Ollama URL</label>
              <div className="flex items-center gap-2">
                <Input
                  value={ollamaUrlInput}
                  onChange={(e) => setOllamaUrlInput(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleOllamaUrlSave}
                  disabled={ollamaUrlInput === settings?.ollamaBaseUrl}
                >
                  Save
                </Button>
              </div>
              {isNonLocalUrl && (
                <p className="text-xs text-amber-500">
                  Warning: Non-localhost URLs send data over unencrypted HTTP
                </p>
              )}
            </div>
          )}

          {/* API Key Section (always shown, but context changes) */}
          {!isOllama && (
            <div className="space-y-2">
              <label className="text-sm font-medium">OpenRouter API Key</label>
              {hasApiKey ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm">
                    {maskedKey?.masked || '••••••••••••••••'}
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleDeleteApiKey}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder="sk-or-..."
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleSaveApiKey} disabled={!newApiKey.trim() || isSettingKey}>
                    Save
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Get your API key from{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>
          )}

          {/* Theme Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Theme</label>
            <div className="flex gap-2">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <Button
                  key={theme}
                  variant="outline"
                  size="sm"
                  className={cn(settings?.theme === theme && 'border-primary bg-primary/10')}
                  onClick={() => handleThemeChange(theme)}
                >
                  {theme.charAt(0).toUpperCase() + theme.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* Browser Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Browser for Web Tasks</label>
            <button
              onClick={() => setShowBrowserDialog(true)}
              className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span>{selectedBrowser?.name || 'Not configured'}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <p className="text-xs text-muted-foreground">
              Choose which browser profile to use for web browsing tasks. Your logins will be
              available.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="browserHeadless"
                checked={settings?.browserHeadless ?? false}
                onChange={(e) => updateSettings({ browserHeadless: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="browserHeadless" className="text-sm text-muted-foreground">
                Run browser in background (headless mode)
              </label>
            </div>
          </div>

          {/* Analytics Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Analytics</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="analytics"
                checked={settings?.analyticsOptIn ?? false}
                onChange={(e) => updateSettings({ analyticsOptIn: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="analytics" className="text-sm text-muted-foreground">
                Help improve Open CoWork by sharing anonymous usage data
              </label>
            </div>
          </div>

          {/* Privacy Policy Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Privacy</label>
            <button
              onClick={() => setShowPrivacyPolicy(true)}
              className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span>Privacy Policy</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <p className="text-xs text-muted-foreground">
              Review how Open CoWork handles your data
            </p>
          </div>
        </div>

        <BrowserSelectionDialog open={showBrowserDialog} onOpenChange={setShowBrowserDialog} />
        <PrivacyPolicyDialog open={showPrivacyPolicy} onOpenChange={setShowPrivacyPolicy} />
      </DialogContent>
    </Dialog>
  )
}
