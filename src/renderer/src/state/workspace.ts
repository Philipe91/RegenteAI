import { create } from 'zustand'
import type { AgentInfo, Project, TerminalNodeData, Viewport } from '@shared/types'
import * as ops from './projectOps'
import { createSaver } from './saver'

export interface Toast { id: number; message: string }

interface WorkspaceState {
  ready: boolean
  projects: Record<string, Project>
  openIds: string[]
  activeId: string | null
  agents: AgentInfo[]
  toasts: Toast[]
  init(): Promise<void>
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

const saver = createSaver((p) => { void window.regente.projects.save(p) }, 400)
const now = () => new Date().toISOString()
let toastSeq = 0

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const saveApp = () => {
    const { openIds, activeId } = get()
    void window.regente.app.save({ version: 1, openProjectIds: openIds, activeProjectId: activeId })
  }
  const mutate = (projectId: string, fn: (p: Project) => Project) => {
    const p = get().projects[projectId]
    if (!p) return
    const next = fn(p)
    set({ projects: { ...get().projects, [projectId]: next } })
    saver.schedule(next)
  }

  return {
    ready: false, projects: {}, openIds: [], activeId: null, agents: [], toasts: [],

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
      // A sessão pode mudar com o terminal fora da tela (aba em segundo plano): registra onde ele estiver.
      window.regente.term.onSession((nodeId, sid) => {
        const pid = ops.projectIdForNode(get().projects, nodeId)
        if (pid) get().setSessionId(pid, nodeId, sid)
      })
      const openIds = appState.openProjectIds.filter((id) => projects[id])
      const activeId = appState.activeProjectId && projects[appState.activeProjectId] ? appState.activeProjectId : openIds[0] ?? null
      set({ ready: true, projects, openIds, activeId, agents })
    },

    async createProject() {
      const p = await window.regente.projects.create()
      if (!p) return
      set({ projects: { ...get().projects, [p.id]: p }, openIds: [...get().openIds, p.id], activeId: p.id })
      saveApp()
    },

    async openProject(id) {
      if (get().openIds.includes(id)) { get().setActive(id); return }
      const r = await window.regente.projects.load(id)
      if (r.warning) get().toast(r.warning)
      if (!r.project) return
      set({ projects: { ...get().projects, [id]: r.project }, openIds: [...get().openIds, id], activeId: id })
      saveApp()
    },

    closeProject(id) {
      const p = get().projects[id]
      if (!p) return
      saver.flush()
      p.nodes.forEach((n) => window.regente.term.kill(n.id))
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
      window.regente.term.kill(nodeId)
      mutate(projectId, (p) => ops.removeNode(p, nodeId, now()))
    },

    updateGeometry(projectId, nodeId, geo) { mutate(projectId, (p) => ops.updateGeometry(p, nodeId, geo, now())) },
    moveNodes(projectId, updates) { mutate(projectId, (p) => ops.updateGeometries(p, updates, now())) },
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
