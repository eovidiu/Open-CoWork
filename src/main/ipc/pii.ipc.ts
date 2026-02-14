import { ipcMain } from 'electron'
import { scanForPii } from '../services/pii-scanner'
import { secureHandler } from './ipc-security'

export function registerPiiHandlers(): void {
  ipcMain.handle(
    'pii:scan',
    secureHandler(async (_, text: string) => {
      if (typeof text !== 'string') {
        return { hasPii: false, matches: [] }
      }
      const matches = scanForPii(text)
      return {
        hasPii: matches.length > 0,
        matches
      }
    })
  )
}
