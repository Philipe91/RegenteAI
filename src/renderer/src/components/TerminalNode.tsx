import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeData } from '@shared/types'
import { ROLES } from '@shared/roles'
import { termBus } from '../termBus'
import { useWorkspace } from '../state/workspace'

export type TerminalFlowNode = Node<{ term: TerminalNodeData; projectId: string; cwd: string }, 'terminal'>

const AGENT_LABEL: Record<TerminalNodeData['agent'], string> = { claude: 'Claude Code', shell: 'PowerShell', custom: 'Comando' }

type Banner = { text: string; kind: 'info' | 'exit' | 'error' }

const ACTIVITY_LABEL = { working: 'trabalhando', attention: 'pronto', 'needs-user': 'precisa de você', starting: 'abrindo…' } as const

function TerminalNodeView({ data, selected }: NodeProps<TerminalFlowNode>) {
  const { term: t, projectId, cwd } = data
  const hostRef = useRef<HTMLDivElement>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [runKey, setRunKey] = useState(0)
  const setSessionId = useWorkspace((s) => s.setSessionId)
  const removeNode = useWorkspace((s) => s.removeNode)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)
  const activity = useWorkspace((s) => s.activity[t.id])
  const queued = useWorkspace((s) => s.queues[t.id] ?? 0)
  const isPaused = useWorkspace((s) => Boolean(s.paused[t.id]))

  useEffect(() => {
    const xterm = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000,
      theme: { background: '#141414', foreground: '#ece7df', cursor: '#F25C1F' },
      // Links (OSC 8) abrem no navegador do sistema, nunca numa janela do app.
      linkHandler: { activate: (_e, uri) => window.regente.openExternal(uri) }
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(hostRef.current!)
    try { fit.fit() } catch { /* host ainda sem tamanho */ }

    // Até o start responder, tudo que chegar já está no histórico que ele devolve (IPC é ordenado).
    let ready = false
    let disposed = false
    const offs = [
      termBus.onData(t.id, (d) => { if (ready) xterm.write(d) }),
      termBus.onExit(t.id, (code) => setBanner({ text: `Processo encerrado (código ${code}).`, kind: 'exit' })),
      termBus.onNotice(t.id, (msg) => setBanner({ text: msg, kind: 'info' }))
    ]
    const input = xterm.onData((d) => window.regente.term.write(t.id, d))

    const req = { projectId, cwd, node: t, cols: xterm.cols, rows: xterm.rows }
    const run = runKey === 0
      ? window.regente.term.start(req)
      : window.regente.term.restart(t.id).then((r) => r ?? window.regente.term.start(req))
    run.then((res) => {
      if (res.sessionId && res.sessionId !== t.sessionId) setSessionId(projectId, t.id, res.sessionId)
      if (disposed) return
      if (res.error) { setBanner({ text: res.error, kind: 'error' }); return }
      if (res.buffer) xterm.write(res.buffer)
      ready = true
      if (res.exitCode !== undefined) setBanner({ text: `Processo encerrado (código ${res.exitCode}).`, kind: 'exit' })
      else window.regente.term.resize(t.id, xterm.cols, xterm.rows)
    }).catch((e: unknown) => {
      if (!disposed) setBanner({ text: `Falha ao iniciar o terminal: ${e instanceof Error ? e.message : String(e)}`, kind: 'error' })
    })

    const ro = new ResizeObserver(() => {
      try { fit.fit(); window.regente.term.resize(t.id, xterm.cols, xterm.rows) } catch { /* ignorado */ }
    })
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      ro.disconnect()
      input.dispose()
      offs.forEach((off) => off())
      xterm.dispose()
    }
    // Reabre só quando o id muda ou quando o usuário pede reinício.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, runKey])

  const restart = () => { setBanner(null); setRunKey((k) => k + 1) }

  return (
    <div className={`term-node${selected ? ' selected' : ''}`} data-testid="terminal-node">
      <Handle type="source" position={Position.Left} id="l" title="Arraste até outro nó para ligar" />
      <Handle type="source" position={Position.Right} id="r" title="Arraste até outro nó para ligar" />
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineStyle={{ borderColor: 'transparent' }}
        onResizeEnd={(_e, p) => updateGeometry(projectId, t.id, { x: p.x, y: p.y, width: p.width, height: p.height })}
      />
      <div className="term-header">
        <span className="dot" style={{ background: t.color }} />
        <strong>{t.name}</strong>
        <span className="agent">{AGENT_LABEL[t.agent]}</span>
        {t.role && <span className="role-badge" style={{ background: ROLES[t.role].color }} title={ROLES[t.role].prompt}>{ROLES[t.role].label}</span>}
        {activity && (
          <span className={`status ${activity}`}><span className="led" />{ACTIVITY_LABEL[activity]}</span>
        )}
        {t.worktree && <span className="branch-badge" title={t.worktree.path}>⎇ {t.worktree.branch}</span>}
        {queued > 1 && <span className="queue-badge" title="Entregas esperando este agente">{queued - 1} na fila</span>}
        {isPaused && <button className="resume nodrag" title="Mensagens automáticas demais: a fila foi pausada" onClick={() => window.regente.term.resume(t.id)}>Retomar</button>}
        <div className="actions nodrag">
          <button title="Reiniciar" onClick={restart}>↻</button>
          <button title="Fechar terminal" onClick={() => removeNode(projectId, t.id)}>×</button>
        </div>
      </div>
      <div className="term-body nodrag nowheel nopan">
        <div ref={hostRef} style={{ height: '100%' }} />
        {banner && (
          <div className={`term-banner${banner.kind === 'error' ? ' error' : ''}`}>
            <span>{banner.text}</span>
            {banner.kind !== 'info' && <button onClick={restart}>Reiniciar</button>}
            <button onClick={() => setBanner(null)}>ok</button>
          </div>
        )}
      </div>
    </div>
  )
}

export const TerminalNode = memo(TerminalNodeView)
