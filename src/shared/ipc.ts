import type { AgentInfo, AppState, LoadResult, Project, ProjectSummary, StartTerminalRequest, StartTerminalResult } from './types'

export const IPC = {
  projectsList: 'projects:list',
  projectsLoad: 'projects:load',
  projectsSave: 'projects:save',
  projectsSaveSync: 'projects:save-sync',
  projectsCreate: 'projects:create',
  appLoad: 'app:load',
  appSave: 'app:save',
  agentsAvailable: 'agents:available',
  termStart: 'term:start',
  termRestart: 'term:restart',
  termWrite: 'term:write',
  termResize: 'term:resize',
  termKill: 'term:kill',
  termData: 'term:data',
  termExit: 'term:exit',
  termNotice: 'term:notice',
  termSession: 'term:session',
  openExternal: 'shell:open-external'
} as const

export interface RegenteApi {
  /** Abre http(s)/mailto no navegador do sistema; qualquer outra coisa é ignorada. */
  openExternal(url: string): void
  projects: {
    list(): Promise<ProjectSummary[]>
    load(id: string): Promise<LoadResult>
    save(p: Project): Promise<void>
    saveSync(p: Project): void
    create(): Promise<Project | null>
  }
  app: { load(): Promise<AppState>; save(s: AppState): Promise<void> }
  agents: { available(): Promise<AgentInfo[]> }
  term: {
    start(req: StartTerminalRequest): Promise<StartTerminalResult>
    restart(id: string): Promise<StartTerminalResult | null>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
    onNotice(cb: (id: string, message: string) => void): () => void
    onSession(cb: (id: string, sessionId: string) => void): () => void
  }
}
