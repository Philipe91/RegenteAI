import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ProjectStore } from './store/projectStore'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePty'
import { TerminalService } from './terminals/terminalService'
import { adapters } from './agents/adapters'
import { registerIpc } from './ipc'
import { guardWebContents } from './security'
import { Bridge } from './bridge/bridge'
import { Topology } from './bridge/topology'
import { RegenteIntegration } from './bridge/integration'
import { registerBridgeRoutes } from './bridge/routes'
import { AskBroker } from './bridge/askBroker'
import { IPC } from '@shared/ipc'

const dataDir = process.env.REGENTE_DATA_DIR ?? join(app.getPath('appData'), 'Regente')
// A trava de instância única vale por pasta de dados (testes usam pastas próprias).
if (process.env.REGENTE_DATA_DIR) app.setPath('userData', join(dataDir, 'electron'))

if (!app.requestSingleInstanceLock()) {
  // Já existe um Regente aberto: dois retomariam as mesmas sessões do Claude ao mesmo tempo.
  app.exit(0)
} else {
  const store = new ProjectStore(dataDir)
  const pty = new PtyManager(nodePtyFactory)
  const bridge = new Bridge()
  const topology = new Topology()
  let win: BrowserWindow | null = null

  const start = async (): Promise<void> => {
    const url = await bridge.listen()
    const integration = new RegenteIntegration(bridge, url, dataDir, process.execPath, join(__dirname, 'cli.js'))
    const terminals = new TerminalService(pty, adapters, undefined, process.env, integration)
    const broker = new AskBroker({
      topology,
      isRunning: (id) => pty.isRunning(id),
      write: (id, data) => pty.write(id, data),
      onData: (cb) => pty.on('data', cb),
      onGone: (cb) => terminals.on('gone', cb),
      supportsHooks: (id) => topology.node(id)?.node.agent === 'claude'
    })
    registerBridgeRoutes(bridge, { topology, pty, broker })

    win = new BrowserWindow({
      width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    guardWebContents(win.webContents, (u) => void shell.openExternal(u))
    registerIpc(win, store, terminals, pty, topology)
    const send = (channel: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args) }
    broker.on('status', (id: string, s: string) => send(IPC.termStatus, id, s))
    broker.on('flow', (from: string, to: string, active: boolean) => send(IPC.termFlow, from, to, active))
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(start)
  app.on('before-quit', () => { pty.killAll(); void bridge.close() })
  app.on('window-all-closed', () => app.quit())
}
