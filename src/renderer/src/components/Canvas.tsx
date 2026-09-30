import { useCallback, useEffect, useRef, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type XYPosition } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Project, TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { DEFAULT_TERMINAL_SIZE, findFreeSpot } from '../state/projectOps'
import { TerminalNode, type TerminalFlowNode } from './TerminalNode'
import { NewTerminalModal } from './NewTerminalModal'

const nodeTypes = { terminal: TerminalNode }

function toFlow(n: TerminalNodeData, project: Project, selected = false): TerminalFlowNode {
  return {
    id: n.id, type: 'terminal', position: { x: n.x, y: n.y }, width: n.width, height: n.height,
    dragHandle: '.term-header', selected, data: { term: n, projectId: project.id, cwd: project.cwd }
  }
}

function CanvasInner({ project }: { project: Project }) {
  const addTerminal = useWorkspace((s) => s.addTerminal)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)
  const setViewport = useWorkspace((s) => s.setViewport)
  const [nodes, setNodes, onNodesChange] = useNodesState<TerminalFlowNode>(project.nodes.map((n) => toFlow(n, project)))
  const [modalAt, setModalAt] = useState<XYPosition | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  // Store → React Flow (criação, remoção, sessão). A posição do arrasto volta ao store só no fim do gesto.
  useEffect(() => {
    setNodes((prev) => project.nodes.map((n) => toFlow(n, project, prev.find((p) => p.id === n.id)?.selected ?? false)))
  }, [project, setNodes])

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
        <button onClick={() => void rf.fitView({ padding: 0.2, duration: 300 })}>Enquadrar tudo</button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, n) => updateGeometry(project.id, n.id, { x: n.position.x, y: n.position.y })}
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
