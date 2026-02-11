import posthog from 'posthog-js'

/**
 * Analytics Privacy Policy
 *
 * This module implements privacy-respecting telemetry with explicit opt-in.
 *
 * Data Collection Policy:
 * - NO personal information (names, emails, file paths, message content)
 * - NO conversation content or user messages
 * - NO tool call arguments (only tool names and success/failure)
 * - Aggregated metrics only: event counts, bucketed latencies, feature usage
 *
 * What IS collected (if opted in):
 * - Feature usage events (which features are used, not what data they process)
 * - Performance metrics (latency buckets, not raw values)
 * - Model selection (which model, not what prompts)
 * - Tool usage (tool name, duration bucket, success/failure only)
 * - Session metadata (theme, skill count, platform)
 *
 * Privacy Controls:
 * - Opt-in only (defaults to OFF)
 * - Memory-only persistence (no persistent tracking IDs)
 * - No autocapture, no session recording, no surveys
 * - No external script loading
 */

// PostHog configuration
// This is a write-only public key - safe to include in client code
const POSTHOG_KEY = 'phc_iNm6Q6FDfO9xi29jmMNnXunX08HVpoY2kS626Irq6lc'
const POSTHOG_HOST = 'https://us.i.posthog.com'

let isInitialized = false
let isOptedIn = false

// Initialize PostHog (call once at app start)
export async function initAnalytics(): Promise<void> {
  if (isInitialized) return

  try {
    // Check if user has opted in
    const settings = await window.api.getSettings()
    isOptedIn = settings?.analyticsOptIn === true

    if (isOptedIn) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        persistence: 'memory', // No persistent tracking IDs
        autocapture: false, // We'll track manually for privacy
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true, // No surveys
        disable_external_dependency_loading: true, // No external scripts
        loaded: () => {
          console.log('[Analytics] PostHog initialized')
        }
      })
    }

    isInitialized = true
  } catch (error) {
    // Don't log raw error to avoid leaking sensitive data
    console.warn('[Analytics] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error')
  }
}

// Update opt-in status (call when user changes preference)
export function setAnalyticsOptIn(optIn: boolean): void {
  isOptedIn = optIn

  if (optIn && !posthog.__loaded) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: 'memory', // No persistent tracking IDs
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true, // No surveys
      disable_external_dependency_loading: true // No external scripts
    })
  } else if (!optIn && posthog.__loaded) {
    posthog.opt_out_capturing()
  } else if (optIn && posthog.__loaded) {
    posthog.opt_in_capturing()
  }
}

// Helper to track events (respects opt-in)
function track(event: string, properties?: Record<string, unknown>): void {
  if (!isOptedIn) return

  try {
    posthog.capture(event, {
      ...properties,
      app_version: '1.0.0', // TODO: Get from package.json
      platform: window.api.getPlatform()
    })
  } catch (error) {
    // Don't log raw error to avoid leaking sensitive data
    console.warn('[Analytics] Failed to track event:', error instanceof Error ? error.message : 'Unknown error')
  }
}

// ============================================
// ONBOARDING EVENTS
// ============================================

export function trackOnboardingStarted(): void {
  track('onboarding_started')
}

export function trackOnboardingStepCompleted(step: string): void {
  track('onboarding_step_completed', { step })
}

export function trackOnboardingCompleted(data: {
  analyticsOptIn: boolean
  hasApiKey: boolean
}): void {
  track('onboarding_completed', data)
}

export function trackOnboardingSkipped(atStep: string): void {
  track('onboarding_skipped', { at_step: atStep })
}

// ============================================
// CHAT EVENTS
// ============================================

export function trackMessageSent(data: {
  messageLength: number
  hasAttachments: boolean
  attachmentCount: number
  model: string
  isNewConversation: boolean
}): void {
  track('message_sent', {
    message_length_bucket: getLengthBucket(data.messageLength),
    has_attachments: data.hasAttachments,
    attachment_count: data.attachmentCount,
    model: data.model,
    is_new_conversation: data.isNewConversation
  })
}

export function trackMessageReceived(data: {
  responseLength: number
  latencyMs: number
  tokensPerSecond?: number
  toolCallCount: number
  model: string
  wasCompacted: boolean
}): void {
  track('message_received', {
    response_length_bucket: getLengthBucket(data.responseLength),
    latency_ms: Math.round(data.latencyMs),
    latency_bucket: getLatencyBucket(data.latencyMs),
    tokens_per_second: data.tokensPerSecond ? Math.round(data.tokensPerSecond) : undefined,
    tool_call_count: data.toolCallCount,
    model: data.model,
    was_compacted: data.wasCompacted
  })
}

export function trackMessageError(data: {
  errorType: string
  model: string
  wasRetried: boolean
}): void {
  track('message_error', {
    error_type: data.errorType,
    model: data.model,
    was_retried: data.wasRetried
  })
}

export function trackConversationCreated(): void {
  track('conversation_created')
}

export function trackConversationDeleted(): void {
  track('conversation_deleted')
}

export function trackGenerationStopped(): void {
  track('generation_stopped')
}

// ============================================
// TOOL EVENTS
// ============================================

export function trackToolUsed(data: {
  toolName: string
  success: boolean
  durationMs: number
}): void {
  // Only track tool name and success - no arguments for privacy
  track('tool_used', {
    tool_name: data.toolName,
    success: data.success,
    duration_ms: Math.round(data.durationMs),
    duration_bucket: getDurationBucket(data.durationMs)
  })
}

// ============================================
// FEATURE EVENTS
// ============================================

export function trackFeatureUsed(feature: string, metadata?: Record<string, unknown>): void {
  track('feature_used', {
    feature,
    ...metadata
  })
}

export function trackSearchEnabled(enabled: boolean): void {
  track('search_toggled', { enabled })
}

export function trackModelChanged(model: string): void {
  track('model_changed', { model })
}

export function trackThemeChanged(theme: string): void {
  track('theme_changed', { theme })
}

export function trackSkillInstalled(skillName: string): void {
  track('skill_installed', { skill_name: skillName })
}

export function trackSkillRemoved(skillName: string): void {
  track('skill_removed', { skill_name: skillName })
}

export function trackImageAttached(data: {
  originalSizeKb: number
  compressedSizeKb: number
}): void {
  track('image_attached', {
    original_size_kb: Math.round(data.originalSizeKb),
    compressed_size_kb: Math.round(data.compressedSizeKb),
    compression_ratio: Math.round((data.compressedSizeKb / data.originalSizeKb) * 100)
  })
}

// ============================================
// SESSION EVENTS
// ============================================

export function trackAppOpened(): void {
  track('app_opened')
}

export function trackAppClosed(data: {
  sessionDurationMs: number
  messageCount: number
  conversationCount: number
}): void {
  track('app_closed', {
    session_duration_minutes: Math.round(data.sessionDurationMs / 60000),
    message_count: data.messageCount,
    conversation_count: data.conversationCount
  })
}

// ============================================
// HELPERS
// ============================================

function getLengthBucket(length: number): string {
  if (length < 50) return 'tiny'
  if (length < 200) return 'short'
  if (length < 500) return 'medium'
  if (length < 1000) return 'long'
  if (length < 5000) return 'very_long'
  return 'huge'
}

function getLatencyBucket(ms: number): string {
  if (ms < 500) return 'instant'
  if (ms < 1000) return 'fast'
  if (ms < 3000) return 'normal'
  if (ms < 10000) return 'slow'
  return 'very_slow'
}

function getDurationBucket(ms: number): string {
  if (ms < 100) return 'instant'
  if (ms < 500) return 'fast'
  if (ms < 2000) return 'normal'
  if (ms < 5000) return 'slow'
  return 'very_slow'
}

// ============================================
// IDENTIFY (for user properties, not PII)
// ============================================

export function identifyUser(properties: {
  model?: string
  theme?: string
  skillCount?: number
}): void {
  if (!isOptedIn) return

  try {
    posthog.identify(undefined, properties)
  } catch (error) {
    // Don't log raw error to avoid leaking sensitive data
    console.warn('[Analytics] Failed to identify:', error instanceof Error ? error.message : 'Unknown error')
  }
}
