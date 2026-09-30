import { EventEmitter } from 'node:events'
import type { Topology } from './topology'

export type AgentStatus = 'idle' | 'working'

export interface AskBrokerDeps {
  topology: Topology
  isRunning(id: string): boolean
  write(id: string, data: string): void
  onData(cb: (id: string, data: string) => void): void
  onGone(cb: (id: string) => void): void
  /** true = o destino avisa sozinho quando termina (hook Stop). */
  supportsHooks(id: string): boolean
  idleMs?: number
  enterDelayMs?: number
  defaultTimeoutMin?: number
}

interface Job {
  fromName: string
  from: string
  to: string
  toName: string
  message: string
  resolve(reply: string): void
  reject(err: Error): void
  timer?: ReturnType<typeof setTimeout>
  submitted: boolean
  captured: string
  idleTimer?: ReturnType<typeof setTimeout>
}

// CSI (cores, cursor), OSC (títulos, links) e demais escapes de 2 caracteres.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function cleanOutput(s: string): string {
  return s.replace(ANSI, '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').trim()
}

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

  constructor(private readonly deps: AskBrokerDeps) {
    super()
    this.idleMs = deps.idleMs ?? 4000
    this.enterDelayMs = deps.enterDelayMs ?? 150
    this.defaultTimeoutMin = deps.defaultTimeoutMin ?? 10
    deps.onData((id, data) => this.onData(id, data))
    deps.onGone((id) => this.onGone(id))
  }

  status(id: string): AgentStatus {
    return this.statuses.get(id) ?? 'idle'
  }

  isBusy(id: string): boolean {
    return this.status(id) === 'working' || this.active.has(id)
  }

  ask(from: string, toName: string, message: string, timeoutMin?: number): Promise<string> {
    const { topology } = this.deps
    const target = topology.findPeer(from, toName)
    if (!target) {
      const names = topology.peers(from).map((n) => n.name)
      return Promise.reject(new Error(`"${toName.trim()}" não está ligado a você. Ligados: ${names.length ? names.join(', ') : 'ninguém'}.`))
    }
    if (target.kind === 'browser') {
      return Promise.reject(new Error(`${target.name} é um navegador: use \`regente browser ...\` para controlá-lo.`))
    }
    if (!this.deps.isRunning(target.id)) return Promise.reject(new Error(`${target.name} não está rodando. Reinicie o terminal dele.`))

    const fromName = topology.node(from)?.node.name ?? 'outro agente'
    const minutes = timeoutMin ?? this.defaultTimeoutMin
    return new Promise<string>((resolve, reject) => {
      const job: Job = { from, fromName, to: target.id, toName: target.name, message, resolve, reject, submitted: false, captured: '' }
      job.timer = setTimeout(() => this.finish(job, new Error(`sem resposta de ${target.name} em ${minutes} min`)), minutes * 60_000)
      const q = this.queues.get(target.id) ?? []
      q.push(job)
      this.queues.set(target.id, q)
      this.pump(target.id)
    })
  }

  hook(id: string, event: string, payload: unknown): void {
    if (event === 'prompt') {
      this.setStatus(id, 'working')
      return
    }
    if (event !== 'stop') return
    this.setStatus(id, 'idle')
    const job = this.active.get(id)
    if (job?.submitted) {
      const reply = (payload as { last_assistant_message?: unknown } | null)?.last_assistant_message
      this.finish(job, typeof reply === 'string' ? reply : '')
    }
    this.pump(id)
  }

  private setStatus(id: string, s: AgentStatus): void {
    if (this.statuses.get(id) === s) return
    this.statuses.set(id, s)
    this.emit('status', id, s)
  }

  private pump(to: string): void {
    if (this.active.has(to) || this.status(to) === 'working') return
    const job = this.queues.get(to)?.shift()
    if (!job) return
    this.active.set(to, job)
    this.emit('flow', job.from, job.to, true)
    if (this.deps.supportsHooks(to)) {
      const text = `[Mensagem de ${job.fromName} via Regente]\n${job.message}`
      this.deps.write(to, `\x1b[200~${text}\x1b[201~`)
    } else {
      this.deps.write(to, job.message)
    }
    setTimeout(() => {
      if (this.active.get(to) !== job) return
      this.deps.write(to, '\r')
      job.submitted = true
      if (!this.deps.supportsHooks(to)) this.armIdle(job)
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

  private onGone(id: string): void {
    const pending = [...(this.active.has(id) ? [this.active.get(id)!] : []), ...(this.queues.get(id) ?? [])]
    this.queues.delete(id)
    this.statuses.delete(id)
    for (const job of pending) this.finish(job, new Error(`${job.toName} foi fechado antes de responder.`), false)
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
    if (outcome instanceof Error) job.reject(outcome)
    else job.resolve(outcome)
    if (pumpNext) this.pump(job.to)
  }
}
