import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'

export type RopeFlowEdge = Edge<{ onRemove(): void; active: boolean }, 'rope'>

function box(n: InternalNode) {
  const { x, y } = n.internals.positionAbsolute
  const w = n.measured.width ?? n.width ?? 0
  const h = n.measured.height ?? n.height ?? 0
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

/** Liga os lados que estão de frente um para o outro, não importa para onde os nós foram arrastados. */
function facingSides(a: InternalNode, b: InternalNode) {
  const A = box(a)
  const B = box(b)
  const dx = B.cx - A.cx
  const dy = B.cy - A.cy
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0
    return {
      sx: right ? A.x + A.w : A.x, sy: A.cy, sp: right ? Position.Right : Position.Left,
      tx: right ? B.x : B.x + B.w, ty: B.cy, tp: right ? Position.Left : Position.Right
    }
  }
  const down = dy >= 0
  return {
    sx: A.cx, sy: down ? A.y + A.h : A.y, sp: down ? Position.Bottom : Position.Top,
    tx: B.cx, ty: down ? B.y : B.y + B.h, tp: down ? Position.Top : Position.Bottom
  }
}

/** Corda entre dois nós. Anima enquanto uma mensagem trafega; selecionada, mostra o × para desligar. */
export function RopeEdge({ id, source, target, selected, data }: EdgeProps<RopeFlowEdge>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const s = facingSides(a, b)
  const [path, labelX, labelY] = getBezierPath({
    sourceX: s.sx, sourceY: s.sy, sourcePosition: s.sp, targetX: s.tx, targetY: s.ty, targetPosition: s.tp, curvature: 0.35
  })
  const active = data?.active ?? false
  return (
    <>
      <BaseEdge id={id} path={path} className={active ? 'rope active' : 'rope'} style={{ stroke: active ? '#F25C1F' : selected ? '#ece7df' : '#8a8076', strokeWidth: active ? 3 : 2 }} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="rope-remove nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title="Desligar"
            onClick={() => data?.onRemove()}
          >×</button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
