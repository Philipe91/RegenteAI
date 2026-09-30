import type { RoleId } from './roles'

export const PROJECT_VERSION = 1
export const APP_VERSION = 1

export type AgentId = 'claude' | 'shell' | 'custom'

export interface TerminalNodeData {
  id: string
  kind: 'terminal'
  agent: AgentId
  name: string
  color: string
  x: number
  y: number
  width: number
  height: number
  sessionId?: string
  command?: string
  role?: RoleId
}

/** Nó que representa o navegador real do usuário, controlado pelos agentes ligados a ele. */
export interface BrowserNodeData {
  id: string
  kind: 'browser'
  name: string
  color: string
  x: number
  y: number
  width: number
  height: number
}

export type CanvasNodeData = TerminalNodeData | BrowserNodeData

export type BrowserPref = 'auto' | 'chrome' | 'edge' | 'brave'
export const BROWSER_PREFS: BrowserPref[] = ['auto', 'chrome', 'edge', 'brave']

/** O que a interface mostra de um nó Navegador (vem do motor). */
export interface BrowserUiState {
  status: 'opening' | 'open' | 'closed'
  browser?: string
  title?: string
  url?: string
  note?: string
  preview?: string
}

export interface EdgeData { id: string; source: string; target: string }
export interface Viewport { x: number; y: number; zoom: number }

export interface Project {
  version: number
  id: string
  name: string
  cwd: string
  color: string
  nodes: CanvasNodeData[]
  edges: EdgeData[]
  viewport: Viewport
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary { id: string; name: string; cwd: string; color: string; updatedAt: string }

export interface AppState { version: number; openProjectIds: string[]; activeProjectId: string | null; browser?: BrowserPref }

export interface AgentInfo { id: AgentId; label: string; available: boolean }

export type LoadResult = { project: Project; warning?: string } | { project: null; warning: string }

export const PROJECT_COLORS = ['#F25C1F', '#3B82F6', '#10B981', '#A855F7', '#EAB308', '#EC4899', '#14B8A6']

export function newProject(id: string, cwd: string, now: string, colorIndex: number): Project {
  const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd
  return {
    version: PROJECT_VERSION, id, name, cwd,
    color: PROJECT_COLORS[colorIndex % PROJECT_COLORS.length],
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now, updatedAt: now
  }
}

export interface StartTerminalRequest { projectId: string; cwd: string; node: TerminalNodeData; cols: number; rows: number }
export interface StartTerminalResult { buffer: string; sessionId?: string; error?: string; exitCode?: number }
