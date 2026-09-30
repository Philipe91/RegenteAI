import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RingBuffer } from '../../src/main/pty/ringBuffer'
import { PtyManager, type PtyFactory } from '../../src/main/pty/ptyManager'
import { nodePtyFactory } from '../../src/main/pty/nodePty'

interface FakeProc {
  written: string[]
  killed: boolean
  resize: ReturnType<typeof vi.fn>
  emitData(d: string): void
  emitExit(c: number): void
}

function fakeFactory() {
  const procs: FakeProc[] = []
  const factory: PtyFactory = () => {
    let onData: (d: string) => void = () => {}
    let onExit: (e: { exitCode: number }) => void = () => {}
    const rec: FakeProc = {
      written: [], killed: false, resize: vi.fn(),
      emitData: (d) => onData(d),
      emitExit: (c) => onExit({ exitCode: c })
    }
    procs.push(rec)
    return {
      onData: (cb) => { onData = cb },
      onExit: (cb) => { onExit = cb },
      write: (d) => { rec.written.push(d) },
      resize: rec.resize,
      kill: () => { rec.killed = true; onExit({ exitCode: 1 }) }
    }
  }
  return { factory, procs }
}

const opts = { cwd: 'C:\\', cols: 80, rows: 24, env: {} }

describe('RingBuffer', () => {
  test('mantém só o final quando passa do limite', () => {
    const b = new RingBuffer(10)
    b.push('12345'); b.push('67890'); b.push('abc')
    expect(b.toString()).toBe('67890abc')
    b.push('X'.repeat(20))
    expect(b.toString()).toBe('X'.repeat(10))
  })
})

describe('PtyManager', () => {
  test('guarda histórico e emite data', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    const seen: string[] = []
    m.on('data', (_id, d) => seen.push(d))
    m.start('t1', { file: 'x', args: [] }, opts)
    procs[0].emitData('olá ')
    procs[0].emitData('mundo')
    expect(seen).toEqual(['olá ', 'mundo'])
    expect(m.buffer('t1')).toBe('olá mundo')
  })

  test('start repetido não abre segundo processo', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    m.start('t1', { file: 'x', args: [] }, opts)
    m.start('t1', { file: 'x', args: [] }, opts)
    expect(procs).toHaveLength(1)
  })

  test('saída natural emite exit com tempo de vida; histórico continua disponível', () => {
    let now = 1000
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory, () => now)
    const exits: unknown[] = []
    m.on('exit', (...a) => exits.push(a))
    m.start('t1', { file: 'x', args: [] }, opts)
    procs[0].emitData('fim')
    now = 1800
    procs[0].emitExit(2)
    expect(exits).toEqual([['t1', 2, 800]])
    expect(m.isRunning('t1')).toBe(false)
    expect(m.buffer('t1')).toBe('fim')
  })

  test('kill não emite exit', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    const exits: unknown[] = []
    m.on('exit', (...a) => exits.push(a))
    m.start('t1', { file: 'x', args: [] }, opts)
    m.kill('t1')
    expect(procs[0].killed).toBe(true)
    expect(exits).toEqual([])
  })

  test('resize ignora tamanhos inválidos', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    m.start('t1', { file: 'x', args: [] }, opts)
    m.resize('t1', 0, 10)
    m.resize('t1', 100, 30)
    expect(procs[0].resize).toHaveBeenCalledTimes(1)
    expect(procs[0].resize).toHaveBeenCalledWith(100, 30)
  })
})

describe('nodePtyFactory (integração, PowerShell real)', () => {
  test('abre na pasta pedida, mesmo com espaço e acento', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'Área de Trabalho '))
    try {
      const m = new PtyManager(nodePtyFactory)
      const done = new Promise<void>((r) => m.on('exit', () => r()))
      m.start('t1', { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '(Get-Location).Path'] }, { cwd: dir, cols: 250, rows: 24, env: process.env as Record<string, string> })
      await done
      expect(m.buffer('t1').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).toContain(realpathSync.native(dir))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
