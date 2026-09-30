import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'
import { newProject, type EdgeData, type AppState, type Project, type StartTerminalRequest } from '@shared/types'
import type { ProjectStore } from './store/projectStore'
import type { TerminalService } from './terminals/terminalService'
import type { PtyManager } from './pty/ptyManager'
import { availableAgents } from './agents/adapters'
import { isExternalUrl } from './security'
import type { Topology, TopoNode } from './bridge/topology'
import type { BrowserManager } from './browser/manager'
import { runBrowserCommand } from './browser/commands'
import type { Orchestrator } from './bridge/orchestrator'
import { join } from 'node:path'
import { createAgentWorktree, gitRoot } from './git/worktree'

export function registerIpc(win: BrowserWindow, store: ProjectStore, terminals: TerminalService, pty: PtyManager, topology: Topology, browsers: BrowserManager, orchestrator: Orchestrator, dataDir: string): void {
  const send = (channel: string, ...args: unknown[]) => { if (!win.isDestroyed()) win.webContents.send(channel, ...args) }

  ipcMain.handle(IPC.projectsList, () => store.list())
  ipcMain.handle(IPC.projectsLoad, (_e, id: string) => store.load(id))
  ipcMain.handle(IPC.projectsSave, (_e, p: Project) => store.save(p))
  ipcMain.on(IPC.projectsSaveSync, (e, p: Project) => { store.save(p); e.returnValue = true })
  ipcMain.handle(IPC.projectsCreate, async () => {
    const picked = process.env.REGENTE_E2E_PICK_DIR
      ? [process.env.REGENTE_E2E_PICK_DIR]
      : (await dialog.showOpenDialog(win, { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] })).filePaths
    if (!picked || picked.length === 0) return null
    const p = newProject(randomUUID(), picked[0], new Date().toISOString(), store.list().length)
    store.save(p)
    return p
  })
  ipcMain.handle(IPC.appLoad, () => store.loadApp())
  ipcMain.handle(IPC.appSave, (_e, s: AppState) => store.saveApp(s))
  ipcMain.handle(IPC.agentsAvailable, () => availableAgents())
  const attempt = async (fn: () => Promise<unknown>) => {
    try { await fn(); return { ok: true } } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  }
  ipcMain.handle(IPC.browserOpen, (_e, nodeId: string) => attempt(() => runBrowserCommand(browsers, nodeId, 'open', [])))
  ipcMain.handle(IPC.browserClose, (_e, nodeId: string) => attempt(() => browsers.close(nodeId)))
  ipcMain.handle(IPC.browserGoto, (_e, nodeId: string, url: string) => attempt(async () => {
    await runBrowserCommand(browsers, nodeId, 'open', [])
    await runBrowserCommand(browsers, nodeId, 'goto', [url])
  }))
  browsers.on('state', (nodeId: string, state: unknown) => send(IPC.browserState, nodeId, state))
  ipcMain.handle(IPC.gitIsRepo, (_e, cwd: string) => gitRoot(cwd) !== null)
  ipcMain.handle(IPC.gitWorktree, (_e, projectId: string, cwd: string, name: string) => {
    try {
      return { ok: true, ...createAgentWorktree(join(dataDir, 'worktrees', projectId), cwd, name) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.on(IPC.termResume, (_e, id: string) => orchestrator.resume(id))
  ipcMain.on(IPC.topologyUpdate, (_e, projectId: string, nodes: TopoNode[], edges: EdgeData[]) => topology.update(projectId, nodes, edges))
  ipcMain.on(IPC.topologyRemove, (_e, projectId: string) => topology.remove(projectId))
  ipcMain.on(IPC.openExternal, (_e, url: string) => { if (isExternalUrl(url)) void shell.openExternal(url) })

  ipcMain.handle(IPC.termStart, (_e, req: StartTerminalRequest) => terminals.start(req))
  ipcMain.handle(IPC.termRestart, (_e, id: string) => terminals.restart(id))
  ipcMain.on(IPC.termWrite, (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on(IPC.termResize, (_e, id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  ipcMain.on(IPC.termKill, (_e, id: string) => terminals.kill(id))

  pty.on('data', (id: string, data: string) => send(IPC.termData, id, data))
  terminals.on('exit', (id: string, code: number) => send(IPC.termExit, id, code))
  terminals.on('notice', (id: string, msg: string) => send(IPC.termNotice, id, msg))
  terminals.on('session', (id: string, sid: string) => send(IPC.termSession, id, sid))
}
