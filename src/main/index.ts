import { app, BrowserWindow, Notification, shell } from 'electron'
import { notificationFor } from './notify/notify'
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
import { BrowserManager } from './browser/manager'
import { chooseBrowser, detectBrowsers, readDefaultProgId } from './browser/detect'

const dataDir = process.env.REGENTE_DATA_DIR ?? join(app.getPath('appData'), 'Regente')
// A trava de instância única vale por pasta de dados (testes usam pastas próprias).
if (process.env.REGENTE_DATA_DIR) app.setPath('userData', join(dataDir, 'electron'))

// Necessário para as notificações do Windows mostrarem o nome certo.
app.setAppUserModelId('com.regente.app')

if (!app.requestSingleInstanceLock()) {
  // Já existe um Regente aberto: dois retomariam as mesmas sessões do Claude ao mesmo tempo.
  app.exit(0)
} else {
  const store = new ProjectStore(dataDir)
  const pty = new PtyManager(nodePtyFactory)
  const bridge = new Bridge()
  const topology = new Topology()
  const browsers = new BrowserManager({
    profilesDir: join(dataDir, 'browsers'),
    resolveBrowser: () => chooseBrowser(store.loadApp().browser ?? 'auto', detectBrowsers(), readDefaultProgId())
  })
  let win: BrowserWindow | null = null

  const start = async (): Promise<void> => {
    const url = await bridge.listen()
    const integration = new RegenteIntegration(bridge, url, dataDir, process.execPath, join(__dirname, 'cli.js').replace('app.asar', 'app.asar.unpacked'))
    const terminals = new TerminalService(pty, adapters, undefined, process.env, integration)
    const broker = new AskBroker({
      topology,
      isRunning: (id) => pty.isRunning(id),
      write: (id, data) => pty.write(id, data),
      onData: (cb) => pty.on('data', cb),
      onGone: (cb) => terminals.on('gone', cb),
      supportsHooks: (id) => topology.node(id)?.node.agent === 'claude'
    })
    const flow = (from: string, to: string, active: boolean) => { if (win && !win.isDestroyed()) win.webContents.send(IPC.termFlow, from, to, active) }
    terminals.on('spawned', (id: string) => broker.markStarting(id))
    registerBridgeRoutes(bridge, {
      topology, pty, broker, browsers, onFlow: flow,
      onNoteChange: (nodeId, text) => { if (win && !win.isDestroyed()) win.webContents.send(IPC.noteUpdate, nodeId, text) }
    })

    win = new BrowserWindow({
      width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    guardWebContents(win.webContents, (u) => void shell.openExternal(u))
    registerIpc(win, store, terminals, pty, topology, browsers)
    const send = (channel: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args) }
    broker.on('status', (id: string, s: string) => send(IPC.termStatus, id, s))
    broker.on('turn-end', (id: string, message: string) => {
      const name = topology.node(id)?.node.name
      if (!name || !win || win.isDestroyed() || !Notification.isSupported()) return
      const n = notificationFor({ name, message, focused: win.isFocused() && !win.isMinimized() && win.isVisible(), enabled: store.loadApp().notify !== false })
      if (!n) return
      const toast = new Notification({ title: n.title, body: n.body, silent: false })
      toast.on('click', () => {
        if (!win || win.isDestroyed()) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        send(IPC.termFocus, id)
      })
      toast.show()
      console.log(`[regente] notificação: ${n.title} — ${n.body}`)
    })
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
  // Ao sair, espera os navegadores fecharem de verdade (no Windows eles sobreviveriam ao app).
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    pty.killAll()
    void Promise.race([browsers.closeAll(), new Promise((r) => setTimeout(r, 4000))]).finally(() => {
      void bridge.close()
      app.exit(0)
    })
  })
  app.on('window-all-closed', () => app.quit())
}
