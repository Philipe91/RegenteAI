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
  const broker = new AskBroker({
    topology,
    isRunning: (id) => running.has(id),
    write: (id, d) => written.push([id, d]),
    onData: (cb) => { dataListener = cb },
    onGone: (cb) => { goneListener = cb },
    supportsHooks: (id) => hooks.has(id),
    idleMs: 4000,
    enterDelayMs: 100
  })
  const statuses: unknown[] = []
  broker.on('status', (...a) => statuses.push(a))
  return { broker, written, statuses, data: (id: string, d: string) => dataListener(id, d), gone: (id: string) => { running.delete(id); goneListener(id) } }
}

describe('AskBroker', () => {
  test('entrega com bracketed paste, Enter separado, e devolve a resposta do hook Stop', async () => {
    const { broker, written } = setup()
    const p = broker.ask('l', 'revisor', 'revise o login.ts')
    expect(written[0][0]).toBe('r')
    expect(written[0][1]).toBe('\x1b[200~[Mensagem de Líder via Regente]\nrevise o login.ts\x1b[201~')
    await vi.advanceTimersByTimeAsync(100)
    expect(written[1]).toEqual(['r', '\r'])
    broker.hook('r', 'stop', { last_assistant_message: 'Tudo certo, 2 ajustes.' })
    await expect(p).resolves.toBe('Tudo certo, 2 ajustes.')
  })

  test('destino não ligado → erro com a lista de quem está ligado', async () => {
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

  test('fila: segundo pedido só entra depois que o primeiro termina', async () => {
    const { broker, written } = setup()
    const a = broker.ask('l', 'Revisor', 'um')
    const b = broker.ask('l', 'Revisor', 'dois')
    await vi.advanceTimersByTimeAsync(100)
    expect(written.filter(([, d]) => d.includes('dois'))).toHaveLength(0)
    broker.hook('r', 'stop', { last_assistant_message: 'r1' })
    await expect(a).resolves.toBe('r1')
    await vi.advanceTimersByTimeAsync(100)
    expect(written.filter(([, d]) => d.includes('dois'))).toHaveLength(1)
    broker.hook('r', 'stop', { last_assistant_message: 'r2' })
    await expect(b).resolves.toBe('r2')
  })

  test('destino ocupado com trabalho do usuário → espera o Stop dele antes de entregar', async () => {
    const { broker, written } = setup()
    broker.hook('r', 'prompt', { prompt: 'tarefa do usuário' })
    const a = broker.ask('l', 'Revisor', 'depois')
    expect(written).toHaveLength(0)
    broker.hook('r', 'stop', { last_assistant_message: 'resposta pro usuário' })
    expect(written).toHaveLength(1)
    broker.hook('r', 'stop', { last_assistant_message: 'eco antes do Enter' })
    await vi.advanceTimersByTimeAsync(100)
    broker.hook('r', 'stop', { last_assistant_message: 'resposta pro Líder' })
    await expect(a).resolves.toBe('resposta pro Líder')
  })

  test('destino sem hooks: resposta é a saída limpa depois de 4 s de silêncio', async () => {
    const { broker, data } = setup()
    const a = broker.ask('l', 'Shell', 'dir')
    await vi.advanceTimersByTimeAsync(100)
    data('s', '\x1b[32mArquivo1\x1b[0m\r\n')
    await vi.advanceTimersByTimeAsync(2000)
    data('s', 'Arquivo2\r\n')
    await vi.advanceTimersByTimeAsync(3999)
    let done = false
    void a.then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(a).resolves.toBe('Arquivo1\nArquivo2')
  })

  test('timeout → erro e libera a fila', async () => {
    const { broker, written } = setup()
    const a = broker.ask('l', 'Revisor', 'um', 1)
    const b = broker.ask('l', 'Revisor', 'dois')
    const failA = expect(a).rejects.toThrow(/sem resposta de Revisor em 1 min/)
    await vi.advanceTimersByTimeAsync(60_000)
    await failA
    await vi.advanceTimersByTimeAsync(100)
    expect(written.some(([, d]) => d.includes('dois'))).toBe(true)
    broker.hook('r', 'stop', { last_assistant_message: 'ok' })
    await expect(b).resolves.toBe('ok')
  })

  test('destino fechado no meio → erro imediato para todos da fila', async () => {
    const { broker, gone } = setup()
    const a = broker.ask('l', 'Revisor', 'um')
    const b = broker.ask('l', 'Revisor', 'dois')
    gone('r')
    await expect(a).rejects.toThrow(/Revisor foi fechado/)
    await expect(b).rejects.toThrow(/Revisor foi fechado/)
  })

  test('status: prompt → working, stop → idle', () => {
    const { broker, statuses } = setup()
    broker.hook('r', 'prompt', {})
    broker.hook('r', 'stop', {})
    expect(statuses).toEqual([['r', 'working'], ['r', 'idle']])
    expect(broker.status('r')).toBe('idle')
  })
})
