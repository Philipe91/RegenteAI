import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../../src/main/store/projectStore'
import { readJsonSafe, writeJsonAtomic } from '../../src/main/store/atomicJson'
import { newProject } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'regente store ')) }) // espaço de propósito
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('atomicJson', () => {
  test('grava e lê de volta, sem deixar .tmp', () => {
    const f = join(dir, 'a.json')
    writeJsonAtomic(f, { ok: 1 })
    expect(readJsonSafe(f)).toEqual({ ok: true, value: { ok: 1 } })
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
  test('arquivo inexistente → missing; lixo → corrupt', () => {
    expect(readJsonSafe(join(dir, 'nada.json'))).toEqual({ ok: false, reason: 'missing' })
    writeFileSync(join(dir, 'ruim.json'), '{"meio":')
    expect(readJsonSafe(join(dir, 'ruim.json'))).toEqual({ ok: false, reason: 'corrupt' })
  })
})

describe('ProjectStore', () => {
  test('save → load → list', () => {
    const s = new ProjectStore(dir)
    const p = newProject('p1', 'C:\\Users\\Pc Fechamento\\Área de Trabalho', '2026-09-30T12:00:00.000Z', 0)
    s.save(p)
    expect(s.load('p1').project).toEqual(p)
    expect(s.list()).toEqual([{ id: 'p1', name: 'Área de Trabalho', cwd: p.cwd, color: p.color, updatedAt: p.updatedAt }])
  })

  test('projeto corrompido: guarda cópia .corrupt e avisa', () => {
    const s = new ProjectStore(dir)
    s.save(newProject('p2', 'C:\\x', '2026-09-30T12:00:00.000Z', 1))
    writeFileSync(join(dir, 'projects', 'p2.json'), '{ quebrado')
    const r = s.load('p2')
    expect(r.project).toBeNull()
    expect(r.warning).toMatch(/corrompido/i)
    const files = readdirSync(join(dir, 'projects'))
    expect(files.some((f) => f.startsWith('p2.corrupt-') && f.endsWith('.json'))).toBe(true)
    expect(existsSync(join(dir, 'projects', 'p2.json'))).toBe(false)
  })

  test('versão futura não é carregada', () => {
    const s = new ProjectStore(dir)
    s.save(newProject('p3', 'C:\\x', '2026-09-30T12:00:00.000Z', 0))
    const f = join(dir, 'projects', 'p3.json')
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), version: 99 }))
    const r = s.load('p3')
    expect(r.project).toBeNull()
    expect(r.warning).toMatch(/versão mais nova/i)
  })

  test('app.json padrão quando não existe', () => {
    const s = new ProjectStore(dir)
    expect(s.loadApp()).toEqual({ version: 1, openProjectIds: [], activeProjectId: null })
    s.saveApp({ version: 1, openProjectIds: ['a'], activeProjectId: 'a' })
    expect(s.loadApp().openProjectIds).toEqual(['a'])
  })

  test('id com caracteres de caminho é rejeitado', () => {
    const s = new ProjectStore(dir)
    expect(() => s.load('..\\fora')).toThrow(/id inválido/)
  })
})

describe('ProjectStore — formato inválido (I-2)', () => {
  const bad = ['{"version":1}', 'null', '[]', '{"version":1,"id":"p9","name":"x","cwd":"C:/x","color":"#fff","nodes":"nao","edges":[],"viewport":{"x":0,"y":0,"zoom":1},"createdAt":"t","updatedAt":"t"}']
  for (const raw of bad) {
    test(`JSON válido mas formato errado vira corrompido: ${raw.slice(0, 20)}`, () => {
      const s = new ProjectStore(dir)
      writeFileSync(join(dir, 'projects', 'p9.json'), raw)
      const r = s.load('p9')
      expect(r.project).toBeNull()
      expect(r.warning).toMatch(/corrompido/i)
      expect(readdirSync(join(dir, 'projects')).some((f) => f.startsWith('p9.corrupt-'))).toBe(true)
    })
  }
  test('app.json com formato errado volta ao padrão; ids inválidos são descartados', () => {
    const s = new ProjectStore(dir)
    writeFileSync(join(dir, 'app.json'), 'null')
    expect(s.loadApp()).toEqual({ version: 1, openProjectIds: [], activeProjectId: null })
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ version: 1, openProjectIds: ['ok-1', '../x', 5], activeProjectId: '../x' }))
    expect(s.loadApp()).toEqual({ version: 1, openProjectIds: ['ok-1'], activeProjectId: null, browser: 'auto', notify: true })
  })
})

describe('ProjectStore — nó Navegador e preferência', () => {
  test('projeto com nó de navegador é válido', () => {
    const s = new ProjectStore(dir)
    const p = { ...newProject('pb', 'C:/x', 't', 0), nodes: [{ id: 'b', kind: 'browser', name: 'Nav', color: '#fff', x: 0, y: 0, width: 420, height: 300 }] }
    s.save(p as never)
    expect(s.load('pb').project?.nodes[0]).toMatchObject({ kind: 'browser' })
  })
  test('preferência de navegador é mantida; valor estranho vira auto', () => {
    const s = new ProjectStore(dir)
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ version: 1, openProjectIds: [], activeProjectId: null, browser: 'edge' }))
    expect(s.loadApp().browser).toBe('edge')
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ version: 1, openProjectIds: [], activeProjectId: null, browser: 'netscape' }))
    expect(s.loadApp().browser).toBe('auto')
  })
})

test('preferência de avisos: padrão ligado, respeita false', () => {
  const d = mkdtempSync(join(tmpdir(), 'rg notify '))
  const s = new ProjectStore(d)
  writeFileSync(join(d, 'app.json'), JSON.stringify({ version: 1, openProjectIds: [], activeProjectId: null }))
  expect(s.loadApp().notify).toBe(true)
  writeFileSync(join(d, 'app.json'), JSON.stringify({ version: 1, openProjectIds: [], activeProjectId: null, notify: false }))
  expect(s.loadApp().notify).toBe(false)
  rmSync(d, { recursive: true, force: true })
})
