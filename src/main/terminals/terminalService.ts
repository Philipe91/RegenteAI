import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AgentId, StartTerminalRequest, StartTerminalResult } from '@shared/types'
import type { AgentAdapter, LaunchSpec } from '../agents/types'
import { toSpawnable } from '../agents/spawnable'
import type { PtyManager } from '../pty/ptyManager'
import { buildTerminalEnv } from './terminalEnv'

/** Se um "resume" morre com erro antes disso, consideramos que a sessão não existe mais (rede de segurança). */
const RESUME_FAIL_WINDOW_MS = 15_000
const SESSION_GONE = 'Sessão anterior não encontrada — iniciando uma conversa nova.'

/** exitCode definido = o processo terminou e só volta por restart explícito. */
interface Running { req: StartTerminalRequest; resumed: boolean; exitCode?: number }

export class TerminalService extends EventEmitter {
  private running = new Map<string, Running>()

  constructor(
    private readonly pty: PtyManager,
    private readonly adapters: Record<AgentId, AgentAdapter>,
    private readonly newId: () => string = randomUUID,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env
  ) {
    super()
    pty.on('exit', (id: string, code: number, lived: number) => this.onExit(id, code, lived))
  }

  start(req: StartTerminalRequest): StartTerminalResult {
    const id = req.node.id
    const current = this.running.get(id)
    if (this.pty.isRunning(id)) return { buffer: this.pty.buffer(id), sessionId: current?.req.node.sessionId }
    if (current?.exitCode !== undefined) {
      return { buffer: this.pty.buffer(id), sessionId: current.req.node.sessionId, exitCode: current.exitCode }
    }
    try {
      return this.launch(req)
    } catch (e) {
      return { buffer: '', error: `Não foi possível iniciar o terminal: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  restart(id: string): StartTerminalResult | null {
    const r = this.running.get(id)
    if (!r) return null
    this.pty.kill(id)
    this.running.delete(id)
    return this.start(r.req)
  }

  kill(id: string): void {
    this.running.delete(id)
    this.pty.forget(id)
  }

  private launch(req: StartTerminalRequest): StartTerminalResult {
    const id = req.node.id
    if (!existsSync(req.cwd)) return { buffer: '', error: `Pasta do projeto não existe: ${req.cwd}` }
    const adapter = this.adapters[req.node.agent] as AgentAdapter | undefined
    if (!adapter) return { buffer: '', error: `Tipo de agente desconhecido: ${req.node.agent}. Atualize o Regente.` }
    const exe = adapter.detect()
    if (!exe) return { buffer: '', error: `${adapter.label} não encontrado neste PC. Instale e reinicie o Regente.` }

    let sessionId = req.node.sessionId
    const known = sessionId !== undefined && (adapter.hasSession?.(sessionId) ?? true)
    if (sessionId !== undefined && !known) this.emit('notice', id, SESSION_GONE)
    const resumeSpec = sessionId !== undefined && known ? adapter.resume(exe, sessionId) : null
    let spec: LaunchSpec
    if (resumeSpec) {
      spec = resumeSpec
    } else {
      sessionId = adapter.createsSessionId ? this.newId() : undefined
      spec = adapter.launch(exe, sessionId, req.node.command)
    }
    const next: StartTerminalRequest = { ...req, node: { ...req.node, sessionId } }
    this.spawn(next, spec)
    this.running.set(id, { req: next, resumed: resumeSpec !== null })
    if (sessionId && sessionId !== req.node.sessionId) this.emit('session', id, sessionId)
    return { buffer: this.pty.buffer(id), sessionId }
  }

  private spawn(req: StartTerminalRequest, spec: LaunchSpec): void {
    this.pty.start(req.node.id, toSpawnable(spec), {
      cwd: req.cwd, cols: req.cols, rows: req.rows,
      env: buildTerminalEnv(this.baseEnv, { terminalId: req.node.id, projectId: req.projectId })
    })
  }

  private onExit(id: string, code: number, lived: number): void {
    const r = this.running.get(id)
    if (r?.resumed && code !== 0 && lived < RESUME_FAIL_WINDOW_MS) {
      const adapter = this.adapters[r.req.node.agent]
      const exe = adapter.detect()
      if (exe) {
        const sessionId = adapter.createsSessionId ? this.newId() : undefined
        const next: StartTerminalRequest = { ...r.req, node: { ...r.req.node, sessionId } }
        this.emit('notice', id, SESSION_GONE)
        try {
          this.spawn(next, adapter.launch(exe, sessionId, next.node.command))
          this.running.set(id, { req: next, resumed: false })
          if (sessionId) this.emit('session', id, sessionId)
          return
        } catch {
          /* cai no exit normal abaixo */
        }
      }
    }
    if (r) r.exitCode = code
    this.emit('exit', id, code)
  }
}
