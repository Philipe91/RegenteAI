import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Orchestrator } from '../../src/main/bridge/orchestrator'
import { Topology } from '../../src/main/bridge/topology'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/**
 * Canvas de teste:  Líder ─ Dev1, Líder ─ Dev2, Líder ─ Shell, Líder ─ Navegador, Dev1 ─ Dev2
 * Todos os Claude começam prontos (idle), como se o SessionStart já tivesse chegado.
 */
function setup(opts: { running?: string[] } = {}) {
  const topology = new Topology()
  topology.update('p', [
    { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' },
    { id: 'd1', name: 'Dev1', agent: 'claude', kind: 'terminal' },
    { id: 'd2', name: 'Dev2', agent: 'claude', kind: 'terminal' },
    { id: 's', name: 'Shell', agent: 'shell', kind: 'terminal' },
    { id: 'b', name: 'Navegador', agent: 'browser', kind: 'browser' }
  ], [
    { id: 'e1', source: 'l', target: 'd1' }, { id: 'e2', source: 'l', target: 'd2' },
    { id: 'e3', source: 'l', target: 's' }, { id: 'e4', source: 'l', target: 'b' }, { id: 'e5', source: 'd1', target: 'd2' }
  ])
  const written: Array<[string, string]> = []
  let onData: (id: string, d: string) => void = () => {}
  let onGone: (id: string) => void = () => {}
  let onReset: (id: string) => void = () => {}
  const running = new Set(opts.running ?? ['l', 'd1', 'd2', 's'])
  const hooks = new Set(['l', 'd1', 'd2'])
  let n = 0
  const o = new Orchestrator({
    topology,
    isRunning: (id) => running.has(id),
    write: (id, d) => written.push([id, d]),
    onData: (cb) => { onData = cb },
    onGone: (cb) => { onGone = cb },
    onReset: (cb) => { onReset = cb },
    supportsHooks: (id) => hooks.has(id),
    newNonce: () => `n${++n}`,
    enterDelayMs: 100
  })
  const events: unknown[][] = []
  for (const ev of ['status', 'turn-end', 'needs-user', 'notice', 'paused', 'queue']) o.on(ev, (...a) => events.push([ev, ...a]))
  /** Última colagem feita no terminal `id`. */
  const lastPaste = (id: string) => [...written].reverse().find(([to, d]) => to === id && d.includes('via Regente'))?.[1] ?? ''
  /** O Claude de `id` aceita a última mensagem colada (UserPromptSubmit com o texto). */
  const accept = (id: string) => o.hook(id, 'prompt', { prompt: lastPaste(id) })
  const stop = (id: string, msg: string) => o.hook(id, 'stop', { last_assistant_message: msg })
  const enter = () => vi.advanceTimersByTimeAsync(100)
  return {
    o, topology, written, events, lastPaste, accept, stop, enter, running,
    data: (id: string, d: string) => onData(id, d),
    gone: (id: string) => { running.delete(id); onGone(id) },
    reset: (id: string) => onReset(id)
  }
}

// ───────────────────────────── ask (pergunta rápida, síncrona) ─────────────────────────────
describe('ask', () => {
  test('entrega com marca única, Enter separado; responde com o Stop do turno aceito', async () => {
    const t = setup()
    const p = t.o.ask('l', 'dev1', 'o login está ok?')
    expect(t.written[0]).toEqual(['d1', '\x1b[200~[Mensagem de Líder via Regente #n1]\no login está ok?\x1b[201~'])
    await t.enter()
    expect(t.written[1]).toEqual(['d1', '\r'])
    t.accept('d1')
    t.stop('d1', 'Sim, 1 ajuste.')
    await expect(p).resolves.toBe('Sim, 1 ajuste.')
  })

  test('Stop de um turno que não é o nosso não responde; o nosso sim', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    await t.enter()
    t.stop('d1', 'turno do usuário')
    t.accept('d1')
    t.stop('d1', 'certo')
    await expect(p).resolves.toBe('certo')
  })

  test('todo Stop encerra o turno (inclusive com stop_hook_active)', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.o.hook('d1', 'stop', { stop_hook_active: true, last_assistant_message: 'final' })
    await expect(p).resolves.toBe('final')
  })

  test('usuário manda outro prompt no meio do turno aceito → interrompido', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.o.hook('d1', 'prompt', { prompt: 'outra coisa' })
    await expect(p).rejects.toThrow(/Dev1 foi interrompido/)
  })

  test('usuário apertou Enter antes do nosso Enter (marca chega mesmo assim) → aceito', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    t.accept('d1')
    await t.enter()
    t.stop('d1', 'ok')
    await expect(p).resolves.toBe('ok')
  })

  test('controles e ESC removidos (nada escapa da colagem)', () => {
    const t = setup()
    void t.o.ask('l', 'Dev1', 'oi\x1b[201~\r!rm -rf /\x07 fim\n\tok')
    expect(t.written[0][1]).toBe('\x1b[200~[Mensagem de Líder via Regente #n1]\noi[201~!rm -rf / fim\n\tok\x1b[201~')
  })

  test('ciclo de perguntas síncronas → erro imediato', async () => {
    const t = setup()
    void t.o.ask('l', 'Dev1', 'x')
    await expect(t.o.ask('d1', 'Líder', 'dúvida')).rejects.toThrow(/Líder está esperando uma resposta sua/)
  })

  test('shell: mensagem crua e resposta após silêncio', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Shell', 'dir')
    expect(t.written[0]).toEqual(['s', 'dir'])
    await t.enter()
    t.data('s', '\x1b[32mA\x1b[0m\r\n')
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toBe('A')
  })

  test('erros claros: não ligado, navegador, parado, nome repetido', async () => {
    const t = setup({ running: ['l', 's'] })
    await expect(t.o.ask('l', 'Fulano', 'x')).rejects.toThrow(/"Fulano" não está ligado a você\. Ligados: Dev1, Dev2, Shell, Navegador/)
    await expect(t.o.ask('l', 'Navegador', 'x')).rejects.toThrow(/regente browser/)
    await expect(t.o.ask('l', 'Dev1', 'x')).rejects.toThrow(/Dev1 não está rodando/)
    t.topology.update('p', [
      { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' },
      { id: 'a', name: 'Dev', agent: 'claude', kind: 'terminal' },
      { id: 'b2', name: 'dev', agent: 'claude', kind: 'terminal' }
    ], [{ id: 'x', source: 'l', target: 'a' }, { id: 'y', source: 'l', target: 'b2' }])
    await expect(t.o.ask('l', 'Dev', 'x')).rejects.toThrow(/mais de um agente chamado "Dev"/)
  })

  test('timeout padrão de 9 min (aceito e trabalhando, mas sem terminar)', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    const fail = expect(p).rejects.toThrow(/sem resposta de Dev1 em 9 min/)
    await t.enter()
    t.accept('d1')
    for (let i = 0; i < 18; i++) { await vi.advanceTimersByTimeAsync(30_000); t.data('d1', '✻') }
    await fail
  })

  test('quem perguntou desiste: na fila some; entregue e não aceito libera na hora', async () => {
    const t = setup()
    const c1 = new AbortController()
    const p1 = t.o.ask('l', 'Dev1', 'um', undefined, c1.signal)
    const c2 = new AbortController()
    const p2 = t.o.ask('l', 'Dev1', 'dois', undefined, c2.signal)
    c2.abort()
    await expect(p2).rejects.toThrow(/cancelado/)
    c1.abort()
    await expect(p1).rejects.toThrow(/cancelado/)
    void t.o.ask('l', 'Dev1', 'três')
    expect(t.lastPaste('d1')).toContain('três')
    expect(t.written.some(([, d]) => d.includes('dois'))).toBe(false)
  })

  test('desistência depois de aceito: destino termina o turno antes do próximo', async () => {
    const t = setup()
    const c = new AbortController()
    const p = t.o.ask('l', 'Dev1', 'um', undefined, c.signal)
    await t.enter()
    t.accept('d1')
    c.abort()
    await expect(p).rejects.toThrow(/cancelado/)
    void t.o.ask('l', 'Dev1', 'dois')
    expect(t.lastPaste('d1')).not.toContain('dois')
    t.stop('d1', 'descartada')
    expect(t.lastPaste('d1')).toContain('dois')
  })
})

// ───────────────────────────── send (tarefa assíncrona) ─────────────────────────────
describe('send — tarefas assíncronas', () => {
  test('responde na hora com número e posição; o Líder fica livre', () => {
    const t = setup()
    const r = t.o.send('l', 'Dev1', 'implemente o login')
    expect(r).toEqual({ id: 't1', position: 0, toName: 'Dev1' })
    expect(t.lastPaste('d1')).toBe('\x1b[200~[Tarefa #t1 de Líder via Regente #n1]\nimplemente o login\x1b[201~')
    expect(t.o.status('l')).toBe('idle')
  })

  test('paralelo: duas tarefas para dois Devs são entregues ao mesmo tempo', () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'login')
    t.o.send('l', 'Dev2', 'cadastro')
    expect(t.lastPaste('d1')).toContain('login')
    expect(t.lastPaste('d2')).toContain('cadastro')
  })

  test('resultado volta sozinho para o Líder quando ele estiver livre', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'login')
    await t.enter()
    t.accept('d1')
    t.o.hook('l', 'prompt', { prompt: 'usuário conversando com o Líder' })
    t.stop('d1', 'Login pronto, 12 testes passando.')
    expect(t.lastPaste('l')).toBe('')
    expect(t.o.task('l', 't1')).toMatchObject({ state: 'done', result: 'Login pronto, 12 testes passando.' })
    t.stop('l', 'resposta ao usuário')
    expect(t.lastPaste('l')).toBe('\x1b[200~[Resposta de Dev1 · tarefa #t1 via Regente #n2]\nLogin pronto, 12 testes passando.\x1b[201~')
  })

  test('entrega de resultado termina quando o Líder aceita; a fila do Líder anda só depois do Stop dele', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'a')
    t.o.send('l', 'Dev2', 'b')
    await t.enter()
    t.accept('d1'); t.accept('d2')
    t.stop('d1', 'A feito')
    t.stop('d2', 'B feito')
    expect(t.lastPaste('l')).toContain('A feito')
    await t.enter()
    t.accept('l')
    expect(t.lastPaste('l')).toContain('A feito')
    t.stop('l', 'ok, aguardando B')
    expect(t.lastPaste('l')).toContain('B feito')
  })

  test('fila por destino: segunda tarefa para o mesmo Dev espera', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'primeira')
    const r = t.o.send('l', 'Dev1', 'segunda')
    expect(r.position).toBe(1)
    await t.enter()
    t.accept('d1')
    expect(t.lastPaste('d1')).toContain('primeira')
    t.stop('d1', 'ok')
    expect(t.lastPaste('d1')).toContain('segunda')
  })

  test('send não cria espera: A e B mandando tarefas um ao outro é permitido', () => {
    const t = setup()
    t.o.send('d1', 'Dev2', 'x')
    expect(() => t.o.send('d2', 'Dev1', 'y')).not.toThrow()
  })

  test('falha vira resposta: destino interrompido', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.o.hook('d1', 'prompt', { prompt: 'usuário mexeu' })
    expect(t.o.task('l', 't1')).toMatchObject({ state: 'failed' })
    expect(t.lastPaste('l')).toMatch(/\[Tarefa #t1 para Dev1 falhou via Regente #n\d+\]\nDev1 foi interrompido/)
  })

  test('falha vira resposta: tempo esgotado (padrão 120 min)', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    for (let i = 0; i < 240; i++) { await vi.advanceTimersByTimeAsync(30_000); t.data('d1', '✻') }
    expect(t.o.task('l', 't1')).toMatchObject({ state: 'failed', error: expect.stringMatching(/120 min/) })
  })

  test('resultado de tarefa para quem é shell fica guardado (não é colado)', async () => {
    const t = setup()
    t.topology.update('p', [
      { id: 's', name: 'Shell', agent: 'shell', kind: 'terminal' },
      { id: 'd1', name: 'Dev1', agent: 'claude', kind: 'terminal' }
    ], [{ id: 'e', source: 's', target: 'd1' }])
    t.o.send('s', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.stop('d1', 'feito')
    expect(t.written.filter(([id]) => id === 's')).toHaveLength(0)
    expect(t.o.task('s', 't1')).toMatchObject({ state: 'done', result: 'feito' })
  })

  test('wait espera o resultado; tasks lista enviadas e recebidas', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'x')
    const w = t.o.wait('l', 't1')
    await t.enter()
    t.accept('d1')
    expect(t.o.tasks('l').sent[0]).toMatchObject({ id: 't1', state: 'working' })
    expect(t.o.tasks('d1').received[0]).toMatchObject({ id: 't1', state: 'working' })
    t.stop('d1', 'pronto')
    await expect(w).resolves.toMatchObject({ state: 'done', result: 'pronto' })
  })

  test('task de outro terminal não pode ser lida', () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'x')
    expect(() => t.o.task('d2', 't1')).toThrow(/não é sua/)
  })

  test('cancelar: na fila some; aceita vira descartada e segura o Dev até o Stop', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'um')
    t.o.send('l', 'Dev1', 'dois')
    expect(t.o.cancel('l', 't2')).toMatch(/cancelada/)
    await t.enter()
    t.accept('d1')
    expect(t.o.cancel('l', 't1')).toMatch(/descartad/)
    t.o.send('l', 'Dev1', 'três')
    expect(t.lastPaste('d1')).not.toContain('três')
    t.stop('d1', 'ignorado')
    expect(t.lastPaste('d1')).toContain('três')
    expect(t.lastPaste('l')).toBe('')
  })
})

// ───────────────────────────── ciclo de vida dos terminais ─────────────────────────────
describe('terminais abrindo, reiniciados e fechados', () => {
  test('abrindo: só entrega depois do SessionStart; SessionStart no meio do turno (compact) é ignorado', () => {
    const t = setup()
    t.o.markStarting('d1')
    t.o.send('l', 'Dev1', 'x')
    expect(t.lastPaste('d1')).toBe('')
    t.o.hook('d1', 'session', { source: 'startup' })
    expect(t.lastPaste('d1')).toContain('x')
    t.o.hook('d1', 'prompt', { prompt: 'outra' })
    t.o.hook('d1', 'session', { source: 'compact' })
    expect(t.o.status('d1')).toBe('working')
  })

  test('agente que não confirma que abriu → aviso de "precisa de você" (sem colar nada)', async () => {
    const t = setup()
    t.o.markStarting('d1')
    t.o.send('l', 'Dev1', 'x')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.events.some((e) => e[0] === 'needs-user' && e[1] === 'd1')).toBe(true)
    expect(t.lastPaste('d1')).toBe('')
  })

  test('reiniciar o Dev: tarefa dele falha (volta ao Líder); resultados pendentes para o Líder sobrevivem ao reinício dele', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.reset('d1')
    expect(t.o.task('l', 't1')).toMatchObject({ state: 'failed', error: expect.stringMatching(/reiniciado/) })
    t.o.hook('l', 'prompt', { prompt: 'ocupado' })
    t.reset('l')
    t.o.markStarting('l')
    t.o.hook('l', 'session', { source: 'resume' })
    expect(t.lastPaste('l')).toMatch(/tarefa #t1 para Dev1 falhou/i)
  })

  test('fechar o Líder (remover do canvas) cancela as tarefas que ele mandou', async () => {
    const t = setup()
    t.o.send('l', 'Dev1', 'um')
    t.o.send('l', 'Dev1', 'dois')
    t.gone('l')
    expect(t.o.tasks('d1').received.map((r) => r.state)).toEqual(['cancelled', 'cancelled'])
    await t.enter()
    t.accept('d1')
    t.stop('d1', 'ok')
    expect(t.written.some(([, d]) => d.includes('dois'))).toBe(false)
  })

  test('fechar o Dev → tudo que era para ele falha na hora', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    t.o.send('l', 'Dev1', 'y')
    t.gone('d1')
    await expect(p).rejects.toThrow(/Dev1 foi fechado/)
    expect(t.o.task('l', 't1')).toMatchObject({ state: 'failed' })
  })
})

// ───────────────────────────── vigias ─────────────────────────────
describe('vigias', () => {
  test('mensagem colada não aceita em 30 s com o destino livre → falha clara', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    const fail = expect(p).rejects.toThrow(/não chegou/)
    await t.enter()
    await vi.advanceTimersByTimeAsync(30_000)
    await fail
  })

  test('destino ocupado com o usuário: a colagem espera na fila do próprio Claude (não falha)', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    await t.enter()
    t.o.hook('d1', 'prompt', { prompt: 'usuário' })
    await vi.advanceTimersByTimeAsync(40_000)
    t.data('d1', 'spinner')
    t.stop('d1', 'resposta ao usuário')
    t.accept('d1')
    t.stop('d1', 'nossa resposta')
    await expect(p).resolves.toBe('nossa resposta')
  })

  test('Esc: trabalhando sem nenhuma saída por 45 s → volta a livre e o pedido aceito falha', async () => {
    const t = setup()
    const p = t.o.ask('l', 'Dev1', 'x')
    const fail = expect(p).rejects.toThrow(/parou sem terminar/)
    await t.enter()
    t.accept('d1')
    await vi.advanceTimersByTimeAsync(45_000)
    await fail
    expect(t.o.status('d1')).toBe('idle')
  })

  test('saída contínua mantém "trabalhando"', async () => {
    const t = setup()
    t.o.hook('d1', 'prompt', { prompt: 'tarefa' })
    for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(10_000); t.data('d1', '✻') }
    expect(t.o.status('d1')).toBe('working')
  })

  test('pedido de permissão (Notification) → precisa de você; voltar a ter saída → trabalhando', async () => {
    const t = setup()
    t.o.hook('d1', 'prompt', { prompt: 'x' })
    t.o.hook('d1', 'notification', { message: 'Claude needs your permission to use Bash' })
    expect(t.o.status('d1')).toBe('needs-user')
    expect(t.events).toContainEqual(['needs-user', 'd1', 'Claude needs your permission to use Bash'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.o.status('d1')).toBe('needs-user')
    t.data('d1', 'continua')
    expect(t.o.status('d1')).toBe('working')
  })

  test('Notification com o agente livre (só lembrete de inatividade) é ignorada', () => {
    const t = setup()
    t.o.hook('d1', 'notification', { message: 'Claude is waiting for your input' })
    expect(t.o.status('d1')).toBe('idle')
  })

  test('freio de laços: mais de 30 entregas em 10 min para o mesmo terminal pausa; Retomar continua', async () => {
    const t = setup()
    for (let i = 0; i < 31; i++) {
      t.o.send('d1', 'Dev2', `m${i}`)
      await t.enter()
      t.accept('d2')
      t.stop('d2', `r${i}`)
    }
    expect(t.o.isPaused('d2')).toBe(true)
    expect(t.events).toContainEqual(['paused', 'd2', true])
    const before = t.written.length
    t.o.resume('d2')
    expect(t.written.length).toBeGreaterThan(before)
  })
})

// ───────────────────────────── fim de turno (notificações) ─────────────────────────────
describe('fim de turno', () => {
  test('turno que atendeu outro agente é marcado como servedAgent (não notifica)', async () => {
    const t = setup()
    void t.o.ask('l', 'Dev1', 'x')
    await t.enter()
    t.accept('d1')
    t.stop('d1', 'r')
    t.o.hook('l', 'prompt', { prompt: 'do usuário' })
    t.stop('l', 'fim')
    expect(t.events.filter((e) => e[0] === 'turn-end')).toEqual([['turn-end', 'd1', 'r', true], ['turn-end', 'l', 'fim', false]])
  })
})
