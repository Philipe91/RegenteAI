import type { Bridge } from './bridge'
import type { Topology } from './topology'
import type { PtyManager } from '../pty/ptyManager'
import type { AskBroker } from './askBroker'

interface Deps { topology: Topology; pty: PtyManager; broker: AskBroker }

export function registerBridgeRoutes(bridge: Bridge, { topology, pty, broker }: Deps): void {
  bridge.route('/peers', ({ terminalId }) =>
    topology.peers(terminalId).map((n) => ({
      name: n.name, agent: n.agent, kind: n.kind,
      status: n.kind === 'browser' ? 'stopped' : !pty.isRunning(n.id) ? 'exited' : broker.isBusy(n.id) ? 'working' : 'idle'
    }))
  )
  bridge.route('/ask', ({ terminalId }, body: { to?: unknown; message?: unknown; timeoutMin?: unknown }) => {
    if (typeof body.to !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
      throw new Error('uso: regente ask <nome> "<mensagem>"')
    }
    const timeout = typeof body.timeoutMin === 'number' && body.timeoutMin > 0 ? Math.min(body.timeoutMin, 120) : undefined
    return broker.ask(terminalId, body.to, body.message, timeout)
  })
  bridge.route('/hook', ({ terminalId }, body: { event?: unknown; payload?: unknown }) => {
    if (typeof body.event === 'string') broker.hook(terminalId, body.event, body.payload ?? null)
    return null
  })
}
