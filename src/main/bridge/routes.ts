import type { Bridge } from './bridge'
import type { Topology } from './topology'
import type { TerminalService } from '../terminals/terminalService'
import type { PtyManager } from '../pty/ptyManager'

interface Deps { topology: Topology; terminals: TerminalService; pty: PtyManager }

export function registerBridgeRoutes(bridge: Bridge, { topology, pty }: Deps): void {
  bridge.route('/peers', ({ terminalId }) =>
    topology.peers(terminalId).map((n) => ({
      name: n.name, agent: n.agent, kind: n.kind,
      status: n.kind === 'browser' ? 'stopped' : pty.isRunning(n.id) ? 'idle' : 'exited'
    }))
  )
  bridge.route('/hook', () => null)
}
