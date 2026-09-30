import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ProjectStore } from './store/projectStore'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePty'
import { TerminalService } from './terminals/terminalService'
import { adapters } from './agents/adapters'
import { registerIpc } from './ipc'
import { guardWebContents } from './security'

const dataDir = process.env.REGENTE_DATA_DIR ?? join(app.getPath('appData'), 'Regente')
// A trava de instância única vale por pasta de dados (testes usam pastas próprias).
if (process.env.REGENTE_DATA_DIR) app.setPath('userData', join(dataDir, 'electron'))

if (!app.requestSingleInstanceLock()) {
  // Já existe um Regente aberto: dois retomariam as mesmas sessões do Claude ao mesmo tempo.
  app.exit(0)
} else {
  const store = new ProjectStore(dataDir)
  const pty = new PtyManager(nodePtyFactory)
  const terminals = new TerminalService(pty, adapters)
  let win: BrowserWindow | null = null

  const createWindow = (): void => {
    win = new BrowserWindow({
      width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    guardWebContents(win.webContents, (url) => void shell.openExternal(url))
    registerIpc(win, store, terminals, pty)
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(createWindow)
  app.on('before-quit', () => pty.killAll())
  app.on('window-all-closed', () => app.quit())
}
