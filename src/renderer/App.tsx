import { useEffect, useState, useRef } from 'react'
import { useSettings } from './hooks/useSettings'
import { AppShell } from './components/layout/AppShell'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { PrivacyNotice } from './components/privacy/PrivacyNotice'
import { Toaster } from './components/ui/toaster'
import { initAnalytics, trackAppOpened } from './services/analytics'

function App() {
  const { settings, isLoading } = useSettings()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const analyticsInitialized = useRef(false)

  // Initialize analytics once settings are loaded
  useEffect(() => {
    if (settings && !analyticsInitialized.current) {
      analyticsInitialized.current = true
      initAnalytics().then(() => {
        trackAppOpened()
      })
    }
  }, [settings])

  // Track privacy acceptance from settings
  useEffect(() => {
    if (settings) {
      setPrivacyAccepted(!!settings.privacyAccepted)
    }
  }, [settings])

  useEffect(() => {
    if (settings && !settings.onboardingComplete) {
      setShowOnboarding(true)
    }
  }, [settings])

  useEffect(() => {
    // Apply theme
    if (settings?.theme) {
      const root = document.documentElement
      if (settings.theme === 'dark') {
        root.classList.add('dark')
      } else if (settings.theme === 'light') {
        root.classList.remove('dark')
      } else {
        // System preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (prefersDark) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
    }
  }, [settings?.theme])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Privacy notice must be accepted before anything else
  if (!privacyAccepted) {
    return (
      <>
        <PrivacyNotice onAccept={() => setPrivacyAccepted(true)} />
        <Toaster />
      </>
    )
  }

  if (showOnboarding) {
    return <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
  }

  return (
    <>
      <AppShell />
      <Toaster />
    </>
  )
}

export default App
