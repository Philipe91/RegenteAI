import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, ConnectionMode, Controls, MiniMap, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type XYPosition } from '@xyflow/react'
import { RopeEdge, type RopeFlowEdge } from './RopeEdge'
import '@xyflow/react/dist/style.css'
import type { CanvasNodeData, Project } from '@shared/types'
import { BrowserNode, type BrowserFlowNode } from './BrowserNode'
import { useWorkspace } from '../state/workspace'
import { DEFAULT_BROWSER_SIZE, DEFAULT_TERMINAL_SIZE, findFreeSpot } from '../state/projectOps'
import { TerminalNode, type TerminalFlowNode } from './TerminalNode'
import { NewTerminalModal } from './NewTerminalModal'

const nodeTypes = { terminal: TerminalNode, browser: BrowserNode }
type FlowNode = TerminalFlowNode | BrowserFlowNode
const edgeTypes = { rope: RopeEdge }

function toFlow(n: CanvasNodeData, project: Project, selected = false): FlowNode {
  const base = { id: n.id, position: { x: n.x, y: n.y }, width: n.width, height: n.height, dragHandle: '.term-header', selected }
  return n.kind === 'browser'
    ? { ...base, type: 'browser', data: { browser: n, projectId: project.id } }
    : { ...base, type: 'terminal', data: { term: n, projectId: project.id, cwd: project.cwd } }
}

function CanvasInner({ project }: { project: Project }) {
  const addTerminal = useWorkspace((s) => s.addTerminal)
  const addBrowser = useWorkspace((s) => s.addBrowser)
  const moveNodes = useWorkspace((s) => s.moveNodes)
  const connect = useWorkspace((s) => s.connect)
  const disconnect = useWorkspace((s) => s.disconnect)
  const markSeen = useWorkspace((s) => s.markSeen)
  const flows = useWorkspace((s) => s.flows)
  const focusRequest = useWorkspace((s) => s.focusRequest)
  const edges = useMemo<RopeFlowEdge[]>(() => project.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: 'rope',
    data: { active: Boolean(flows[[e.source, e.target].sort().join('|')]), onRemove: () => disconnect(project.id, e.id) }
  })), [project.edges, project.id, flows, disconnect])
  const setViewport = useWorkspace((s) => s.setViewport)
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(project.nodes.map((n) => toFlow(n, project)))
  const [modalAt, setModalAt] = useState<XYPosition | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  // Store → React Flow (criação, remoção, sessão). A posição do arrasto volta ao store só no fim do gesto.
  useEffect(() => {
    setNodes((prev) => project.nodes.map((n) => toFlow(n, project, prev.find((p) => p.id === n.id)?.selected ?? false)))
  }, [project, setNodes])

  // Clique numa notificação: centraliza o nó que terminou.
  useEffect(() => {
    if (!focusRequest || !project.nodes.some((n) => n.id === focusRequest.nodeId)) return
    const t = setTimeout(() => void rf.fitView({ nodes: [{ id: focusRequest.nodeId }], padding: 0.3, duration: 400, maxZoom: 1 }), 50)
    return () => clearTimeout(t)
  }, [focusRequest, project.nodes, rf])

  const openModalAtCenter = useCallback(() => {
    const r = wrapRef.current!.getBoundingClientRect()
    const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    setModalAt({ x: c.x - DEFAULT_TERMINAL_SIZE.width / 2, y: c.y - DEFAULT_TERMINAL_SIZE.height / 2 })
  }, [rf])

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
          setModalAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }
      }}
    >
      <div className="toolbar">
        <button className="primary" data-testid="new-terminal" onClick={openModalAtCenter}>+ Terminal</button>
        <button data-testid="new-browser" onClick={() => {
          const r = wrapRef.current!.getBoundingClientRect()
          const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
          const at = findFreeSpot(project.nodes, { x: c.x - DEFAULT_BROWSER_SIZE.width / 2, y: c.y - DEFAULT_BROWSER_SIZE.height / 2 }, DEFAULT_BROWSER_SIZE)
          const count = project.nodes.filter((n) => n.kind === 'browser').length
          addBrowser(project.id, { name: count ? `Navegador ${count + 1}` : 'Navegador', color: '#3B82F6', ...at })
        }}>+ Navegador</button>
        <button onClick={() => void rf.fitView({ padding: 0.2, duration: 300 })}>Enquadrar tudo</button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onConnect={(c) => { if (c.source && c.target) connect(project.id, c.source, c.target) }}
        onNodeClick={(_e, n) => markSeen(n.id)}
        connectionLineStyle={{ stroke: '#F25C1F', strokeWidth: 2 }}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, _n, dragged) => moveNodes(project.id, dragged.map((d) => ({ id: d.id, x: d.position.x, y: d.position.y })))}
        onSelectionDragStop={(_e, dragged) => moveNodes(project.id, dragged.map((d) => ({ id: d.id, x: d.position.x, y: d.position.y })))}
        disableKeyboardA11y
        defaultViewport={project.viewport}
        onMoveEnd={(_e, vp) => setViewport(project.id, vp)}
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll
        zoomActivationKeyCode="Control"
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
      {project.nodes.length === 0 && (
        <div className="empty" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div>Clique em <b>+ Terminal</b> ou dê duplo clique no fundo para abrir um agente.</div>
        </div>
      )}
      {modalAt && (
        <NewTerminalModal
          count={project.nodes.length}
          onCancel={() => setModalAt(null)}
          onCreate={(v) => { addTerminal(project.id, { ...v, ...findFreeSpot(project.nodes, modalAt) }); setModalAt(null) }}
        />
      )}
    </div>
  )
}

export function Canvas({ project }: { project: Project }) {
  return (
    <ReactFlowProvider>
      <CanvasInner project={project} />
    </ReactFlowProvider>
  )
}
