import type { Bridge } from './bridge'
import type { Topology } from './topology'
import type { PtyManager } from '../pty/ptyManager'
import type { Orchestrator } from './orchestrator'
import type { BrowserManager } from '../browser/manager'
import { runBrowserCommand } from '../browser/commands'
import { noteCommand } from './notes'
import { formatRecord, formatTaskList } from './taskFormat'

interface Deps {
  topology: Topology
  pty: PtyManager
  orchestrator: Orchestrator
  browsers: BrowserManager
  onFlow(from: string, to: string, active: boolean): void
  onNoteChange(nodeId: string, text: string): void
}

const minutesOf = (v: unknown, max: number) => (typeof v === 'number' && v > 0 ? Math.min(v, max) : undefined)
const text = (v: unknown) => (typeof v === 'string' ? v : '')

export function registerBridgeRoutes(bridge: Bridge, { topology, pty, orchestrator, browsers, onFlow, onNoteChange }: Deps): void {
  bridge.route('/peers', ({ terminalId }) =>
    topology.peers(terminalId).map((n) => {
      let status: string
      if (n.kind === 'note') status = 'open'
      else if (n.kind === 'browser') status = browsers.isOpen(n.id) ? 'open' : 'stopped'
      else if (!pty.isRunning(n.id)) status = 'exited'
      else if (orchestrator.isPaused(n.id)) status = 'paused'
      else status = orchestrator.status(n.id) === 'idle' && orchestrator.queueSize(n.id) > 0 ? 'working' : orchestrator.status(n.id)
      return { name: n.name, agent: n.agent, kind: n.kind, status, ...(n.branch ? { branch: n.branch } : {}) }
    })
  )

  bridge.route('/ask', ({ terminalId, signal }, body: { to?: unknown; message?: unknown; timeoutMin?: unknown }) => {
    if (!text(body.to) || !text(body.message).trim()) throw new Error('uso: regente ask <nome> "<mensagem>"')
    return orchestrator.ask(terminalId, text(body.to), text(body.message), minutesOf(body.timeoutMin, 9), signal)
  })

  bridge.route('/send', ({ terminalId }, body: { to?: unknown; message?: unknown; timeoutMin?: unknown }) => {
    if (!text(body.to) || !text(body.message).trim()) throw new Error('uso: regente send <nome> "<tarefa>"')
    const r = orchestrator.send(terminalId, text(body.to), text(body.message), minutesOf(body.timeoutMin, 24 * 60))
    const where = r.position === 0 ? 'já foi entregue' : `está na fila de ${r.toName} (${r.position} antes dela)`
    return {
      text: `Tarefa #${r.id} enviada para ${r.toName} e ${where}. A resposta chega aqui sozinha, como uma nova mensagem, quando ${r.toName} terminar — pode seguir com outras coisas ou encerrar o seu turno.`
    }
  })

  bridge.route('/tasks', ({ terminalId }) => ({ text: formatTaskList(orchestrator.tasks(terminalId)) }))
  bridge.route('/result', ({ terminalId }, body: { id?: unknown }) => ({ text: formatRecord(orchestrator.task(terminalId, text(body.id))) }))
  bridge.route('/wait', async ({ terminalId, signal }, body: { id?: unknown; timeoutMin?: unknown }) =>
    ({ text: formatRecord(await orchestrator.wait(terminalId, text(body.id), minutesOf(body.timeoutMin, 24 * 60), signal)) }))
  bridge.route('/cancel', ({ terminalId }, body: { id?: unknown }) => ({ text: orchestrator.cancel(terminalId, text(body.id)) }))

  bridge.route('/note', ({ terminalId }, body: { action?: unknown; text?: unknown; name?: unknown }) => {
    const r = noteCommand(topology, terminalId, body)
    const update = r.update
    if (update) {
      onNoteChange(update.nodeId, update.text)
      onFlow(terminalId, update.nodeId, true)
      setTimeout(() => onFlow(terminalId, update.nodeId, false), 800)
    }
    return { text: r.text }
  })

  bridge.route('/browser', async ({ terminalId }, body: { action?: unknown; args?: unknown }) => {
    const target = topology.browserPeer(terminalId)
    if (typeof body.action !== 'string') throw new Error('uso: regente browser <ação> [...]')
    const args = Array.isArray(body.args) ? body.args.map(String) : []
    onFlow(terminalId, target.id, true)
    try {
      return { text: await runBrowserCommand(browsers, target.id, body.action, args) }
    } finally {
      onFlow(terminalId, target.id, false)
    }
  })

  bridge.route('/hook', ({ terminalId }, body: { event?: unknown; payload?: unknown }) => {
    if (typeof body.event === 'string') orchestrator.hook(terminalId, body.event, body.payload ?? null)
    return null
  })
}
