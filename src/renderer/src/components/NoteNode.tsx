import { memo, useEffect, useRef, useState } from 'react'
import { mergeNote } from '@shared/noteMerge'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import type { NoteNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'

export type NoteFlowNode = Node<{ note: NoteNodeData; projectId: string }, 'note'>

function NoteNodeView({ data, selected }: NodeProps<NoteFlowNode>) {
  const { note: n, projectId } = data
  const setNoteText = useWorkspace((s) => s.setNoteText)
  const removeNode = useWorkspace((s) => s.removeNode)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)
  const [draft, setDraft] = useState(n.text)
  /** Último texto em comum entre você e o projeto (base da mesclagem). */
  const base = useRef(n.text)

  // Texto mudou por fora (um agente escreveu): junta com o que você está digitando.
  useEffect(() => {
    if (n.text === base.current) return
    const merged = mergeNote(base.current, draft, n.text)
    base.current = merged
    setDraft(merged)
    if (merged !== n.text) setNoteText(projectId, n.id, merged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.text])

  return (
    <div className={`term-node note-node${selected ? ' selected' : ''}`} data-testid="note-node">
      <Handle type="source" position={Position.Left} id="l" title="Arraste até um terminal para ligar" />
      <Handle type="source" position={Position.Right} id="r" title="Arraste até um terminal para ligar" />
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={140}
        lineStyle={{ borderColor: 'transparent' }}
        onResizeEnd={(_e, p) => updateGeometry(projectId, n.id, { x: p.x, y: p.y, width: p.width, height: p.height })}
      />
      <div className="term-header">
        <span className="dot" style={{ background: n.color }} />
        <strong>{n.name}</strong>
        <span className="agent">Nota</span>
        <div className="actions nodrag">
          <button title="Remover do canvas" onClick={() => removeNode(projectId, n.id)}>×</button>
        </div>
      </div>
      <textarea
        className="note-text nodrag nowheel nopan"
        value={draft}
        placeholder="Escreva aqui. Agentes ligados leem com: regente note"
        spellCheck={false}
        onChange={(e) => { base.current = e.target.value; setDraft(e.target.value); setNoteText(projectId, n.id, e.target.value) }}
      />
    </div>
  )
}

export const NoteNode = memo(NoteNodeView)
