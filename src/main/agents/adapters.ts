import type { AgentId, AgentInfo } from '@shared/types'
import { findExecutable } from './findExecutable'
import type { AgentAdapter } from './types'

const powershell = (): string => findExecutable('powershell') ?? 'powershell.exe'

const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  createsSessionId: true,
  detect: () => findExecutable('claude'),
  launch: (exe, sessionId) => ({ file: exe, args: sessionId ? ['--session-id', sessionId] : [] }),
  resume: (exe, sessionId) => ({ file: exe, args: ['--resume', sessionId] })
}

const shell: AgentAdapter = {
  id: 'shell',
  label: 'PowerShell',
  createsSessionId: false,
  detect: powershell,
  launch: (exe) => ({ file: exe, args: ['-NoLogo'] }),
  resume: () => null
}

const custom: AgentAdapter = {
  id: 'custom',
  label: 'Comando livre',
  createsSessionId: false,
  detect: powershell,
  launch: (exe, _sessionId, command = '') => ({ file: exe, args: ['-NoLogo', '-NoExit', '-Command', command] }),
  resume: () => null
}

export const adapters: Record<AgentId, AgentAdapter> = { claude, shell, custom }

export function availableAgents(list: Record<AgentId, AgentAdapter> = adapters): AgentInfo[] {
  return Object.values(list).map((a) => ({ id: a.id, label: a.label, available: a.detect() !== null }))
}
