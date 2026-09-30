import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import * as pty from 'node-pty'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // Prova temporária (substituída na Task 6): node-pty carrega dentro do Electron.
  const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo regente-pty-ok'], { cols: 80, rows: 24, cwd: process.cwd(), env: process.env as Record<string, string> })
  p.onData((d) => { if (d.includes('regente-pty-ok')) console.log('[regente] node-pty OK') })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
