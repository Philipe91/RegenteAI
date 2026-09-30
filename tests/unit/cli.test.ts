import { afterEach, describe, expect, test } from 'vitest'
import { Bridge } from '../../src/main/bridge/bridge'
import { runCli, type CliIO } from '../../src/cli/run'

let bridge: Bridge | null = null
afterEach(async () => { await bridge?.close(); bridge = null })

function io(env: Record<string, string>, stdin = '') {
  const out: string[] = []
  const err: string[] = []
  const x: CliIO = { env, out: (s) => out.push(s), err: (s) => err.push(s), readStdin: async () => stdin }
  return { x, out, err }
}

async function setup() {
  bridge = new Bridge()
  const calls: Array<{ path: string; ctx: string; body: any }> = []
  for (const path of ['/peers', '/ask', '/hook', '/browser']) {
    bridge.route(path, (ctx, body) => {
      calls.push({ path, ctx: ctx.terminalId, body })
      if (path === '/peers') return [{ name: 'Revisor', agent: 'claude', kind: 'terminal', status: 'idle' }]
      if (path === '/ask') { if (body.to === 'Ninguém') throw new Error('Ninguém não está ligado a você'); return 'resposta do revisor' }
      if (path === '/browser') return { text: `feito: ${body.action} ${body.args.join(' ')}` }
      return null
    })
  }
  const url = await bridge.listen()
  const env = { REGENTE_URL: url, REGENTE_TOKEN: bridge.issueToken('lider') }
  return { env, calls }
}

describe('runCli', () => {
  test('fora do Regente → explica e sai com 2', async () => {
    const { x, err } = io({})
    expect(await runCli(['peers'], x)).toBe(2)
    expect(err.join('')).toMatch(/não foi aberto pelo Regente/)
  })
  test('Regente fechado → explica e sai com 2', async () => {
    const { x, err } = io({ REGENTE_URL: 'http://127.0.0.1:1', REGENTE_TOKEN: 'x' })
    expect(await runCli(['peers'], x)).toBe(2)
    expect(err.join('')).toMatch(/Regente não está rodando/)
  })
  test('peers lista os ligados', async () => {
    const { env } = await setup()
    const { x, out } = io(env)
    expect(await runCli(['peers'], x)).toBe(0)
    expect(out.join('')).toMatch(/Revisor.*Claude Code.*livre/)
  })
  test('ask junta a mensagem e imprime a resposta', async () => {
    const { env, calls } = await setup()
    const { x, out } = io(env)
    expect(await runCli(['ask', 'Revisor', 'revise', 'o', 'login.ts', '--timeout', '3'], x)).toBe(0)
    expect(calls[0]).toEqual({ path: '/ask', ctx: 'lider', body: { to: 'Revisor', message: 'revise o login.ts', timeoutMin: 3 } })
    expect(out.join('')).toContain('resposta do revisor')
  })
  test('ask com erro do Regente → stderr e código 1', async () => {
    const { env } = await setup()
    const { x, err } = io(env)
    expect(await runCli(['ask', 'Ninguém', 'oi'], x)).toBe(1)
    expect(err.join('')).toMatch(/Ninguém não está ligado a você/)
  })
  test('ask sem mensagem → uso e código 2', async () => {
    const { env } = await setup()
    const { x, err } = io(env)
    expect(await runCli(['ask', 'Revisor'], x)).toBe(2)
    expect(err.join('')).toMatch(/uso: regente ask/i)
  })
  test('hook envia o JSON do stdin e nunca falha', async () => {
    const { env, calls } = await setup()
    const { x } = io(env, '{"hook_event_name":"Stop","last_assistant_message":"ok"}')
    expect(await runCli(['hook', 'stop'], x)).toBe(0)
    expect(calls[0]).toEqual({ path: '/hook', ctx: 'lider', body: { event: 'stop', payload: { hook_event_name: 'Stop', last_assistant_message: 'ok' } } })
    const { x: x2 } = io({ REGENTE_URL: 'http://127.0.0.1:1', REGENTE_TOKEN: 'x' }, 'lixo')
    expect(await runCli(['hook', 'stop'], x2)).toBe(0)
  })
  test('browser repassa ação e argumentos', async () => {
    const { env, calls } = await setup()
    const { x, out } = io(env)
    expect(await runCli(['browser', 'goto', 'https://example.com'], x)).toBe(0)
    expect(calls[0].body).toEqual({ action: 'goto', args: ['https://example.com'] })
    expect(out.join('')).toContain('feito: goto https://example.com')
  })
  test('sem comando → ajuda', async () => {
    const { x, out } = io({})
    expect(await runCli([], x)).toBe(0)
    expect(out.join('')).toMatch(/regente ask/)
  })
})

describe('runCli note', () => {
  test('read (padrão), write e append com --nota', async () => {
    bridge = new Bridge()
    const calls: any[] = []
    bridge.route('/note', (_c, body) => { calls.push(body); return { text: 'ok' } })
    const url = await bridge.listen()
    const env = { REGENTE_URL: url, REGENTE_TOKEN: bridge.issueToken('t') }
    expect(await runCli(['note'], io(env).x)).toBe(0)
    expect(await runCli(['note', 'append', 'fazer', 'login', '--nota', 'Tarefas'], io(env).x)).toBe(0)
    expect(await runCli(['note', 'write', 'tudo novo'], io(env).x)).toBe(0)
    expect(calls).toEqual([
      { action: 'read' },
      { action: 'append', text: 'fazer login', name: 'Tarefas' },
      { action: 'write', text: 'tudo novo' }
    ])
  })
  test('append sem texto → uso', async () => {
    const { x, err } = io({ REGENTE_URL: 'http://127.0.0.1:1', REGENTE_TOKEN: 'x' })
    expect(await runCli(['note', 'append'], x)).toBe(2)
    expect(err.join('')).toMatch(/uso: regente note/)
  })
})

describe('runCli — tarefas', () => {
  test('send, tasks, result, wait e cancel repassam para o Regente e imprimem o texto', async () => {
    bridge = new Bridge()
    const calls: Array<[string, unknown]> = []
    for (const path of ['/send', '/tasks', '/result', '/wait', '/cancel']) {
      bridge.route(path, (_c, body) => { calls.push([path, body]); return { text: `ok ${path}` } })
    }
    const url = await bridge.listen()
    const env = { REGENTE_URL: url, REGENTE_TOKEN: bridge.issueToken('t') }
    const run = async (args: string[]) => { const x = io(env); const code = await runCli(args, x.x); return { code, out: x.out.join('') } }
    expect(await run(['send', 'Dev1', 'implemente', 'o', 'login', '--timeout', '60'])).toEqual({ code: 0, out: 'ok /send\n' })
    expect((await run(['tasks'])).out).toBe('ok /tasks\n')
    expect((await run(['result', '#t1'])).out).toBe('ok /result\n')
    expect((await run(['wait', 't1', '--timeout', '5'])).out).toBe('ok /wait\n')
    expect((await run(['cancel', 't1'])).out).toBe('ok /cancel\n')
    expect(calls).toEqual([
      ['/send', { to: 'Dev1', message: 'implemente o login', timeoutMin: 60 }],
      ['/tasks', {}],
      ['/result', { id: 't1' }],
      ['/wait', { id: 't1', timeoutMin: 5 }],
      ['/cancel', { id: 't1' }]
    ])
  })
  test('send sem tarefa, result sem número → uso', async () => {
    const { x, err } = io({ REGENTE_URL: 'http://127.0.0.1:1', REGENTE_TOKEN: 'x' })
    expect(await runCli(['send', 'Dev1'], x)).toBe(2)
    expect(await runCli(['result'], x)).toBe(2)
    expect(err.join('')).toMatch(/uso: regente send[\s\S]*uso: regente result/)
  })
})

test('peers mostra a branch de quem tem pasta isolada', async () => {
  bridge = new Bridge()
  bridge.route('/peers', () => [{ name: 'Dev1', agent: 'claude', kind: 'terminal', status: 'idle', branch: 'regente/dev1' }])
  const url = await bridge.listen()
  const { x, out } = io({ REGENTE_URL: url, REGENTE_TOKEN: bridge.issueToken('t') })
  expect(await runCli(['peers'], x)).toBe(0)
  expect(out.join('')).toMatch(/Dev1 \(Claude Code\) — livre · branch regente\/dev1/)
})
