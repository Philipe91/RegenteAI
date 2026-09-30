import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AskBroker } from '../../src/main/bridge/askBroker'
import { Topology } from '../../src/main/bridge/topology'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function setup(opts: { hooks?: string[]; running?: string[] } = {}) {
  const topology = new Topology()
  topology.update('p', [
    { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' },
    { id: 'r', name: 'Revisor', agent: 'claude', kind: 'terminal' },
    { id: 's', name: 'Shell', agent: 'shell', kind: 'terminal' },
    { id: 'b', name: 'Navegador', agent: 'browser', kind: 'browser' },
    { id: 'x', name: 'Solto', agent: 'claude', kind: 'terminal' }
  ], [{ id: 'e1', source: 'l', target: 'r' }, { id: 'e2', source: 'l', target: 's' }, { id: 'e3', source: 'l', target: 'b' }])
  const written: Array<[string, string]> = []
  let dataListener: (id: string, d: string) => void = () => {}
  let goneListener: (id: string) => void = () => {}
  const running = new Set(opts.running ?? ['l', 'r', 's', 'x'])
  const hooks = new Set(opts.hooks ?? ['l', 'r', 'x'])
  let n = 0
  const broker = new AskBroker({
    topology,
    isRunning: (id) => running.has(id),
    write: (id, d) => written.push([id, d]),
    onData: (cb) => { dataListener = cb },
    onGone: (cb) => { goneListener = cb },
    supportsHooks: (id) => hooks.has(id),
    newNonce: () => `n${++n}`,
    idleMs: 4000,
    enterDelayMs: 100
  })
  const statuses: unknown[] = []
  broker.on('status', (...a) => statuses.push(a))
  /** Simula o Claude de destino aceitando a última mensagem colada (hook UserPromptSubmit com o texto). */
  const accept = (id: string) => {
    const paste = [...written].reverse().find(([to, d]) => to === id && d.includes('via Regente'))
    broker.hook(id, 'prompt', { prompt: paste?.[1] ?? '' })
  }
  return {
    broker, topology, written, statuses, accept,
    data: (id: string, d: string) => dataListener(id, d),
    gone: (id: string) => { running.delete(id); goneListener(id) }
  }
}

describe('AskBroker — entrega e resposta', () => {
  test('cola com bracketed paste e marca única, Enter separado, resposta pelo Stop depois de aceito', async () => {
    const { broker, written, accept } = setup()
    const p = broker.ask('l', 'revisor', 'revise o login.ts')
    expect(written[0]).toEqual(['r', '\x1b[200~[Mensagem de Líder via Regente #n1]\nrevise o login.ts\x1b[201~'])
    await vi.advanceTimersByTimeAsync(100)
    expect(written[1]).toEqual(['r', '\r'])
    accept('r')
    broker.hook('r', 'stop', { last_assistant_message: 'Tudo certo, 2 ajustes.' })
    await expect(p).resolves.toBe('Tudo certo, 2 ajustes.')
  })

  test('Stop antes do Claude aceitar a mensagem (turno do usuário) não resolve o pedido', async () => {
    const { broker, accept } = setup()
    const p = broker.ask('l', 'Revisor', 'pergunta real')
    await vi.advanceTimersByTimeAsync(100)
    broker.hook('r', 'stop', { last_assistant_message: 'resposta do turno do usuário' })
    accept('r')
    broker.hook('r', 'stop', { last_assistant_message: 'resposta certa' })
    await expect(p).resolves.toBe('resposta certa')
  })

  test('usuário manda outro prompt no meio do turno do pedido → pedido falha como interrompido', async () => {
    const { broker, accept } = setup()
    const p = broker.ask('l', 'Revisor', 'x')
    await vi.advanceTimersByTimeAsync(100)
    accept('r')
    broker.hook('r', 'prompt', { prompt: 'outra coisa do usuário' })
    await expect(p).rejects.toThrow(/Revisor foi interrompido/)
  })

  test('Stop com stop_hook_active (outro hook bloqueou o fim) é ignorado', async () => {
    const { broker, accept } = setup()
    const p = broker.ask('l', 'Revisor', 'x')
    await vi.advanceTimersByTimeAsync(100)
    accept('r')
    broker.hook('r', 'stop', { stop_hook_active: true, last_assistant_message: 'parcial' })
    broker.hook('r', 'stop', { last_assistant_message: 'final' })
    await expect(p).resolves.toBe('final')
  })

  test('escapes e caracteres de controle na mensagem são removidos (não quebram a colagem)', () => {
    const { broker, written } = setup()
    void broker.ask('l', 'Revisor', 'oi\x1b[201~\r!rm -rf /\x07 fim\n\tok')
    expect(written[0][1]).toBe('\x1b[200~[Mensagem de Líder via Regente #n1]\noi[201~!rm -rf / fim\n\tok\x1b[201~')
  })
})

describe('AskBroker — erros claros', () => {
  test('destino não ligado → lista quem está ligado', async () => {
    const { broker } = setup()
    await expect(broker.ask('l', 'Solto', 'oi')).rejects.toThrow(/"Solto" não está ligado a você\. Ligados: Revisor, Shell, Navegador/)
  })
  test('destino navegador → orienta usar regente browser', async () => {
    const { broker } = setup()
    await expect(broker.ask('l', 'Navegador', 'oi')).rejects.toThrow(/regente browser/)
  })
  test('destino parado → erro claro', async () => {
    const { broker } = setup({ running: ['l', 's'] })
    await expect(broker.ask('l', 'Revisor', 'oi')).rejects.toThrow(/Revisor não está rodando/)
  })
  test('nome repetido entre os ligados → pede para desambiguar', async () => {
    const { broker, topology } = setup()
    topology.update('p', [
      { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' },
      { id: 'r', name: 'Dev', agent: 'claude', kind: 'terminal' },
      { id: 'r2', name: 'dev', agent: 'claude', kind: 'terminal' }
    ], [{ id: 'e1', source: 'l', target: 'r' }, { id: 'e2', source: 'l', target: 'r2' }])
    await expect(broker.ask('l', 'Dev', 'oi')).rejects.toThrow(/mais de um agente chamado "Dev"/)
  })
})

describe('AskBroker — fila, espera e ciclos', () => {
  test('segundo pedido só entra depois que o primeiro termina', async () => {
    const { broker, written, accept } = setup()
    const a = broker.ask('l', 'Revisor', 'um')
    const b = broker.ask('l', 'Revisor', 'dois')
    await vi.advanceTimersByTimeAsync(100)
    expect(written.filter(([, d]) => d.includes('dois'))).toHaveLength(0)
    accept('r'); broker.hook('r', 'stop', { last_assistant_message: 'r1' })
    await expect(a).resolves.toBe('r1')
    await vi.advanceTimersByTimeAsync(100)
    accept('r'); broker.hook('r', 'stop', { last_assistant_message: 'r2' })
    await expect(b).resolves.toBe('r2')
  })

  test('destino trabalhando para o usuário → espera o Stop dele antes de entregar', () => {
    const { broker, written } = setup()
    broker.hook('r', 'prompt', { prompt: 'tarefa do usuário' })
    void broker.ask('l', 'Revisor', 'depois')
    expect(written).toHaveLength(0)
    broker.hook('r', 'stop', { last_assistant_message: 'resposta pro usuário' })
    expect(written).toHaveLength(1)
  })

  test('terminal Claude ainda abrindo → só entrega depois do SessionStart', () => {
    const { broker, written } = setup()
    broker.markStarting('r')
    void broker.ask('l', 'Revisor', 'oi')
    expect(written).toHaveLength(0)
    broker.hook('r', 'session', { source: 'startup' })
    expect(written).toHaveLength(1)
  })

  test('ciclo: B pergunta a A enquanto A espera B → erro imediato, sem travar', async () => {
    const { broker } = setup()
    void broker.ask('l', 'Revisor', 'faça X')
    await expect(broker.ask('r', 'Líder', 'dúvida')).rejects.toThrow(/Líder está esperando uma resposta sua/)
  })

  test('destino sem hooks: mensagem crua e resposta após 4 s de silêncio', async () => {
    const { broker, data, written } = setup()
    const a = broker.ask('l', 'Shell', 'dir')
    expect(written[0]).toEqual(['s', 'dir'])
    await vi.advanceTimersByTimeAsync(100)
    data('s', '\x1b[32mArquivo1\x1b[0m\r\n')
    await vi.advanceTimersByTimeAsync(2000)
    data('s', 'Arquivo2\r\n')
    await vi.advanceTimersByTimeAsync(4000)
    await expect(a).resolves.toBe('Arquivo1\nArquivo2')
  })
})

describe('AskBroker — cancelamentos', () => {
  test('timeout → erro e libera a fila', async () => {
    const { broker, written, accept } = setup()
    const a = broker.ask('l', 'Revisor', 'um', 1)
    const b = broker.ask('l', 'Revisor', 'dois')
    const failA = expect(a).rejects.toThrow(/sem resposta de Revisor em 1 min/)
    await vi.advanceTimersByTimeAsync(60_000)
    await failA
    await vi.advanceTimersByTimeAsync(100)
    expect(written.some(([, d]) => d.includes('dois'))).toBe(true)
    accept('r'); broker.hook('r', 'stop', { last_assistant_message: 'ok' })
    await expect(b).resolves.toBe('ok')
  })

  test('quem perguntou desistiu com o pedido ainda na fila → nunca é entregue', async () => {
    const { broker, written, accept } = setup()
    const a = broker.ask('l', 'Revisor', 'um')
    const ctrl = new AbortController()
    const b = broker.ask('l', 'Revisor', 'dois', undefined, ctrl.signal)
    ctrl.abort()
    await expect(b).rejects.toThrow(/cancelado/)
    await vi.advanceTimersByTimeAsync(100)
    accept('r'); broker.hook('r', 'stop', { last_assistant_message: 'r1' })
    await expect(a).resolves.toBe('r1')
    await vi.advanceTimersByTimeAsync(500)
    expect(written.some(([, d]) => d.includes('dois'))).toBe(false)
  })

  test('desistência depois de entregue: o próximo só entra quando o Revisor terminar', async () => {
    const { broker, written, accept } = setup()
    const ctrl = new AbortController()
    const a = broker.ask('l', 'Revisor', 'um', undefined, ctrl.signal)
    await vi.advanceTimersByTimeAsync(100)
    accept('r')
    ctrl.abort()
    await expect(a).rejects.toThrow(/cancelado/)
    void broker.ask('l', 'Revisor', 'dois')
    expect(written.some(([, d]) => d.includes('dois'))).toBe(false)
    broker.hook('r', 'stop', { last_assistant_message: 'resposta que ninguém espera' })
    expect(written.some(([, d]) => d.includes('dois'))).toBe(true)
  })

  test('destino fechado → erro imediato para todos da fila', async () => {
    const { broker, gone } = setup()
    const a = broker.ask('l', 'Revisor', 'um')
    const b = broker.ask('l', 'Revisor', 'dois')
    gone('r')
    await expect(a).rejects.toThrow(/Revisor foi fechado/)
    await expect(b).rejects.toThrow(/Revisor foi fechado/)
  })

  test('quem perguntou foi fechado → pedidos dele ainda na fila são descartados', async () => {
    const { broker, written, gone, accept } = setup()
    void broker.ask('l', 'Revisor', 'um').catch(() => {})
    void broker.ask('l', 'Revisor', 'dois').catch(() => {})
    gone('l')
    await vi.advanceTimersByTimeAsync(100)
    accept('r'); broker.hook('r', 'stop', { last_assistant_message: 'r1' })
    await vi.advanceTimersByTimeAsync(500)
    expect(written.some(([, d]) => d.includes('dois'))).toBe(false)
  })
})

describe('AskBroker — estado', () => {
  test('prompt → working, stop → idle', () => {
    const { broker, statuses } = setup()
    broker.hook('r', 'prompt', {})
    broker.hook('r', 'stop', {})
    expect(statuses).toEqual([['r', 'working'], ['r', 'idle']])
    expect(broker.status('r')).toBe('idle')
  })
  test('padrão de timeout é 9 min (abaixo do limite de 10 min do shell do Claude)', async () => {
    const { broker } = setup()
    const p = broker.ask('l', 'Revisor', 'x')
    const fail = expect(p).rejects.toThrow(/em 9 min/)
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    await fail
  })
})
