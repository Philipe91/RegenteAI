import type { AgentId, Project, TerminalNodeData, Viewport } from '@shared/types'

export const DEFAULT_TERMINAL_SIZE = { width: 640, height: 400 }
const MIN_W = 240
const MIN_H = 140

export interface NewTerminalInput { agent: AgentId; name: string; color: string; command?: string; x: number; y: number }

export function addTerminal(p: Project, input: NewTerminalInput, id: string, now: string): Project {
  const node: TerminalNodeData = { id, kind: 'terminal', ...input, ...DEFAULT_TERMINAL_SIZE }
  if (!input.command) delete node.command
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
  return { ...p, nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, sessionId } : n)), updatedAt: now }
}

export function setViewport(p: Project, vp: Viewport, now: string): Project {
  return { ...p, viewport: vp, updatedAt: now }
}
