import { describe, expect, test } from 'vitest'
import { newProject } from '@shared/types'
import { addTerminal, DEFAULT_TERMINAL_SIZE, findFreeSpot, removeNode, setSessionId, setViewport, updateGeometry } from '../../src/renderer/src/state/projectOps'

const T0 = '2026-09-30T12:00:00.000Z'
const T1 = '2026-09-30T12:05:00.000Z'
const base = () => newProject('p1', 'C:\\proj', T0, 0)

describe('projectOps', () => {
  test('addTerminal cria nó com tamanho padrão e atualiza updatedAt', () => {
    const p = addTerminal(base(), { agent: 'claude', name: 'Líder', color: '#F25C1F', x: 10, y: 20 }, 'n1', T1)
    expect(p.nodes).toEqual([{ id: 'n1', kind: 'terminal', agent: 'claude', name: 'Líder', color: '#F25C1F', x: 10, y: 20, ...DEFAULT_TERMINAL_SIZE }])
    expect(p.updatedAt).toBe(T1)
  })
  test('não muta o original', () => {
    const p0 = base()
    addTerminal(p0, { agent: 'shell', name: 'PS', color: '#fff', x: 0, y: 0 }, 'n1', T1)
    expect(p0.nodes).toEqual([])
  })
  test('removeNode tira o nó e as arestas ligadas a ele', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'A', color: '#fff', x: 0, y: 0 }, 'a', T1)
    p = addTerminal(p, { agent: 'shell', name: 'B', color: '#fff', x: 0, y: 0 }, 'b', T1)
    p = { ...p, edges: [{ id: 'e', source: 'a', target: 'b' }] }
    const r = removeNode(p, 'a', T1)
    expect(r.nodes.map((n) => n.id)).toEqual(['b'])
    expect(r.edges).toEqual([])
  })
  test('updateGeometry, setSessionId e setViewport', () => {
    let p = addTerminal(base(), { agent: 'claude', name: 'C', color: '#fff', x: 0, y: 0 }, 'c', T1)
    p = updateGeometry(p, 'c', { x: 50, width: 800 }, T1)
    p = setSessionId(p, 'c', 'sess', T1)
    p = setViewport(p, { x: 1, y: 2, zoom: 0.5 }, T1)
    expect(p.nodes[0]).toMatchObject({ x: 50, y: 0, width: 800, height: 400, sessionId: 'sess' })
    expect(p.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })
  test('updateGeometry ignora tamanhos absurdos', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'S', color: '#fff', x: 0, y: 0 }, 's', T1)
    p = updateGeometry(p, 's', { width: 20, height: Number.NaN }, T1)
    expect(p.nodes[0]).toMatchObject({ width: 640, height: 400 })
  })
})

describe('findFreeSpot', () => {
  test('posição livre fica como está', () => {
    expect(findFreeSpot([], { x: 100, y: 100 })).toEqual({ x: 100, y: 100 })
  })
  test('desloca em cascata enquanto houver nó no mesmo ponto', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'A', color: '#fff', x: 100, y: 100 }, 'a', T1)
    p = addTerminal(p, { agent: 'shell', name: 'B', color: '#fff', x: 132, y: 132 }, 'b', T1)
    expect(findFreeSpot(p.nodes, { x: 100, y: 100 })).toEqual({ x: 164, y: 164 })
  })
  test('considera ocupado quem está a menos de 16px', () => {
    const p = addTerminal(base(), { agent: 'shell', name: 'A', color: '#fff', x: 110, y: 95 }, 'a', T1)
    expect(findFreeSpot(p.nodes, { x: 100, y: 100 })).toEqual({ x: 132, y: 132 })
  })
})
