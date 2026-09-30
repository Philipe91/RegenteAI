import { describe, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PtyManager, type PtyFactory } from '../../src/main/pty/ptyManager'
import { TerminalService } from '../../src/main/terminals/terminalService'
import { buildTerminalEnv } from '../../src/main/terminals/terminalEnv'
import { adapters } from '../../src/main/agents/adapters'
import type { AgentAdapter } from '../../src/main/agents/types'
import type { AgentId, TerminalNodeData } from '@shared/types'

const cwd = mkdtempSync(join(tmpdir(), 'regente svc '))

function setup(detected = true, sessionExists = true, throwOnSpawn = false) {
  let now = 0
  const spawned: Array<{ file: string; args: string[] | string; env: Record<string, string>; exit(c: number): void }> = []
  const factory: PtyFactory = (file, args, opts) => {
    if (throwOnSpawn) throw new Error('CreateProcess failed')
    let onExit: (e: { exitCode: number }) => void = () => {}
    spawned.push({ file, args, env: opts.env, exit: (c) => onExit({ exitCode: c }) })
    return { onData: () => {}, onExit: (cb) => { onExit = cb }, write: () => {}, resize: () => {}, kill: () => {} }
  }
  const pty = new PtyManager(factory, () => now)
  const withExe = (a: AgentAdapter): AgentAdapter => ({
    ...a,
    detect: () => (detected ? `C:\\bin\\${a.id}.exe` : null),
    hasSession: a.hasSession ? () => sessionExists : undefined
  })
  const list: Record<AgentId, AgentAdapter> = { claude: withExe(adapters.claude), shell: withExe(adapters.shell), custom: withExe(adapters.custom) }
  let n = 0
  const svc = new TerminalService(pty, list, () => `uuid-${++n}`, { PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' })
  const events: unknown[][] = []
  for (const ev of ['exit', 'session', 'notice']) svc.on(ev, (...a) => events.push([ev, ...a]))
  return { svc, spawned, events, advance: (ms: number) => { now += ms } }
}

const node = (over: Partial<TerminalNodeData> = {}): TerminalNodeData => ({
  id: 't1', kind: 'terminal', agent: 'claude', name: 'Claude', color: '#fff', x: 0, y: 0, width: 600, height: 400, ...over
})
const req = (n: TerminalNodeData) => ({ projectId: 'p1', cwd, node: n, cols: 80, rows: 24 })

describe('TerminalService', () => {
  test('claude novo: gera sessionId e avisa', () => {
    const { svc, spawned, events } = setup()
    const r = svc.start(req(node()))
    expect(r.sessionId).toBe('uuid-1')
    expect(spawned[0].args).toEqual(['--session-id', 'uuid-1'])
    expect(events).toContainEqual(['session', 't1', 'uuid-1'])
  })

  test('claude com sessão salva: retoma', () => {
    const { svc, spawned } = setup()
    svc.start(req(node({ sessionId: 'antiga' })))
    expect(spawned[0].args).toEqual(['--resume', 'antiga'])
  })

  test('resume falha rápido → abre sessão nova e avisa, sem exit', () => {
    const { svc, spawned, events, advance } = setup()
    svc.start(req(node({ sessionId: 'apagada' })))
    advance(1200)
    spawned[0].exit(1)
    expect(spawned[1].args).toEqual(['--session-id', 'uuid-1'])
    expect(events).toContainEqual(['session', 't1', 'uuid-1'])
    expect(events.some((e) => e[0] === 'notice')).toBe(true)
    expect(events.some((e) => e[0] === 'exit')).toBe(false)
  })

  test('resume que roda bastante e sai → exit normal, sem nova sessão', () => {
    const { svc, spawned, events, advance } = setup()
    svc.start(req(node({ sessionId: 'ok' })))
    advance(60000)
    spawned[0].exit(0)
    expect(spawned).toHaveLength(1)
    expect(events).toContainEqual(['exit', 't1', 0])
  })

  test('agente não instalado → erro claro, sem processo', () => {
    const { svc, spawned } = setup(false)
    const r = svc.start(req(node()))
    expect(r.error).toMatch(/Claude Code não encontrado/)
    expect(spawned).toHaveLength(0)
  })

  test('pasta do projeto não existe → erro claro', () => {
    const { svc, spawned } = setup()
    const r = svc.start({ ...req(node()), cwd: 'C:\\nao\\existe\\mesmo' })
    expect(r.error).toMatch(/Pasta do projeto não existe/)
    expect(spawned).toHaveLength(0)
  })

  test('start em terminal já rodando devolve o histórico, sem novo processo', () => {
    const { svc, spawned } = setup()
    svc.start(req(node({ agent: 'shell' })))
    const r = svc.start(req(node({ agent: 'shell' })))
    expect(spawned).toHaveLength(1)
    expect(r.error).toBeUndefined()
  })

  test('restart mata e reabre na mesma sessão', () => {
    const { svc, spawned } = setup()
    svc.start(req(node()))
    svc.restart('t1')
    expect(spawned).toHaveLength(2)
    expect(spawned[1].args).toEqual(['--resume', 'uuid-1'])
  })

  test('filhos não herdam variáveis de Claude aninhado', () => {
    const { svc, spawned } = setup()
    svc.start(req(node()))
    expect(spawned[0].env.CLAUDECODE).toBeUndefined()
    expect(spawned[0].env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(spawned[0].env.REGENTE_TERMINAL_ID).toBe('t1')
    expect(spawned[0].env.REGENTE_PROJECT_ID).toBe('p1')
  })
})

describe('buildTerminalEnv', () => {
  test('remove undefined e define COLORTERM', () => {
    const env = buildTerminalEnv({ A: '1', B: undefined }, { terminalId: 't', projectId: 'p' })
    expect(env).toEqual({ A: '1', COLORTERM: 'truecolor', REGENTE_TERMINAL_ID: 't', REGENTE_PROJECT_ID: 'p' })
  })
})

describe('buildTerminalEnv — marcadores de sessão Claude pai', () => {
  test('remove marcadores de sessão, mantém configuração do usuário', () => {
    const base = {
      CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_EXECPATH: 'x',
      CLAUDE_CODE_MESSAGING_SOCKET: 's', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_CODE_SESSION_ID: 'id', CLAUDE_PID: '123', CLAUDE_EFFORT: 'low',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe', ANTHROPIC_MODEL: 'm'
    }
    const env = buildTerminalEnv(base, { terminalId: 't', projectId: 'p' })
    expect(Object.keys(env).filter((k) => k.startsWith('CLAUDE')).sort()).toEqual(['CLAUDE_CODE_GIT_BASH_PATH'])
    expect(env.ANTHROPIC_MODEL).toBe('m')
  })
})

describe('TerminalService — correções da revisão', () => {
  test('I-3: falha ao criar o processo vira erro claro, sem exceção', () => {
    const { svc } = setup(true, true, true)
    const r = svc.start(req(node({ agent: 'shell' })))
    expect(r.error).toMatch(/Não foi possível iniciar o terminal: CreateProcess failed/)
  })
  test('I-3: tipo de agente desconhecido vira erro claro', () => {
    const { svc } = setup()
    const r = svc.start(req(node({ agent: 'codex' as never })))
    expect(r.error).toMatch(/Tipo de agente desconhecido: codex/)
  })
  test('I-5b: processo que saiu não renasce ao remontar; devolve o código de saída', () => {
    const { svc, spawned, advance } = setup()
    svc.start(req(node({ agent: 'shell' })))
    advance(60000)
    spawned[0].exit(0)
    const r = svc.start(req(node({ agent: 'shell' })))
    expect(spawned).toHaveLength(1)
    expect(r.exitCode).toBe(0)
  })
  test('I-5b: restart depois da saída abre de novo', () => {
    const { svc, spawned, advance } = setup()
    svc.start(req(node({ agent: 'shell' })))
    advance(60000)
    spawned[0].exit(0)
    const r = svc.restart('t1')
    expect(spawned).toHaveLength(2)
    expect(r?.exitCode).toBeUndefined()
  })
  test('I-5c: sessão que não existe no disco → nova conversa direto, sem tentar resume', () => {
    const { svc, spawned, events } = setup(true, false)
    const r = svc.start(req(node({ sessionId: 'sumiu' })))
    expect(spawned[0].args).toEqual(['--session-id', 'uuid-1'])
    expect(r.sessionId).toBe('uuid-1')
    expect(events.some((e) => e[0] === 'notice')).toBe(true)
  })
})

describe('TerminalService — integração com o Regente (Fase 2)', () => {
  function withIntegration() {
    const spawned: Array<{ args: string[] | string; env: Record<string, string> }> = []
    const factory: PtyFactory = (_f, args, opts) => {
      spawned.push({ args, env: opts.env })
      return { onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }
    }
    const killed: string[] = []
    const list: Record<AgentId, AgentAdapter> = {
      claude: { ...adapters.claude, detect: () => 'C:/bin/claude.exe', hasSession: () => true },
      shell: { ...adapters.shell, detect: () => 'C:/bin/powershell.exe' },
      custom: { ...adapters.custom, detect: () => 'C:/bin/powershell.exe' }
    }
    const svc = new TerminalService(new PtyManager(factory), list, () => 'uuid-x', { Path: 'C:/win' }, {
      env: (r) => ({ REGENTE_TOKEN: `tok-${r.node.id}`, REGENTE_URL: 'http://127.0.0.1:9' }),
      pathDir: 'C:/rg/bin',
      agentContext: (r) => ({ settingsPath: `C:/rg/hooks/${r.node.id}.json`, systemPrompt: `Você é ${r.node.name}` }),
      onKill: (id) => killed.push(id)
    })
    return { svc, spawned, killed }
  }

  test('claude recebe --settings e --append-system-prompt depois dos args de sessão', () => {
    const { svc, spawned } = withIntegration()
    svc.start(req(node({ name: 'Líder' })))
    expect(spawned[0].args).toEqual(['--session-id', 'uuid-x', '--settings', 'C:/rg/hooks/t1.json', '--append-system-prompt', 'Você é Líder'])
  })
  test('shell não recebe args do Claude, mas recebe env e PATH do regente', () => {
    const { svc, spawned } = withIntegration()
    svc.start(req(node({ agent: 'shell' })))
    expect(spawned[0].args).toEqual(['-NoLogo'])
    expect(spawned[0].env.REGENTE_TOKEN).toBe('tok-t1')
    expect(spawned[0].env.Path).toBe('C:/rg/bin;C:/win')
  })
  test('kill avisa a integração (revoga o token)', () => {
    const { svc, killed } = withIntegration()
    svc.start(req(node({ agent: 'shell' })))
    svc.kill('t1')
    expect(killed).toEqual(['t1'])
  })
})

describe('TerminalService — eventos para o orquestrador', () => {
  test('kill = gone (removido); saída natural e restart = reset (o nó continua)', () => {
    const { svc, spawned, advance } = setup()
    const ev: string[] = []
    svc.on('gone', (id) => ev.push(`gone:${id}`))
    svc.on('reset', (id) => ev.push(`reset:${id}`))
    svc.start(req(node({ agent: 'shell' })))
    advance(60000)
    spawned[0].exit(0)
    svc.restart('t1')
    svc.start(req(node({ id: 't2', agent: 'shell' })))
    svc.kill('t2')
    expect(ev).toEqual(['reset:t1', 'reset:t1', 'gone:t2'])
  })
  test('resume que falhou e foi reaberto com sessão nova também avisa reset', () => {
    const { svc, spawned, advance } = setup()
    const ev: string[] = []
    svc.on('reset', (id) => ev.push(id))
    svc.start(req(node({ sessionId: 'velha' })))
    advance(1000)
    spawned[0].exit(1)
    expect(ev).toEqual(['t1'])
  })
})

describe('TerminalService — evento spawned (para o AskBroker esperar o SessionStart)', () => {
  test('cada processo aberto avisa spawned, inclusive no restart', () => {
    const { svc } = setup()
    const spawned: string[] = []
    svc.on('spawned', (id) => spawned.push(id))
    svc.start(req(node()))
    svc.restart('t1')
    expect(spawned).toEqual(['t1', 't1'])
  })
})
