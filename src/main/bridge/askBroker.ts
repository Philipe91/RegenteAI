import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { Topology } from './topology'

export type AgentStatus = 'idle' | 'working' | 'starting'

export interface AskBrokerDeps {
  topology: Topology
  isRunning(id: string): boolean
  write(id: string, data: string): void
  onData(cb: (id: string, data: string) => void): void
  onGone(cb: (id: string) => void): void
  /** true = o destino avisa sozinho quando começa e termina (hooks do Claude). */
  supportsHooks(id: string): boolean
  newNonce?(): string
  idleMs?: number
  enterDelayMs?: number
  defaultTimeoutMin?: number
}

interface Job {
  from: string
  fromName: string
  to: string
  toName: string
  message: string
  nonce: string
  resolve(reply: string): void
  reject(err: Error): void
  timer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
  /** Enter já foi enviado. */
  submitted: boolean
  /** O Claude de destino começou o turno com a nossa mensagem (hook UserPromptSubmit com a marca). */
  accepted: boolean
  /** Quem perguntou desistiu; o pedido só ocupa o destino até ele terminar. */
  orphan: boolean
  captured: string
}

// CSI (cores, cursor), OSC (títulos, links) e demais escapes de 2 caracteres.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** Tira ESC e demais caracteres de controle (menos quebra de linha e tab): nada escapa da colagem. */
export function sanitize(s: string): string {
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

export function cleanOutput(s: string): string {
  return s.replace(ANSI, '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').trim()
}

const norm = (s: string) => s.trim().toLocaleLowerCase('pt-BR')

/**
 * Leva o pedido de um agente até outro e traz a resposta de volta.
 * Um pedido por destino de cada vez; os demais esperam na fila.
 */
export class AskBroker extends EventEmitter {
  private statuses = new Map<string, AgentStatus>()
  private queues = new Map<string, Job[]>()
  private active = new Map<string, Job>()
  private readonly idleMs: number
  private readonly enterDelayMs: number
  private readonly defaultTimeoutMin: number
  private readonly newNonce: () => string

  constructor(private readonly deps: AskBrokerDeps) {
    super()
    this.idleMs = deps.idleMs ?? 4000
    this.enterDelayMs = deps.enterDelayMs ?? 150
    // Abaixo dos 10 min máximos da ferramenta de shell do Claude, para o erro chegar antes do corte.
    this.defaultTimeoutMin = deps.defaultTimeoutMin ?? 9
    this.newNonce = deps.newNonce ?? (() => randomBytes(3).toString('hex'))
    deps.onData((id, data) => this.onData(id, data))
    deps.onGone((id) => this.onGone(id))
  }

  status(id: string): AgentStatus {
    return this.statuses.get(id) ?? 'idle'
  }

  isBusy(id: string): boolean {
    return this.status(id) !== 'idle' || this.active.has(id)
  }

  /** Terminal com hooks acabou de abrir: nada é entregue até o SessionStart. */
  markStarting(id: string): void {
    if (this.deps.supportsHooks(id)) this.setStatus(id, 'starting')
  }

  ask(from: string, toName: string, message: string, timeoutMin?: number, signal?: AbortSignal): Promise<string> {
    const { topology } = this.deps
    const matches = topology.peers(from).filter((n) => norm(n.name) === norm(toName))
    if (matches.length > 1) {
      return Promise.reject(new Error(`Há mais de um agente chamado "${toName.trim()}" ligado a você. Renomeie um deles.`))
    }
    const target = matches[0]
    if (!target) {
      const names = topology.peers(from).map((n) => n.name)
      return Promise.reject(new Error(`"${toName.trim()}" não está ligado a você. Ligados: ${names.length ? names.join(', ') : 'ninguém'}.`))
    }
    if (target.kind === 'browser') {
      return Promise.reject(new Error(`${target.name} é um navegador: use \`regente browser ...\` para controlá-lo.`))
    }
    if (!this.deps.isRunning(target.id)) return Promise.reject(new Error(`${target.name} não está rodando. Reinicie o terminal dele.`))
    if (this.waitsFor(target.id, from)) {
      return Promise.reject(new Error(`${target.name} está esperando uma resposta sua; responda a ele em vez de perguntar de volta.`))
    }
    if (signal?.aborted) return Promise.reject(new Error('pedido cancelado'))

    const fromName = sanitize(topology.node(from)?.node.name ?? 'outro agente')
    const minutes = timeoutMin ?? this.defaultTimeoutMin
    return new Promise<string>((resolve, reject) => {
      const job: Job = {
        from, fromName, to: target.id, toName: target.name, message: sanitize(message), nonce: this.newNonce(),
        resolve, reject, submitted: false, accepted: false, orphan: false, captured: ''
      }
      job.timer = setTimeout(() => this.finish(job, new Error(`sem resposta de ${target.name} em ${minutes} min`)), minutes * 60_000)
      signal?.addEventListener('abort', () => this.cancel(job), { once: true })
      const q = this.queues.get(target.id) ?? []
      q.push(job)
      this.queues.set(target.id, q)
      this.pump(target.id)
    })
  }

  hook(id: string, event: string, payload: unknown): void {
    const p = (payload ?? {}) as { prompt?: unknown; last_assistant_message?: unknown; stop_hook_active?: unknown }
    if (event === 'session') {
      this.setStatus(id, 'idle')
      this.pump(id)
      return
    }
    const job = this.active.get(id)
    if (event === 'prompt') {
      const prompt = typeof p.prompt === 'string' ? p.prompt : ''
      if (job?.submitted && !job.accepted && prompt.includes(`#${job.nonce}]`)) job.accepted = true
      else if (job?.accepted) this.finish(job, new Error(`${job.toName} foi interrompido antes de responder.`), false)
      this.setStatus(id, 'working')
      return
    }
    if (event !== 'stop') return
    // Outro hook do usuário mandou o Claude continuar: o turno ainda não acabou.
    if (p.stop_hook_active === true) return
    this.setStatus(id, 'idle')
    this.emit('turn-end', id, typeof p.last_assistant_message === 'string' ? p.last_assistant_message : '')
    if (job?.accepted) this.finish(job, typeof p.last_assistant_message === 'string' ? p.last_assistant_message : '')
    this.pump(id)
  }

  /** Existe uma cadeia de pedidos em que `start` espera (direta ou indiretamente) por `goal`? */
  private waitsFor(start: string, goal: string): boolean {
    const edges: Array<[string, string]> = []
    for (const j of this.active.values()) if (!j.orphan) edges.push([j.from, j.to])
    for (const q of this.queues.values()) for (const j of q) edges.push([j.from, j.to])
    const seen = new Set<string>()
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === goal) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const [a, b] of edges) if (a === cur) stack.push(b)
    }
    return false
  }

  private setStatus(id: string, s: AgentStatus): void {
    if (this.statuses.get(id) === s) return
    this.statuses.set(id, s)
    this.emit('status', id, s)
  }

  private pump(to: string): void {
    if (this.active.has(to) || this.status(to) !== 'idle') return
    const job = this.queues.get(to)?.shift()
    if (!job) return
    this.active.set(to, job)
    this.emit('flow', job.from, job.to, true)
    const hooks = this.deps.supportsHooks(to)
    if (hooks) this.deps.write(to, `\x1b[200~[Mensagem de ${job.fromName} via Regente #${job.nonce}]\n${job.message}\x1b[201~`)
    else this.deps.write(to, job.message)
    setTimeout(() => {
      if (this.active.get(to) !== job) return
      this.deps.write(to, '\r')
      job.submitted = true
      if (!hooks) this.armIdle(job)
    }, this.enterDelayMs)
  }

  private onData(id: string, data: string): void {
    const job = this.active.get(id)
    if (!job || !job.submitted || this.deps.supportsHooks(id)) return
    job.captured += data
    this.armIdle(job)
  }

  private armIdle(job: Job): void {
    if (job.idleTimer) clearTimeout(job.idleTimer)
    job.idleTimer = setTimeout(() => this.finish(job, cleanOutput(job.captured)), this.idleMs)
  }

  /** Quem perguntou desistiu: some da fila; se já foi entregue, só segura o destino até ele terminar. */
  private cancel(job: Job): void {
    if (job.orphan) return
    const err = new Error('pedido cancelado (quem perguntou desistiu ou foi fechado)')
    if (this.active.get(job.to) === job) {
      job.orphan = true
      job.reject(err)
      return
    }
    const q = this.queues.get(job.to)
    if (!q?.includes(job)) return
    this.queues.set(job.to, q.filter((j) => j !== job))
    if (job.timer) clearTimeout(job.timer)
    job.reject(err)
  }

  private onGone(id: string): void {
    const toMe = [...(this.active.has(id) ? [this.active.get(id)!] : []), ...(this.queues.get(id) ?? [])]
    this.queues.delete(id)
    this.statuses.delete(id)
    for (const job of toMe) this.finish(job, new Error(`${job.toName} foi fechado antes de responder.`), false)
    // Pedidos que este terminal fez a outros: ninguém mais espera por eles.
    const fromMe = [...this.active.values(), ...[...this.queues.values()].flat()].filter((j) => j.from === id)
    fromMe.forEach((j) => this.cancel(j))
  }

  private finish(job: Job, outcome: string | Error, pumpNext = true): void {
    if (job.timer) clearTimeout(job.timer)
    if (job.idleTimer) clearTimeout(job.idleTimer)
    if (this.active.get(job.to) === job) {
      this.active.delete(job.to)
      this.emit('flow', job.from, job.to, false)
    } else {
      const q = this.queues.get(job.to)
      if (q) this.queues.set(job.to, q.filter((j) => j !== job))
    }
    if (!job.orphan) {
      if (outcome instanceof Error) job.reject(outcome)
      else job.resolve(outcome)
    }
    if (pumpNext) this.pump(job.to)
  }
}
