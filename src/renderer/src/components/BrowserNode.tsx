import { memo, useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BrowserNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'

export type BrowserFlowNode = Node<{ browser: BrowserNodeData; projectId: string }, 'browser'>

function BrowserNodeView({ data, selected }: NodeProps<BrowserFlowNode>) {
  const { browser: b, projectId } = data
  const state = useWorkspace((s) => s.browserStates[b.id])
  const removeNode = useWorkspace((s) => s.removeNode)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)
  const toast = useWorkspace((s) => s.toast)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const status = state?.status ?? 'closed'

  useEffect(() => { if (state?.url && state.url !== 'about:blank') setAddress(state.url) }, [state?.url])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok && r.error) toast(r.error)
    } finally {
      setBusy(false)
    }
  }
  const go = () => { if (address.trim()) void run(() => window.regente.browser.goto(b.id, address.trim())) }

  return (
    <div className={`term-node browser-node${selected ? ' selected' : ''}`} data-testid="browser-node">
      <Handle type="source" position={Position.Left} id="l" title="Arraste até um terminal para ligar" />
      <Handle type="source" position={Position.Right} id="r" title="Arraste até um terminal para ligar" />
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={200}
        lineStyle={{ borderColor: 'transparent' }}
        onResizeEnd={(_e, p) => updateGeometry(projectId, b.id, { x: p.x, y: p.y, width: p.width, height: p.height })}
      />
      <div className="term-header">
        <span className="dot" style={{ background: b.color }} />
        <strong>{b.name}</strong>
        <span className="agent">Navegador{state?.browser ? ` · ${state.browser}` : ''}</span>
        <span className={`status ${status === 'open' ? 'attention' : status === 'opening' ? 'working' : ''}`}>
          <span className="led" />{status === 'open' ? 'aberto' : status === 'opening' ? 'abrindo…' : 'fechado'}
        </span>
        <div className="actions nodrag">
          {status === 'open'
            ? <button title="Fechar o navegador" onClick={() => void run(() => window.regente.browser.close(b.id))}>Fechar</button>
            : <button title="Abrir o navegador" disabled={busy} onClick={() => void run(() => window.regente.browser.open(b.id))}>Abrir</button>}
          <button title="Remover do canvas" onClick={() => removeNode(projectId, b.id)}>×</button>
        </div>
      </div>
      <div className="browser-body nodrag nowheel nopan">
        <form className="address" onSubmit={(e) => { e.preventDefault(); go() }}>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Digite um endereço e Enter" spellCheck={false} />
        </form>
        <div className="preview">
          {status === 'open' && state?.preview
            ? <img src={state.preview} alt={state.title ?? 'prévia'} />
            : <div className="placeholder">
                {status === 'opening' ? 'Abrindo o navegador…' : status === 'open' ? 'Carregando…' : 'Navegador fechado. Ligue um agente com uma corda e peça para ele navegar, ou clique em Abrir.'}
                {state?.note && <small>{state.note}</small>}
              </div>}
        </div>
        {status === 'open' && <div className="page-title" title={state?.url}>{state?.title || state?.url}</div>}
      </div>
    </div>
  )
}

export const BrowserNode = memo(BrowserNodeView)
