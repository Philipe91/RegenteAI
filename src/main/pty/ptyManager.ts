import { EventEmitter } from 'node:events'
import type { LaunchSpec } from '../agents/types'
import { RingBuffer } from './ringBuffer'

export interface PtyProcess {
  onData(cb: (d: string) => void): unknown
  onExit(cb: (e: { exitCode: number }) => void): unknown
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface PtyOptions { cwd: string; cols: number; rows: number; env: Record<string, string> }
export type PtyFactory = (file: string, args: string[] | string, opts: PtyOptions) => PtyProcess

interface Entry { proc: PtyProcess; startedAt: number; killed: boolean }

export class PtyManager extends EventEmitter {
  private procs = new Map<string, Entry>()
  private buffers = new Map<string, RingBuffer>()

  constructor(private readonly factory: PtyFactory, private readonly now: () => number = Date.now) {
    super()
  }

  start(id: string, spec: LaunchSpec, opts: PtyOptions): void {
    if (this.procs.has(id)) return
    const buffer = new RingBuffer()
    this.buffers.set(id, buffer)
    const proc = this.factory(spec.file, spec.args, opts)
    const entry: Entry = { proc, startedAt: this.now(), killed: false }
    this.procs.set(id, entry)
    proc.onData((d) => {
      buffer.push(d)
      this.emit('data', id, d)
    })
    proc.onExit(({ exitCode }) => {
      if (this.procs.get(id) === entry) this.procs.delete(id)
      if (!entry.killed) this.emit('exit', id, exitCode, this.now() - entry.startedAt)
    })
  }

  isRunning(id: string): boolean {
    return this.procs.has(id)
  }

  buffer(id: string): string {
    return this.buffers.get(id)?.toString() ?? ''
  }

  write(id: string, d: string): void {
    this.procs.get(id)?.proc.write(d)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    this.procs.get(id)?.proc.resize(Math.floor(cols), Math.floor(rows))
  }

  kill(id: string): void {
    const e = this.procs.get(id)
    if (!e) return
    e.killed = true
    this.procs.delete(id)
    try { e.proc.kill() } catch { /* processo já morreu */ }
  }

  forget(id: string): void {
    this.kill(id)
    this.buffers.delete(id)
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id)
  }
}
