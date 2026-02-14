import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks – we capture everything Electron's BrowserWindow receives so we can
// assert on the security-relevant configuration that createWindow() applies.
// ---------------------------------------------------------------------------

// Collected event handlers registered via webContents.on
const webContentsOnHandlers = new Map<string, Function>()
let windowOpenHandler: Function | null = null

const mockCloseDevTools = vi.fn()

const mockWebContents = {
  on: vi.fn((event: string, handler: Function) => {
    webContentsOnHandlers.set(event, handler)
  }),
  setWindowOpenHandler: vi.fn((handler: Function) => {
    windowOpenHandler = handler
  }),
  closeDevTools: mockCloseDevTools,
  findInPage: vi.fn(),
  stopFindInPage: vi.fn(),
  send: vi.fn()
}

let capturedBrowserWindowOptions: Record<string, unknown> | null = null

const mockBrowserWindowInstance = {
  on: vi.fn((_event: string, cb: Function) => {
    if (_event === 'ready-to-show') cb()
  }),
  show: vi.fn(),
  webContents: mockWebContents,
  loadURL: vi.fn(),
  loadFile: vi.fn()
}

// app.whenReady() callback – we capture it and invoke it manually later
let whenReadyCallback: (() => Promise<void>) | null = null

const mockPermissionRequestHandler = vi.fn()
const mockSession = {
  defaultSession: {
    setPermissionRequestHandler: mockPermissionRequestHandler,
    webRequest: {
      onBeforeSendHeaders: vi.fn()
    }
  }
}

const mockApp = {
  whenReady: vi.fn(() => ({
    then: (cb: () => Promise<void>) => {
      whenReadyCallback = cb
      return { catch: vi.fn() }
    }
  })),
  on: vi.fn(),
  isPackaged: false,
  getPath: vi.fn(() => '/tmp')
}

const mockShell = {
  openExternal: vi.fn()
}

const mockMenu = {
  buildFromTemplate: vi.fn(() => ({ popup: vi.fn() }))
}

const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn()
}

vi.mock('electron', () => {
  // Use a function constructor so `new BrowserWindow(...)` works
  function BrowserWindow(this: any, opts: Record<string, unknown>) {
    capturedBrowserWindowOptions = opts
    return mockBrowserWindowInstance
  }
  BrowserWindow.getAllWindows = vi.fn(() => [])

  return {
    app: mockApp,
    shell: mockShell,
    BrowserWindow,
    Menu: mockMenu,
    ipcMain: mockIpcMain,
    session: mockSession
  }
})

// Mock @electron-toolkit/utils – `is` controls dev vs prod code paths
const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: mockIs
}))

// Mock the database module so we don't need a real DB
vi.mock('../../src/main/database', () => ({
  initDatabase: vi.fn(async () => {}),
  closeDatabase: vi.fn(),
  getDatabase: vi.fn(() => ({}))
}))

// Mock settings.ipc for the webRequest interceptor
vi.mock('../../src/main/ipc/settings.ipc', () => ({
  createElectronSecureStorage: vi.fn(() => ({
    isAvailable: () => false,
    get: async () => null,
    set: async () => {},
    delete: async () => {}
  }))
}))

// Mock settings.service for the webRequest interceptor
vi.mock('../../src/main/services/settings.service', () => ({
  createSettingsService: vi.fn(() => ({
    getApiKey: async () => null
  }))
}))

// Mock the IPC registration module
vi.mock('../../src/main/ipc', () => ({
  registerIpcHandlers: vi.fn()
}))

// ---------------------------------------------------------------------------
// Helper – import the main entry file (triggers all side effects)
// ---------------------------------------------------------------------------

async function loadMainAndCreateWindow() {
  // Reset module registry so a fresh import triggers side effects again
  vi.resetModules()

  // Reset captured state
  capturedBrowserWindowOptions = null
  webContentsOnHandlers.clear()
  windowOpenHandler = null
  whenReadyCallback = null

  // Clear call counts but keep implementations
  mockWebContents.on.mockClear()
  mockWebContents.setWindowOpenHandler.mockClear()
  mockCloseDevTools.mockClear()
  mockBrowserWindowInstance.on.mockClear()
  mockPermissionRequestHandler.mockClear()
  mockApp.whenReady.mockClear()
  mockApp.on.mockClear()
  mockShell.openExternal.mockClear()

  // Re-wire implementations after mockClear
  mockWebContents.on.mockImplementation((event: string, handler: Function) => {
    webContentsOnHandlers.set(event, handler)
  })
  mockWebContents.setWindowOpenHandler.mockImplementation((handler: Function) => {
    windowOpenHandler = handler
  })
  mockBrowserWindowInstance.on.mockImplementation((_event: string, cb: Function) => {
    if (_event === 'ready-to-show') cb()
  })
  mockApp.whenReady.mockImplementation(() => ({
    then: (cb: () => Promise<void>) => {
      whenReadyCallback = cb
      return { catch: vi.fn() }
    }
  }))

  await import('../../src/main/index')

  // Trigger the whenReady callback (this invokes createWindow internally)
  if (whenReadyCallback) {
    await whenReadyCallback()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Main window security hardening', () => {
  // ---- BrowserWindow webPreferences -----------------------------------------

  describe('BrowserWindow webPreferences', () => {
    beforeEach(async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()
    })

    it('should enable sandbox', () => {
      expect(capturedBrowserWindowOptions).not.toBeNull()
      const prefs = (capturedBrowserWindowOptions as any).webPreferences
      expect(prefs.sandbox).toBe(true)
    })

    it('should enable contextIsolation', () => {
      const prefs = (capturedBrowserWindowOptions as any).webPreferences
      expect(prefs.contextIsolation).toBe(true)
    })

    it('should disable nodeIntegration', () => {
      const prefs = (capturedBrowserWindowOptions as any).webPreferences
      expect(prefs.nodeIntegration).toBe(false)
    })
  })

  // ---- Navigation guard (will-navigate) -------------------------------------

  describe('Navigation guard (will-navigate)', () => {
    it('should register a will-navigate handler', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()
      expect(webContentsOnHandlers.has('will-navigate')).toBe(true)
    })

    it('should block navigation to external URLs', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('will-navigate')!
      const event = { preventDefault: vi.fn() }

      handler(event, 'https://evil.example.com')
      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should block navigation to arbitrary http URLs', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('will-navigate')!
      const event = { preventDefault: vi.fn() }

      handler(event, 'http://phishing.site/login')
      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should allow navigation to ELECTRON_RENDERER_URL in development', async () => {
      mockIs.dev = true
      const devUrl = 'http://localhost:5173'
      process.env['ELECTRON_RENDERER_URL'] = devUrl

      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('will-navigate')!
      const event = { preventDefault: vi.fn() }

      handler(event, `${devUrl}/some-path`)
      expect(event.preventDefault).not.toHaveBeenCalled()

      delete process.env['ELECTRON_RENDERER_URL']
    })

    it('should block external URLs even in development mode', async () => {
      mockIs.dev = true
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'

      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('will-navigate')!
      const event = { preventDefault: vi.fn() }

      handler(event, 'https://external.example.com')
      expect(event.preventDefault).toHaveBeenCalled()

      delete process.env['ELECTRON_RENDERER_URL']
    })

    it('should block navigation when ELECTRON_RENDERER_URL is not set even in dev', async () => {
      mockIs.dev = true
      delete process.env['ELECTRON_RENDERER_URL']

      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('will-navigate')!
      const event = { preventDefault: vi.fn() }

      handler(event, 'http://localhost:5173/page')
      expect(event.preventDefault).toHaveBeenCalled()
    })
  })

  // ---- DevTools in production -----------------------------------------------

  describe('DevTools control', () => {
    it('should register devtools-opened handler when NOT in dev mode', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()

      expect(webContentsOnHandlers.has('devtools-opened')).toBe(true)
    })

    it('should close DevTools when devtools-opened fires in production', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()

      const handler = webContentsOnHandlers.get('devtools-opened')!
      handler()

      expect(mockCloseDevTools).toHaveBeenCalled()
    })

    it('should NOT register devtools-opened handler in dev mode', async () => {
      mockIs.dev = true
      await loadMainAndCreateWindow()

      expect(webContentsOnHandlers.has('devtools-opened')).toBe(false)
    })
  })

  // ---- Window open handler (setWindowOpenHandler) ---------------------------

  describe('Window open handler', () => {
    beforeEach(async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()
    })

    it('should deny all new window requests', () => {
      expect(windowOpenHandler).not.toBeNull()
      const result = windowOpenHandler!({ url: 'https://example.com' })
      expect(result).toEqual({ action: 'deny' })
    })

    it('should open https URLs externally via shell', () => {
      windowOpenHandler!({ url: 'https://docs.example.com' })
      expect(mockShell.openExternal).toHaveBeenCalledWith('https://docs.example.com')
    })

    it('should open http URLs externally via shell', () => {
      windowOpenHandler!({ url: 'http://example.com' })
      expect(mockShell.openExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('should NOT open non-http(s) URLs externally', () => {
      windowOpenHandler!({ url: 'file:///etc/passwd' })
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it('should NOT open javascript: URLs externally', () => {
      windowOpenHandler!({ url: 'javascript:alert(1)' })
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it('should handle invalid URLs gracefully', () => {
      const result = windowOpenHandler!({ url: 'not a valid url at all :::' })
      expect(result).toEqual({ action: 'deny' })
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })
  })

  // ---- Permission request handler ------------------------------------------

  describe('Permission request handler', () => {
    it('should deny all permission requests by default', async () => {
      mockIs.dev = false
      await loadMainAndCreateWindow()

      expect(mockPermissionRequestHandler).toHaveBeenCalledTimes(1)
      // Extract the handler function and verify it calls callback(false)
      const handlerFn = mockPermissionRequestHandler.mock.calls[0][0]
      const callback = vi.fn()
      handlerFn(null, 'camera', callback)
      expect(callback).toHaveBeenCalledWith(false)
    })
  })
})
