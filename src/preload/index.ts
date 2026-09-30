import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type RegenteApi } from '@shared/ipc'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RegenteApi = {
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    load: (id) => ipcRenderer.invoke(IPC.projectsLoad, id),
    save: (p) => ipcRenderer.invoke(IPC.projectsSave, p),
    saveSync: (p) => { ipcRenderer.sendSync(IPC.projectsSaveSync, p) },
    create: () => ipcRenderer.invoke(IPC.projectsCreate)
  },
  app: {
    load: () => ipcRenderer.invoke(IPC.appLoad),
    save: (s) => ipcRenderer.invoke(IPC.appSave, s)
  },
  agents: { available: () => ipcRenderer.invoke(IPC.agentsAvailable) },
  term: {
    start: (req) => ipcRenderer.invoke(IPC.termStart, req),
    restart: (id) => ipcRenderer.invoke(IPC.termRestart, id),
    write: (id, data) => ipcRenderer.send(IPC.termWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.termResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.termKill, id),
    onData: (cb) => listen(IPC.termData, cb),
    onExit: (cb) => listen(IPC.termExit, cb),
    onNotice: (cb) => listen(IPC.termNotice, cb),
    onSession: (cb) => listen(IPC.termSession, cb)
  }
}

contextBridge.exposeInMainWorld('regente', api)
