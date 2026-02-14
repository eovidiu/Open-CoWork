import { app, shell, BrowserWindow, Menu, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, getDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { setMainWindow } from './ipc/ipc-security'
import { enforceContentSecurityPolicy } from './csp'
import { initAuditLog } from './services/audit-log.service'

/**
 * Security Note: TLS Certificate Pinning
 *
 * KNOWN LIMITATION: This application does not implement TLS certificate pinning
 * for critical endpoints (OpenRouter API, skillregistry.io).
 *
 * Rationale:
 * - Certificate pinning in Electron is complex and can break on CA rotations
 * - False positives can completely break the application for users
 * - Risk is partially mitigated by:
 *   - CSP restrictions (connect-src allowlist in PR-05)
 *   - HTTPS enforcement for all external connections
 *   - Electron's built-in certificate validation
 *
 * TODO: Consider implementing certificate pinning with graceful fallback and
 * user notification in a future release. Would require:
 * - session.defaultSession.setCertificateVerifyProc()
 * - Pin rotation strategy
 * - User notification on certificate warnings
 * - Fallback mechanism for legitimate CA changes
 */

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  // Prevent navigation away from app origin
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server URL in development
    if (is.dev && process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) {
      return
    }
    // Block all other navigation
    event.preventDefault()
  })

  // Disable DevTools in production
  if (!is.dev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools()
    })
  }

  // Context menu for copy/paste
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuTemplate: Electron.MenuItemConstructorOptions[] = []

    // Add spelling suggestions if available
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        })
      }
      if (params.dictionarySuggestions.length > 0) {
        menuTemplate.push({ type: 'separator' })
      }
    }

    // Standard edit operations
    if (params.isEditable) {
      menuTemplate.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else if (params.selectionText) {
      // Text is selected but not in an editable field
      menuTemplate.push(
        { label: 'Copy', role: 'copy' },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' }
      )
    } else {
      // No selection, no editable - still allow select all
      menuTemplate.push({ label: 'Select All', role: 'selectAll' })
    }

    // Only show menu if we have items
    if (menuTemplate.length > 0) {
      const menu = Menu.buildFromTemplate(menuTemplate)
      menu.popup()
    }
  })

  // Find in page handlers - need to pass text each time for proper navigation
  let lastSearchText = ''

  ipcMain.on('find:start', (_event, text: string) => {
    if (text) {
      lastSearchText = text
      mainWindow.webContents.findInPage(text)
    }
  })

  ipcMain.on('find:next', (_event, text: string) => {
    const searchText = text || lastSearchText
    if (searchText) {
      mainWindow.webContents.findInPage(searchText, { forward: true, findNext: true })
    }
  })

  ipcMain.on('find:previous', (_event, text: string) => {
    const searchText = text || lastSearchText
    if (searchText) {
      mainWindow.webContents.findInPage(searchText, { forward: false, findNext: true })
    }
  })

  ipcMain.on('find:stop', () => {
    lastSearchText = ''
    mainWindow.webContents.stopFindInPage('clearSelection')
  })

  // Send find results back to renderer
  mainWindow.webContents.on('found-in-page', (_event, result) => {
    mainWindow.webContents.send('find:result', {
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.opencowork')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Deny all permission requests by default
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Enforce CSP via HTTP response headers (removes 'unsafe-inline' from style-src in production)
  enforceContentSecurityPolicy()

  // Initialize database
  await initDatabase()

  // Initialize audit logging
  const auditDir = join(app.getPath('userData'), 'audit')
  initAuditLog(auditDir)

  // Register IPC handlers
  registerIpcHandlers()

  // Inject API key at the network level for OpenRouter requests.
  // This prevents the decrypted key from ever reaching the renderer process.
  const { createElectronSecureStorage } = await import('./ipc/settings.ipc')
  const { createSettingsService } = await import('./services/settings.service')
  const secureStorage = createElectronSecureStorage()
  const settingsService = createSettingsService(getDatabase(), secureStorage)

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://openrouter.ai/*'] },
    async (details, callback) => {
      try {
        const apiKey = await settingsService.getApiKey()
        if (apiKey) {
          details.requestHeaders['Authorization'] = `Bearer ${apiKey}`
        }
      } catch (error) {
        console.error('[webRequest] Failed to inject API key:', error)
      }
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  const mainWindow = createWindow()

  // Set main window for IPC security validation
  setMainWindow(mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
