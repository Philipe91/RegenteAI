import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ProjectStore } from './store/projectStore'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePty'
import { TerminalService } from './terminals/terminalService'
import { adapters } from './agents/adapters'
import { registerIpc } from './ipc'

const dataDir = process.env.REGENTE_DATA_DIR ?? join(app.getPath('appData'), 'Regente')
const store = new ProjectStore(dataDir)
const pty = new PtyManager(nodePtyFactory)
const terminals = new TerminalService(pty, adapters)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  registerIpc(win, store, terminals, pty)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('before-quit', () => pty.killAll())
app.on('window-all-closed', () => app.quit())
