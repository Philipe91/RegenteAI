import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { Topology, TopoNode } from './topology'

/**
 * Orquestrador: leva mensagens e tarefas de um agente até outro e traz os resultados de volta.
 *
 * Estados de cada terminal (só os que têm hooks — Claude):
 *   starting   abriu, ainda não confirmou (SessionStart)      → nada é entregue
 *   idle       livre                                           → recebe a próxima entrega da fila
 *   working    num turno (UserPromptSubmit)                    → espera o Stop
 *   needs-user parado pedindo algo a você (Notification)       → espera você
 *
 * Tipos de entrega (uma por destino de cada vez, em fila):
 *   ask     pergunta rápida; quem pergunta fica esperando (regente ask)
 *   task    tarefa assíncrona; quem manda segue livre (regente send) e recebe um `result` depois
 *   result  resposta/falha de uma tarefa, colada no terminal de quem mandou
 *
 * Toda entrega leva uma marca única (#nonce). O turno só é "nosso" quando o UserPromptSubmit
 * traz essa marca — assim a resposta nunca vem do turno errado.
 */

export type AgentStatus = 'starting' | 'idle' | 'working' | 'needs-user'
export type TaskState = 'queued' | 'delivered' | 'working' | 'done' | 'failed' | 'cancelled'

export interface TaskRecord {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  message: string
  state: TaskState
  result?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

export interface OrchestratorDeps {
  topology: Topology
  isRunning(id: string): boolean
  write(id: string, data: string): void
  onData(cb: (id: string, data: string) => void): void
  /** Terminal removido de vez (fechado pelo usuário). */
  onGone(cb: (id: string) => void): void
  /** Processo reiniciado ou encerrado; o nó continua no canvas. */
  onReset(cb: (id: string) => void): void
  supportsHooks(id: string): boolean
  newNonce?(): string
  idleMs?: number
  enterDelayMs?: number
  askTimeoutMin?: number
  taskTimeoutMin?: number
  acceptMs?: number
  quietMs?: number
  startingMs?: number
  loopLimit?: number
  loopWindowMs?: number
}

type JobKind = 'ask' | 'task' | 'result'

interface Job {
  kind: JobKind
  taskId?: string
  from: string
  to: string
  toName: string
  header: string
  body: string
  nonce: string
  /** Texto já colado no terminal. */
  submitted: boolean
  /** Enter já enviado (para shells, a captura da saída começa aqui). */
  entered: boolean
  /** O Claude começou o turno com a nossa mensagem. */
  accepted: boolean
  /** Ninguém espera mais o resultado; só ocupa o destino até ele terminar. */
  orphan: boolean
  retries: number
  captured: string
  timer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
  acceptTimer?: ReturnType<typeof setTimeout>
  done(outcome: string | Error): void
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
const FINAL: TaskState[] = ['done', 'failed', 'cancelled']
const CANCELLED = 'pedido cancelado (quem perguntou desistiu ou foi fechado)'

export class Orchestrator extends EventEmitter {
  private statuses = new Map<string, AgentStatus>()
  private queues = new Map<string, Job[]>()
  private active = new Map<string, Job>()
  private paused = new Set<string>()
  private deliveries = new Map<string, number[]>()
  private quietTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private startingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private needsUserAt = new Map<string, number>()
  private records = new Map<string, TaskRecord>()
  private waiters = new Map<string, Array<(r: TaskRecord) => void>>()
  private taskSeq = 0

  private readonly o: Required<Omit<OrchestratorDeps, 'topology' | 'isRunning' | 'write' | 'onData' | 'onGone' | 'onReset' | 'supportsHooks' | 'newNonce'>>
  private readonly newNonce: () => string

  constructor(private readonly deps: OrchestratorDeps) {
    super()
    this.o = {
      idleMs: deps.idleMs ?? 4000,
      enterDelayMs: deps.enterDelayMs ?? 150,
      // Abaixo dos 10 min máximos da ferramenta de shell do Claude.
      askTimeoutMin: deps.askTimeoutMin ?? 9,
      taskTimeoutMin: deps.taskTimeoutMin ?? 120,
      acceptMs: deps.acceptMs ?? 30_000,
      quietMs: deps.quietMs ?? 45_000,
      startingMs: deps.startingMs ?? 60_000,
      loopLimit: deps.loopLimit ?? 30,
      loopWindowMs: deps.loopWindowMs ?? 10 * 60_000
    }
    this.newNonce = deps.newNonce ?? (() => randomBytes(3).toString('hex'))
    deps.onData((id, data) => this.onData(id, data))
    deps.onGone((id) => this.onGone(id))
    deps.onReset((id) => this.onReset(id))
  }

  // ─────────────────────────────── consultas ───────────────────────────────

  status(id: string): AgentStatus {
    return this.statuses.get(id) ?? 'idle'
  }

  isBusy(id: string): boolean {
    return this.status(id) !== 'idle' || this.active.has(id)
  }

  isPaused(id: string): boolean {
    return this.paused.has(id)
  }

  /** Entregas pendentes para o terminal (a em andamento + as da fila). */
  queueSize(id: string): number {
    return (this.queues.get(id)?.length ?? 0) + (this.active.has(id) ? 1 : 0)
  }

  task(terminalId: string, taskId: string): TaskRecord {
    const r = this.records.get(taskId.replace(/^#/, ''))
    if (!r) throw new Error(`A tarefa #${taskId.replace(/^#/, '')} não existe.`)
    if (r.from !== terminalId && r.to !== terminalId) throw new Error(`A tarefa #${r.id} não é sua.`)
    return { ...r }
  }

  tasks(terminalId: string): { sent: TaskRecord[]; received: TaskRecord[] } {
    const all = [...this.records.values()]
    return {
      sent: all.filter((r) => r.from === terminalId).map((r) => ({ ...r })),
      received: all.filter((r) => r.to === terminalId).map((r) => ({ ...r }))
    }
  }

  // ─────────────────────────────── comandos ───────────────────────────────

  /** Terminal com hooks acabou de abrir: nada é entregue até o SessionStart. */
  markStarting(id: string): void {
    if (!this.deps.supportsHooks(id)) return
    this.setStatus(id, 'starting')
    this.clearTimer(this.startingTimers, id)
    this.startingTimers.set(id, setTimeout(() => {
      this.startingTimers.delete(id)
      if (this.status(id) !== 'starting') return
      const msg = 'O agente ainda não confirmou que abriu. Se a tela dele está perguntando algo (ex.: confiar na pasta), responda; se não, reinicie o terminal.'
      this.emit('notice', id, msg)
      this.emit('needs-user', id, msg)
    }, this.o.startingMs))
  }

  resume(id: string): void {
    this.paused.delete(id)
    this.deliveries.delete(id)
    this.emit('paused', id, false)
    this.pump(id)
  }

  ask(from: string, toName: string, message: string, timeoutMin?: number, signal?: AbortSignal): Promise<string> {
    let target: TopoNode
    try {
      target = this.resolveTarget(from, toName)
    } catch (e) {
      return Promise.reject(e)
    }
    if (this.waitsFor(target.id, from)) {
      return Promise.reject(new Error(`${target.name} está esperando uma resposta sua; responda a ele em vez de perguntar de volta.`))
    }
    if (signal?.aborted) return Promise.reject(new Error(CANCELLED))
    const minutes = timeoutMin ?? this.o.askTimeoutMin
    return new Promise<string>((resolve, reject) => {
      const job = this.makeJob('ask', from, target, `Mensagem de ${this.nameOf(from)} via Regente`, message, (o) => (o instanceof Error ? reject(o) : resolve(o)))
      job.timer = setTimeout(() => this.finish(job, new Error(this.timeoutMessage(target, minutes))), minutes * 60_000)
      signal?.addEventListener('abort', () => this.cancelJob(job), { once: true })
      this.enqueue(job)
    })
  }

  send(from: string, toName: string, message: string, timeoutMin?: number): { id: string; position: number; toName: string } {
    const target = this.resolveTarget(from, toName)
    const id = `t${++this.taskSeq}`
    const record: TaskRecord = {
      id, from, fromName: this.nameOf(from), to: target.id, toName: target.name,
      message: sanitize(message), state: 'queued', createdAt: Date.now()
    }
    this.records.set(id, record)
    const minutes = timeoutMin ?? this.o.taskTimeoutMin
    const job = this.makeJob('task', from, target, `Tarefa #${id} de ${record.fromName} via Regente`, message, (o) => this.finishTask(id, o))
    job.taskId = id
    job.timer = setTimeout(() => this.finish(job, new Error(this.timeoutMessage(target, minutes))), minutes * 60_000)
    const position = this.queueSize(target.id)
    this.enqueue(job)
    return { id, position, toName: target.name }
  }

  wait(terminalId: string, taskId: string, timeoutMin = 120, signal?: AbortSignal): Promise<TaskRecord> {
    let r: TaskRecord
    try {
      r = this.task(terminalId, taskId)
    } catch (e) {
      return Promise.reject(e)
    }
    if (FINAL.includes(r.state)) return Promise.resolve(r)
    return new Promise<TaskRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dropWaiter(r.id, onDone)
        reject(new Error(`A tarefa #${r.id} ainda não terminou depois de ${timeoutMin} min.`))
      }, timeoutMin * 60_000)
      const onDone = (rec: TaskRecord) => { clearTimeout(timer); resolve(rec) }
      const list = this.waiters.get(r.id) ?? []
      list.push(onDone)
      this.waiters.set(r.id, list)
      signal?.addEventListener('abort', () => { clearTimeout(timer); this.dropWaiter(r.id, onDone); reject(new Error(CANCELLED)) }, { once: true })
    })
  }

  cancel(terminalId: string, taskId: string): string {
    const r = this.records.get(taskId.replace(/^#/, ''))
    if (!r) throw new Error(`A tarefa #${taskId.replace(/^#/, '')} não existe.`)
    if (r.from !== terminalId) throw new Error(`Só quem enviou a tarefa #${r.id} pode cancelá-la.`)
    if (FINAL.includes(r.state)) return `A tarefa #${r.id} já terminou (${r.state}).`
    const job = this.findTaskJob(r.id)
    const wasAccepted = job?.accepted ?? false
    if (job) this.cancelJob(job)
    return wasAccepted
      ? `Tarefa #${r.id} cancelada; ${r.toName} já estava trabalhando nela, então o resultado será descartado quando ele terminar.`
      : `Tarefa #${r.id} cancelada.`
  }

  // ─────────────────────────────── hooks do Claude ───────────────────────────────

  hook(id: string, event: string, payload: unknown): void {
    const p = (payload ?? {}) as { prompt?: unknown; last_assistant_message?: unknown; message?: unknown }
    switch (event) {
      case 'session': {
        // Só vale para quem está abrindo; SessionStart de compactação/clear no meio do turno é ignorado.
        if (this.status(id) !== 'starting') return
        this.clearTimer(this.startingTimers, id)
        this.setStatus(id, 'idle')
        this.pump(id)
        return
      }
      case 'prompt': {
        const prompt = typeof p.prompt === 'string' ? p.prompt : ''
        const job = this.active.get(id)
        if (job && !job.accepted && prompt.includes(`#${job.nonce}]`)) {
          job.accepted = true
          this.clearJobTimer(job, 'acceptTimer')
          if (job.taskId) this.updateRecord(job.taskId, { state: 'working' })
          this.setStatus(id, 'working')
          // Resultado entregue = missão cumprida; a fila deste terminal só anda depois do Stop dele.
          if (job.kind === 'result') this.finish(job, '', false)
          return
        }
        // Outro prompt no meio do nosso turno: o usuário interrompeu.
        if (job?.accepted && job.kind !== 'result') this.finish(job, new Error(`${job.toName} foi interrompido antes de responder.`), false)
        this.setStatus(id, 'working')
        return
      }
      case 'stop': {
        const message = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : ''
        const job = this.active.get(id)
        this.setStatus(id, 'idle')
        let served = false
        if (job?.accepted && job.kind !== 'result') {
          served = true
          this.finish(job, message, false)
        }
        this.emit('turn-end', id, message, served)
        this.pump(id)
        return
      }
      case 'notification': {
        // Com o agente livre é só um lembrete de inatividade; trabalhando, é pedido de permissão/pergunta.
        if (this.status(id) !== 'working') return
        const message = typeof p.message === 'string' ? p.message : 'O agente precisa de você.'
        this.setStatus(id, 'needs-user')
        this.needsUserAt.set(id, Date.now())
        this.emit('needs-user', id, message)
        return
      }
    }
  }

  // ─────────────────────────────── entrega ───────────────────────────────

  private resolveTarget(from: string, toName: string): TopoNode {
    const { topology } = this.deps
    const peers = topology.peers(from)
    const matches = peers.filter((n) => norm(n.name) === norm(toName))
    if (matches.length > 1) throw new Error(`Há mais de um agente chamado "${toName.trim()}" ligado a você. Renomeie um deles.`)
    const target = matches[0]
    if (!target) {
      const names = peers.map((n) => n.name)
      throw new Error(`"${toName.trim()}" não está ligado a você. Ligados: ${names.length ? names.join(', ') : 'ninguém'}.`)
    }
    if (target.kind === 'browser') throw new Error(`${target.name} é um navegador: use \`regente browser ...\` para controlá-lo.`)
    if (target.kind === 'note') throw new Error(`${target.name} é uma nota: use \`regente note\` para ler ou escrever nela.`)
    if (!this.deps.isRunning(target.id)) throw new Error(`${target.name} não está rodando. Reinicie o terminal dele.`)
    return target
  }

  private nameOf(id: string): string {
    return sanitize(this.deps.topology.node(id)?.node.name ?? 'outro agente')
  }

  private timeoutMessage(target: TopoNode, minutes: number): string {
    return this.status(target.id) === 'starting'
      ? `${target.name} ainda não ficou pronto em ${minutes} min (a tela dele pode estar esperando você).`
      : `sem resposta de ${target.name} em ${minutes} min`
  }

  private makeJob(kind: JobKind, from: string, target: { id: string; name: string }, header: string, body: string, done: Job['done']): Job {
    return {
      kind, from, to: target.id, toName: target.name, header, body: sanitize(body), nonce: '',
      submitted: false, entered: false, accepted: false, orphan: false, retries: 0, captured: '', done
    }
  }

  private enqueue(job: Job, front = false): void {
    const q = this.queues.get(job.to) ?? []
    if (front) q.unshift(job)
    else q.push(job)
    this.queues.set(job.to, q)
    this.emit('queue', job.to, this.queueSize(job.to))
    this.pump(job.to)
  }

  private pump(to: string): void {
    if (this.active.has(to) || this.status(to) !== 'idle' || this.paused.has(to) || !this.deps.isRunning(to)) return
    const q = this.queues.get(to)
    if (!q?.length) return

    // Freio de laços: entregas automáticas demais para o mesmo terminal pausam a fila dele.
    const now = Date.now()
    const recent = (this.deliveries.get(to) ?? []).filter((t) => now - t < this.o.loopWindowMs)
    if (recent.length >= this.o.loopLimit) {
      this.deliveries.set(to, recent)
      this.paused.add(to)
      const msg = `Mensagens automáticas demais (${recent.length} em ${Math.round(this.o.loopWindowMs / 60_000)} min). A fila deste agente foi pausada; clique em Retomar para continuar.`
      this.emit('paused', to, true)
      this.emit('notice', to, msg)
      this.emit('needs-user', to, msg)
      return
    }
    recent.push(now)
    this.deliveries.set(to, recent)

    const job = q.shift()!
    this.active.set(to, job)
    this.emit('queue', to, this.queueSize(to))
    this.emit('flow', job.from, job.to, true)
    const hooks = this.deps.supportsHooks(to)
    job.nonce = this.newNonce()
    job.submitted = true
    if (job.taskId) this.updateRecord(job.taskId, { state: 'delivered' })
    if (hooks) this.deps.write(to, `\x1b[200~[${job.header} #${job.nonce}]\n${job.body}\x1b[201~`)
    else this.deps.write(to, job.body)
    setTimeout(() => {
      if (this.active.get(to) !== job) return
      job.entered = true
      if (!job.accepted) this.deps.write(to, '\r')
      if (!hooks) this.armIdle(job)
      else if (!job.accepted) this.armAccept(job)
    }, this.o.enterDelayMs)
  }

  /** A colagem precisa virar um turno; se o destino continua livre e nada aconteceu, ela se perdeu. */
  private armAccept(job: Job): void {
    this.clearJobTimer(job, 'acceptTimer')
    job.acceptTimer = setTimeout(() => {
      job.acceptTimer = undefined
      if (this.active.get(job.to) !== job || job.accepted) return
      if (this.status(job.to) !== 'idle') return this.armAccept(job) // ocupado: a colagem espera na fila do próprio Claude
      if (job.kind === 'result' && job.retries < 2) {
        // Resultado não se perde: volta para o começo da fila e tenta de novo.
        job.retries++
        this.detachActive(job)
        return this.enqueue(job, true)
      }
      this.finish(job, new Error(`A mensagem não chegou em ${job.toName} (a tela dele pode estar num menu ou pergunta).`))
    }, this.o.acceptMs)
  }

  private armIdle(job: Job): void {
    this.clearJobTimer(job, 'idleTimer')
    job.idleTimer = setTimeout(() => this.finish(job, cleanOutput(job.captured)), this.o.idleMs)
  }

  private onData(id: string, data: string): void {
    const st = this.status(id)
    if (st === 'needs-user' && Date.now() - (this.needsUserAt.get(id) ?? 0) > 3000) this.setStatus(id, 'working')
    else if (st === 'working') this.armQuiet(id)
    const job = this.active.get(id)
    if (job?.entered && !this.deps.supportsHooks(id)) {
      job.captured += data
      this.armIdle(job)
    }
  }

  /** Trabalhando sem nenhuma saída por muito tempo = o agente parou sem avisar (ex.: Esc). */
  private armQuiet(id: string): void {
    if (!this.deps.supportsHooks(id)) return
    this.clearTimer(this.quietTimers, id)
    this.quietTimers.set(id, setTimeout(() => {
      this.quietTimers.delete(id)
      if (this.status(id) !== 'working') return
      this.setStatus(id, 'idle')
      this.emit('notice', id, 'O agente parou sem avisar que terminou (Esc?). Marcado como livre.')
      const job = this.active.get(id)
      if (job?.accepted && job.kind !== 'result') this.finish(job, new Error(`${job.toName} parou sem terminar (foi interrompido?).`), false)
      this.pump(id)
    }, this.o.quietMs))
  }

  private setStatus(id: string, s: AgentStatus): void {
    if (s === 'working') this.armQuiet(id)
    else this.clearTimer(this.quietTimers, id)
    if (this.statuses.get(id) === s) return
    this.statuses.set(id, s)
    this.emit('status', id, s)
  }

  // ─────────────────────────────── término ───────────────────────────────

  private detachActive(job: Job): void {
    if (this.active.get(job.to) !== job) return
    this.active.delete(job.to)
    this.emit('flow', job.from, job.to, false)
  }

  private finish(job: Job, outcome: string | Error, pumpNext = true): void {
    this.clearJobTimer(job, 'timer')
    this.clearJobTimer(job, 'idleTimer')
    this.clearJobTimer(job, 'acceptTimer')
    if (this.active.get(job.to) === job) {
      this.detachActive(job)
    } else {
      const q = this.queues.get(job.to)
      if (q) this.queues.set(job.to, q.filter((j) => j !== job))
    }
    this.emit('queue', job.to, this.queueSize(job.to))
    if (!job.orphan) {
      job.orphan = true // garante uma única conclusão
      job.done(outcome)
    }
    if (pumpNext) this.pump(job.to)
  }

  /** Quem pediu desistiu: some da fila; entregue e não aceito libera na hora; aceito só segura o destino até ele terminar. */
  private cancelJob(job: Job): void {
    if (job.orphan) return
    const isActive = this.active.get(job.to) === job
    if (isActive && job.accepted) {
      job.orphan = true
      if (job.taskId) this.finishTaskRecord(job.taskId, { state: 'cancelled' })
      else job.done(new Error(CANCELLED))
      return
    }
    if (job.taskId) {
      job.orphan = true
      this.finishTaskRecord(job.taskId, { state: 'cancelled' })
      // Remove sem concluir de novo.
      this.clearJobTimer(job, 'timer')
      this.clearJobTimer(job, 'acceptTimer')
      if (isActive) this.detachActive(job)
      else this.queues.set(job.to, (this.queues.get(job.to) ?? []).filter((j) => j !== job))
      this.emit('queue', job.to, this.queueSize(job.to))
      this.pump(job.to)
      return
    }
    this.finish(job, new Error(CANCELLED))
  }

  private findTaskJob(taskId: string): Job | undefined {
    for (const j of this.active.values()) if (j.taskId === taskId) return j
    for (const q of this.queues.values()) for (const j of q) if (j.taskId === taskId) return j
    return undefined
  }

  private updateRecord(taskId: string, patch: Partial<TaskRecord>): void {
    const r = this.records.get(taskId)
    if (r && !FINAL.includes(r.state)) Object.assign(r, patch)
  }

  private finishTaskRecord(taskId: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const r = this.records.get(taskId)
    if (!r || FINAL.includes(r.state)) return undefined
    Object.assign(r, patch, { finishedAt: Date.now() })
    const list = this.waiters.get(taskId) ?? []
    this.waiters.delete(taskId)
    list.forEach((w) => w({ ...r }))
    return r
  }

  private dropWaiter(taskId: string, w: (r: TaskRecord) => void): void {
    this.waiters.set(taskId, (this.waiters.get(taskId) ?? []).filter((x) => x !== w))
  }

  /** Tarefa terminou (ou falhou): guarda e manda o resultado de volta para quem pediu. */
  private finishTask(taskId: string, outcome: string | Error): void {
    const r = this.finishTaskRecord(taskId, outcome instanceof Error ? { state: 'failed', error: outcome.message } : { state: 'done', result: outcome })
    if (!r) return
    // Shells não recebem colagem: o resultado fica guardado (regente result / tasks).
    if (!this.deps.supportsHooks(r.from) || !this.deps.topology.node(r.from)) return
    const header = r.state === 'done'
      ? `Resposta de ${r.toName} · tarefa #${r.id} via Regente`
      : `Tarefa #${r.id} para ${r.toName} falhou via Regente`
    const body = r.state === 'done' ? r.result || '(sem texto)' : r.error ?? 'erro desconhecido'
    const job = this.makeJob('result', r.to, { id: r.from, name: r.fromName }, header, body, () => undefined)
    this.enqueue(job)
  }

  // ─────────────────────────────── ciclo de vida ───────────────────────────────

  /** Processo reiniciado ou encerrado (o nó continua): o turno em andamento se perdeu; resultados esperam ele voltar. */
  private onReset(id: string): void {
    this.clearTimer(this.startingTimers, id)
    this.clearTimer(this.quietTimers, id)
    this.statuses.delete(id)
    this.needsUserAt.delete(id)
    const job = this.active.get(id)
    if (!job) return
    if (job.kind === 'result') {
      this.clearJobTimer(job, 'acceptTimer')
      job.submitted = job.entered = job.accepted = false
      this.detachActive(job)
      const q = this.queues.get(id) ?? []
      q.unshift(job)
      this.queues.set(id, q)
      return
    }
    this.finish(job, new Error(`${job.toName} foi reiniciado ou encerrado antes de responder.`), false)
  }

  /** Terminal removido de vez. */
  private onGone(id: string): void {
    // 1) Pedidos que ele fez: primeiro os da fila (para nada novo ser entregue), depois os em andamento.
    for (const [to, q] of this.queues) {
      const mine = q.filter((j) => j.from === id && j.kind !== 'result')
      if (!mine.length) continue
      this.queues.set(to, q.filter((j) => !mine.includes(j)))
      for (const j of mine) {
        this.clearJobTimer(j, 'timer')
        j.orphan = true
        if (j.taskId) this.finishTaskRecord(j.taskId, { state: 'cancelled' })
        else j.done(new Error(CANCELLED))
      }
      this.emit('queue', to, this.queueSize(to))
    }
    for (const j of [...this.active.values()]) if (j.from === id && j.kind !== 'result') this.cancelJob(j)

    // 2) O que era para ele: falha na hora (resultados para ele são descartados).
    const toMe = [...(this.active.has(id) ? [this.active.get(id)!] : []), ...(this.queues.get(id) ?? [])]
    this.queues.delete(id)
    for (const j of toMe) {
      if (j.kind === 'result') { j.orphan = true; this.detachActive(j); continue }
      this.finish(j, new Error(`${j.toName} foi fechado antes de responder.`), false)
    }

    // 3) Limpeza.
    this.clearTimer(this.startingTimers, id)
    this.clearTimer(this.quietTimers, id)
    this.statuses.delete(id)
    this.needsUserAt.delete(id)
    this.paused.delete(id)
    this.deliveries.delete(id)
  }

  /** Cadeia de perguntas síncronas em que `start` espera (direta ou indiretamente) por `goal`. */
  private waitsFor(start: string, goal: string): boolean {
    const edges: Array<[string, string]> = []
    for (const j of this.active.values()) if (j.kind === 'ask' && !j.orphan) edges.push([j.from, j.to])
    for (const q of this.queues.values()) for (const j of q) if (j.kind === 'ask') edges.push([j.from, j.to])
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

  private clearTimer(map: Map<string, ReturnType<typeof setTimeout>>, id: string): void {
    const t = map.get(id)
    if (t) clearTimeout(t)
    map.delete(id)
  }

  private clearJobTimer(job: Job, key: 'timer' | 'idleTimer' | 'acceptTimer'): void {
    if (job[key]) clearTimeout(job[key])
    job[key] = undefined
  }
}
