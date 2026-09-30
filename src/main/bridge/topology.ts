import type { EdgeData } from '@shared/types'

export interface TopoNode { id: string; name: string; agent: string; kind: 'terminal' | 'browser' }

interface ProjectTopo { nodes: TopoNode[]; edges: EdgeData[] }

const norm = (s: string) => s.trim().toLocaleLowerCase('pt-BR')

/** Quem existe e quem está ligado a quem, por projeto. O renderer envia a cada mudança. */
export class Topology {
  private projects = new Map<string, ProjectTopo>()

  update(projectId: string, nodes: TopoNode[], edges: EdgeData[]): void {
    this.projects.set(projectId, { nodes, edges })
  }

  remove(projectId: string): void {
    this.projects.delete(projectId)
  }

  node(id: string): { projectId: string; node: TopoNode } | null {
    for (const [projectId, p] of this.projects) {
      const node = p.nodes.find((n) => n.id === id)
      if (node) return { projectId, node }
    }
    return null
  }

  peers(id: string): TopoNode[] {
    const owner = this.node(id)
    if (!owner) return []
    const p = this.projects.get(owner.projectId)!
    const ids = new Set(p.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])))
    return p.nodes.filter((n) => ids.has(n.id))
  }

  /** O navegador ligado a este terminal (o primeiro, se houver mais de um). */
  browserPeer(id: string): TopoNode {
    const b = this.peers(id).find((n) => n.kind === 'browser')
    if (!b) throw new Error('Nenhum navegador ligado a você. No canvas, clique em "+ Navegador" e ligue-o a este terminal com uma corda.')
    return b
  }

  findPeer(id: string, name: string): TopoNode | null {
    return this.peers(id).find((n) => norm(n.name) === norm(name)) ?? null
  }
}
