import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentId, AgentInfo } from '@shared/types'
import { findExecutable } from './findExecutable'
import type { AgentAdapter } from './types'

const SESSION_ID_RE = /^[A-Za-z0-9-]+$/

/** O Claude guarda cada conversa em <config>/projects/<pasta codificada>/<id>.jsonl. */
export function claudeHasSession(sessionId: string, configDir: string = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')): boolean {
  if (!SESSION_ID_RE.test(sessionId)) return false
  const projects = join(configDir, 'projects')
  if (!existsSync(projects)) return false
  return readdirSync(projects).some((dir) => existsSync(join(projects, dir, sessionId + '.jsonl')))
}

const powershell = (): string => findExecutable('powershell') ?? 'powershell.exe'

const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  createsSessionId: true,
  detect: () => findExecutable('claude'),
  launch: (exe, sessionId) => ({ file: exe, args: sessionId ? ['--session-id', sessionId] : [] }),
  resume: (exe, sessionId) => ({ file: exe, args: ['--resume', sessionId] }),
  hasSession: (sessionId) => claudeHasSession(sessionId)
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
