import { session } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Enforces the Content Security Policy via HTTP response headers.
 *
 * In production, 'unsafe-inline' is removed from style-src because Vite extracts
 * CSS into files (loaded via <link>). In development, Vite HMR injects <style>
 * tags so 'unsafe-inline' is still needed for style-src.
 *
 * This replaces the previous CSP meta tag in index.html, giving the main process
 * authoritative control over the policy and enabling environment-aware directives.
 */
export function enforceContentSecurityPolicy(): void {
  const styleSrc = is.dev
    ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : "style-src 'self' https://fonts.googleapis.com"

  const cspHeader = [
    "default-src 'self'",
    "script-src 'self'",
    styleSrc,
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self' https://openrouter.ai https://*.posthog.com https://skillregistry.io"
  ].join('; ')

  const { webRequest } = session.defaultSession
  if (typeof webRequest.onHeadersReceived === 'function') {
    webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [cspHeader]
        }
      })
    })
  }
}
