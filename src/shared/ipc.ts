import type { BrowserUiState, EdgeData, AgentInfo, AppState, LoadResult, Project, ProjectSummary, StartTerminalRequest, StartTerminalResult } from './types'

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
  openExternal: 'shell:open-external',
  topologyUpdate: 'topology:update',
  termStatus: 'term:status',
  termFocus: 'term:focus',
  termQueue: 'term:queue',
  termPaused: 'term:paused',
  termResume: 'term:resume',
  noteUpdate: 'note:update',
  gitIsRepo: 'git:is-repo',
  gitWorktree: 'git:worktree',
  browserOpen: 'browser:open',
  browserClose: 'browser:close',
  browserGoto: 'browser:goto',
  browserState: 'browser:state',
  termFlow: 'term:flow',
  topologyRemove: 'topology:remove'
} as const

export interface RegenteApi {
  /** Abre http(s)/mailto no navegador do sistema; qualquer outra coisa é ignorada. */
  openExternal(url: string): void
  browser: {
    open(nodeId: string): Promise<{ ok: boolean; error?: string }>
    close(nodeId: string): Promise<{ ok: boolean; error?: string }>
    goto(nodeId: string, url: string): Promise<{ ok: boolean; error?: string }>
    onState(cb: (nodeId: string, state: BrowserUiState) => void): () => void
  }
  note: { onUpdate(cb: (nodeId: string, text: string) => void): () => void }
  git: {
    isRepo(cwd: string): Promise<boolean>
    /** Cria a pasta isolada (git worktree) de um agente novo. */
    worktree(projectId: string, cwd: string, name: string): Promise<{ ok: true; path: string; branch: string } | { ok: false; error: string }>
  }
  topology: {
    update(projectId: string, nodes: Array<{ id: string; name: string; agent: string; kind: 'terminal' | 'browser' | 'note'; text?: string; branch?: string }>, edges: EdgeData[]): void
    remove(projectId: string): void
  }
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
    onStatus(cb: (id: string, status: 'idle' | 'working' | 'starting' | 'needs-user') => void): () => void
    onQueue(cb: (id: string, size: number) => void): () => void
    onPaused(cb: (id: string, paused: boolean) => void): () => void
    /** Retoma as entregas de um terminal pausado pelo freio de laços. */
    resume(id: string): void
    onFlow(cb: (from: string, to: string, active: boolean) => void): () => void
    onFocus(cb: (id: string) => void): () => void
  }
}
