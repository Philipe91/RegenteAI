import { create } from 'zustand'
import type { AgentInfo, BrowserPref, BrowserUiState, Project, TerminalNodeData, Viewport } from '@shared/types'
import * as ops from './projectOps'
import { createSaver } from './saver'

export interface Toast { id: number; message: string }

/** Estado ao vivo de cada terminal (não é salvo). */
export type Activity = 'working' | 'attention'

interface WorkspaceState {
  ready: boolean
  projects: Record<string, Project>
  openIds: string[]
  activeId: string | null
  agents: AgentInfo[]
  toasts: Toast[]
  activity: Record<string, Activity>
  flows: Record<string, true>
  browserStates: Record<string, BrowserUiState>
  browserPref: BrowserPref
  setBrowserPref(pref: BrowserPref): void
  addBrowser(projectId: string, input: { name: string; color: string; x: number; y: number }): void
  init(): Promise<void>
  connect(projectId: string, source: string, target: string): void
  disconnect(projectId: string, edgeId: string): void
  markSeen(nodeId: string): void
  createProject(): Promise<void>
  openProject(id: string): Promise<void>
  closeProject(id: string): void
  setActive(id: string): void
  addTerminal(projectId: string, input: ops.NewTerminalInput): void
  removeNode(projectId: string, nodeId: string): void
  updateGeometry(projectId: string, nodeId: string, geo: Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>): void
  moveNodes(projectId: string, updates: ops.GeometryUpdate[]): void
  setViewport(projectId: string, vp: Viewport): void
  setSessionId(projectId: string, nodeId: string, sessionId: string): void
  toast(message: string): void
  dismissToast(id: number): void
  flushSaves(): void
}

/** O motor precisa saber nomes e cordas para o `regente peers/ask/browser`. */
const syncTopology = (p: Project) =>
  window.regente.topology.update(p.id, p.nodes.map((n) => ({ id: n.id, name: n.name, agent: n.kind === 'terminal' ? n.agent : 'browser', kind: n.kind })), p.edges)

const saver = createSaver((p) => { void window.regente.projects.save(p) }, 400)
const now = () => new Date().toISOString()
let toastSeq = 0

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const saveApp = () => {
    const { openIds, activeId } = get()
    void window.regente.app.save({ version: 1, openProjectIds: openIds, activeProjectId: activeId, browser: get().browserPref })
  }
  const mutate = (projectId: string, fn: (p: Project) => Project) => {
    const p = get().projects[projectId]
    if (!p) return
    const next = fn(p)
    set({ projects: { ...get().projects, [projectId]: next } })
    saver.schedule(next)
    syncTopology(next)
  }

  return {
    ready: false, projects: {}, openIds: [], activeId: null, agents: [], toasts: [], activity: {}, flows: {}, browserStates: {}, browserPref: 'auto',

    async init() {
      const [appState, agents] = await Promise.all([window.regente.app.load(), window.regente.agents.available()])
      const projects: Record<string, Project> = {}
      for (const id of appState.openProjectIds) {
        try {
          const r = await window.regente.projects.load(id)
          if (r.project) projects[id] = r.project
          if (r.warning) get().toast(r.warning)
        } catch (e) {
          get().toast(`Não foi possível abrir o projeto ${id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      window.regente.term.onStatus((nodeId, status) => {
        const { [nodeId]: prev, ...rest } = get().activity
        if (status === 'working') set({ activity: { ...rest, [nodeId]: 'working' } })
        else set({ activity: prev === 'working' ? { ...rest, [nodeId]: 'attention' } : rest })
      })
      window.regente.browser.onState((nodeId, state) => {
        const prev = get().browserStates[nodeId]
        // Mantém a última prévia enquanto não chega outra (ex.: estado sem print).
        const preview = state.status === 'open' ? state.preview ?? prev?.preview : undefined
        set({ browserStates: { ...get().browserStates, [nodeId]: { ...state, preview } } })
      })
      window.regente.term.onFlow((from, to, active) => {
        const key = [from, to].sort().join('|')
        const { [key]: _old, ...rest } = get().flows
        set({ flows: active ? { ...rest, [key]: true } : rest })
      })
      // A sessão pode mudar com o terminal fora da tela (aba em segundo plano): registra onde ele estiver.
      window.regente.term.onSession((nodeId, sid) => {
        const pid = ops.projectIdForNode(get().projects, nodeId)
        if (pid) get().setSessionId(pid, nodeId, sid)
      })
      const openIds = appState.openProjectIds.filter((id) => projects[id])
      const activeId = appState.activeProjectId && projects[appState.activeProjectId] ? appState.activeProjectId : openIds[0] ?? null
      Object.values(projects).forEach(syncTopology)
      set({ ready: true, projects, openIds, activeId, agents, browserPref: appState.browser ?? 'auto' })
    },

    async createProject() {
      const p = await window.regente.projects.create()
      if (!p) return
      syncTopology(p)
      set({ projects: { ...get().projects, [p.id]: p }, openIds: [...get().openIds, p.id], activeId: p.id })
      saveApp()
    },

    async openProject(id) {
      if (get().openIds.includes(id)) { get().setActive(id); return }
      const r = await window.regente.projects.load(id)
      if (r.warning) get().toast(r.warning)
      if (!r.project) return
      syncTopology(r.project)
      set({ projects: { ...get().projects, [id]: r.project }, openIds: [...get().openIds, id], activeId: id })
      saveApp()
    },

    closeProject(id) {
      const p = get().projects[id]
      if (!p) return
      saver.flush()
      p.nodes.forEach((n) => (n.kind === 'browser' ? void window.regente.browser.close(n.id) : window.regente.term.kill(n.id)))
      window.regente.topology.remove(id)
      const idx = get().openIds.indexOf(id)
      const openIds = get().openIds.filter((x) => x !== id)
      const { [id]: _closed, ...projects } = get().projects
      const activeId = get().activeId === id ? openIds[Math.min(idx, openIds.length - 1)] ?? null : get().activeId
      set({ projects, openIds, activeId })
      saveApp()
    },

    setActive(id) { set({ activeId: id }); saveApp() },

    addTerminal(projectId, input) { mutate(projectId, (p) => ops.addTerminal(p, input, crypto.randomUUID(), now())) },

    removeNode(projectId, nodeId) {
      const node = get().projects[projectId]?.nodes.find((n) => n.id === nodeId)
      if (node?.kind === 'browser') void window.regente.browser.close(nodeId)
      else window.regente.term.kill(nodeId)
      mutate(projectId, (p) => ops.removeNode(p, nodeId, now()))
    },

    updateGeometry(projectId, nodeId, geo) { mutate(projectId, (p) => ops.updateGeometry(p, nodeId, geo, now())) },
    moveNodes(projectId, updates) { mutate(projectId, (p) => ops.updateGeometries(p, updates, now())) },
    setBrowserPref(pref) { set({ browserPref: pref }); saveApp() },
    addBrowser(projectId, input) { mutate(projectId, (p) => ops.addBrowser(p, input, crypto.randomUUID(), now())) },
    connect(projectId, source, target) { mutate(projectId, (p) => ops.addEdge(p, source, target, crypto.randomUUID(), now())) },
    disconnect(projectId, edgeId) { mutate(projectId, (p) => ops.removeEdge(p, edgeId, now())) },
    markSeen(nodeId) {
      if (get().activity[nodeId] !== 'attention') return
      const { [nodeId]: _seen, ...rest } = get().activity
      set({ activity: rest })
    },
    setViewport(projectId, vp) { mutate(projectId, (p) => ops.setViewport(p, vp, now())) },
    setSessionId(projectId, nodeId, sid) { mutate(projectId, (p) => ops.setSessionId(p, nodeId, sid, now())) },

    toast(message) {
      const id = ++toastSeq
      set({ toasts: [...get().toasts, { id, message }] })
      setTimeout(() => get().dismissToast(id), 8000)
    },
    dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },

    flushSaves() {
      saver.flush()
      Object.values(get().projects).forEach((p) => window.regente.projects.saveSync(p))
    }
  }
})
