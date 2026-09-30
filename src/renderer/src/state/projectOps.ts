import type { RoleId } from '@shared/roles'
import type { AgentId, BrowserNodeData, CanvasNodeData, Project, TerminalNodeData, Viewport } from '@shared/types'

export const DEFAULT_TERMINAL_SIZE = { width: 640, height: 400 }
export const DEFAULT_BROWSER_SIZE = { width: 460, height: 340 }
const MIN_W = 240
const MIN_H = 140

export interface NewTerminalInput { agent: AgentId; name: string; color: string; command?: string; role?: RoleId; x: number; y: number }

export function addTerminal(p: Project, input: NewTerminalInput, id: string, now: string): Project {
  const node: TerminalNodeData = { id, kind: 'terminal', ...input, ...DEFAULT_TERMINAL_SIZE }
  if (!input.command) delete node.command
  if (!input.role) delete node.role
  return { ...p, nodes: [...p.nodes, node], updatedAt: now }
}

export function addBrowser(p: Project, input: { name: string; color: string; x: number; y: number }, id: string, now: string): Project {
  const node: BrowserNodeData = { id, kind: 'browser', ...input, ...DEFAULT_BROWSER_SIZE }
  return { ...p, nodes: [...p.nodes, node], updatedAt: now }
}

export function removeNode(p: Project, nodeId: string, now: string): Project {
  return {
    ...p,
    nodes: p.nodes.filter((n) => n.id !== nodeId),
    edges: p.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    updatedAt: now
  }
}

const valid = (v: number | undefined, min: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min

export function updateGeometry(p: Project, nodeId: string, geo: Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>, now: string): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) => n.id !== nodeId ? n : {
      ...n,
      x: valid(geo.x, -1e7) ? geo.x : n.x,
      y: valid(geo.y, -1e7) ? geo.y : n.y,
      width: valid(geo.width, MIN_W) ? geo.width : n.width,
      height: valid(geo.height, MIN_H) ? geo.height : n.height
    }),
    updatedAt: now
  }
}

export function setSessionId(p: Project, nodeId: string, sessionId: string, now: string): Project {
  return { ...p, nodes: p.nodes.map((n) => (n.id === nodeId && n.kind === 'terminal' ? { ...n, sessionId } : n)), updatedAt: now }
}

export function setViewport(p: Project, vp: Viewport, now: string): Project {
  return { ...p, viewport: vp, updatedAt: now }
}

const GAP = 24

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: CanvasNodeData) =>
  a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP

/** Onde colocar um nó novo sem cobrir nenhum outro: se o lugar estiver ocupado, vai para a direita de quem ocupa. */
export function findFreeSpot(
  nodes: CanvasNodeData[],
  pos: { x: number; y: number },
  size: { width: number; height: number } = DEFAULT_TERMINAL_SIZE
): { x: number; y: number } {
  const spot = { x: pos.x, y: pos.y }
  for (;;) {
    const hit = nodes.filter((n) => overlaps({ ...spot, ...size }, n))
    if (hit.length === 0) return spot
    spot.x = Math.max(...hit.map((n) => n.x + n.width)) + GAP
  }
}

export type GeometryUpdate = { id: string } & Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>

/** Salva de uma vez a geometria de vários nós (ex.: arrastar uma seleção). */
export function updateGeometries(p: Project, updates: GeometryUpdate[], now: string): Project {
  return updates.reduce((acc, { id, ...geo }) => updateGeometry(acc, id, geo, now), p)
}

export function projectIdForNode(projects: Record<string, Project>, nodeId: string): string | null {
  return Object.values(projects).find((p) => p.nodes.some((n) => n.id === nodeId))?.id ?? null
}

/** Liga dois nós com uma corda (sem duplicar, sem laço, só entre nós que existem). */
export function addEdge(p: Project, source: string, target: string, id: string, now: string): Project {
  if (source === target) return p
  if (!p.nodes.some((n) => n.id === source) || !p.nodes.some((n) => n.id === target)) return p
  const exists = p.edges.some((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source))
  if (exists) return p
  return { ...p, edges: [...p.edges, { id, source, target }], updatedAt: now }
}

export function removeEdge(p: Project, edgeId: string, now: string): Project {
  return { ...p, edges: p.edges.filter((e) => e.id !== edgeId), updatedAt: now }
}
