import type { Bridge } from './bridge'
import type { Topology } from './topology'
import type { PtyManager } from '../pty/ptyManager'
import type { AskBroker } from './askBroker'
import type { BrowserManager } from '../browser/manager'
import { runBrowserCommand } from '../browser/commands'
import { noteCommand } from './notes'

interface Deps { topology: Topology; pty: PtyManager; broker: AskBroker; browsers: BrowserManager; onFlow(from: string, to: string, active: boolean): void; onNoteChange(nodeId: string, text: string): void }

export function registerBridgeRoutes(bridge: Bridge, { topology, pty, broker, browsers, onFlow, onNoteChange }: Deps): void {
  bridge.route('/peers', ({ terminalId }) =>
    topology.peers(terminalId).map((n) => ({
      name: n.name, agent: n.agent, kind: n.kind,
      status: n.kind === 'note' ? 'open' : n.kind === 'browser' ? (browsers.isOpen(n.id) ? 'open' : 'stopped') : !pty.isRunning(n.id) ? 'exited' : broker.isBusy(n.id) ? 'working' : 'idle'
    }))
  )
  bridge.route('/ask', ({ terminalId, signal }, body: { to?: unknown; message?: unknown; timeoutMin?: unknown }) => {
    if (typeof body.to !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
      throw new Error('uso: regente ask <nome> "<mensagem>"')
    }
    const timeout = typeof body.timeoutMin === 'number' && body.timeoutMin > 0 ? Math.min(body.timeoutMin, 120) : undefined
    return broker.ask(terminalId, body.to, body.message, timeout, signal)
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
  bridge.route('/hook', ({ terminalId }, body: { event?: unknown; payload?: unknown }) => {
    if (typeof body.event === 'string') broker.hook(terminalId, body.event, body.payload ?? null)
    return null
  })
}
