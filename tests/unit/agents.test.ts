import { describe, expect, test } from 'vitest'
import { delimiter, join } from 'node:path'
import { findExecutable } from '../../src/main/agents/findExecutable'
import { toSpawnable } from '../../src/main/agents/spawnable'
import { adapters, availableAgents, claudeHasSession } from '../../src/main/agents/adapters'
import type { AgentAdapter } from '../../src/main/agents/types'

describe('findExecutable', () => {
  const dirA = 'C:\\Users\\Pc Fechamento\\.local\\bin'
  const dirB = 'C:\\tools'
  const existing = new Set([join(dirA, 'claude.exe'), join(dirB, 'codex.cmd')])
  const exists = (p: string) => existing.has(p)
  const PATH = [`"${dirA}"`, '', dirB].join(delimiter)

  test('acha .exe em pasta com espaço e aspas no PATH', () => {
    expect(findExecutable('claude', PATH, exists)).toBe(join(dirA, 'claude.exe'))
  })
  test('acha .cmd', () => {
    expect(findExecutable('codex', PATH, exists)).toBe(join(dirB, 'codex.cmd'))
  })
  test('não achou → null', () => {
    expect(findExecutable('gemini', PATH, exists)).toBeNull()
  })
})

describe('toSpawnable', () => {
  test('.exe passa direto', () => {
    const s = { file: 'C:\\a b\\claude.exe', args: ['--resume', 'x'] }
    expect(toSpawnable(s)).toEqual(s)
  })
  test('.cmd vira cmd.exe /d /s /c com aspas', () => {
    expect(toSpawnable({ file: 'C:\\a b\\codex.cmd', args: ['resume', 'id 1'] }, 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c ""C:\\a b\\codex.cmd" resume "id 1""'
    })
  })
})

describe('adaptadores', () => {
  test('claude: cria com --session-id e retoma com --resume', () => {
    const a = adapters.claude
    expect(a.createsSessionId).toBe(true)
    expect(a.launch('claude.exe', 'abc')).toEqual({ file: 'claude.exe', args: ['--session-id', 'abc'] })
    expect(a.resume('claude.exe', 'abc')).toEqual({ file: 'claude.exe', args: ['--resume', 'abc'] })
  })
  test('shell: sem sessão', () => {
    expect(adapters.shell.resume('powershell.exe', 'x')).toBeNull()
    expect(adapters.shell.launch('powershell.exe', undefined)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })
  test('custom: roda o comando e mantém o shell aberto', () => {
    expect(adapters.custom.launch('powershell.exe', undefined, 'npm run dev')).toEqual({
      file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', 'npm run dev']
    })
  })
  test('availableAgents reflete detect()', () => {
    const fake = (id: 'claude' | 'shell' | 'custom', found: boolean): AgentAdapter => ({
      ...adapters[id], detect: () => (found ? 'x.exe' : null)
    })
    expect(availableAgents({ claude: fake('claude', false), shell: fake('shell', true), custom: fake('custom', true) })).toEqual([
      { id: 'claude', label: 'Claude Code', available: false },
      { id: 'shell', label: 'PowerShell', available: true },
      { id: 'custom', label: 'Comando livre', available: true }
    ])
  })
})

describe('claude.hasSession (I-5c)', () => {
  test('acha a sessão em qualquer subpasta de projects; id estranho → false', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const cfg = mkdtempSync(join(tmpdir(), 'claude cfg '))
    try {
      mkdirSync(join(cfg, 'projects', 'C--projetos-X'), { recursive: true })
      writeFileSync(join(cfg, 'projects', 'C--projetos-X', '3f1c2b9a-1111-4000-8000-000000000000.jsonl'), '{}')
      expect(claudeHasSession('3f1c2b9a-1111-4000-8000-000000000000', cfg)).toBe(true)
      expect(claudeHasSession('3f1c2b9a-2222-4000-8000-000000000000', cfg)).toBe(false)
      expect(claudeHasSession('..\\..\\x', cfg)).toBe(false)
      expect(claudeHasSession('3f1c2b9a-1111-4000-8000-000000000000', join(cfg, 'nao-existe'))).toBe(false)
    } finally { rmSync(cfg, { recursive: true, force: true }) }
  })
})
