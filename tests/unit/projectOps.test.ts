import { describe, expect, test } from 'vitest'
import { newProject } from '@shared/types'
import { addTerminal, DEFAULT_TERMINAL_SIZE, findFreeSpot, projectIdForNode, removeNode, updateGeometries, setSessionId, setViewport, updateGeometry } from '../../src/renderer/src/state/projectOps'

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

describe('updateGeometries (I-1)', () => {
  test('salva a posição de todos os nós arrastados juntos', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'A', color: '#fff', x: 0, y: 0 }, 'a', T1)
    p = addTerminal(p, { agent: 'shell', name: 'B', color: '#fff', x: 0, y: 0 }, 'b', T1)
    p = updateGeometries(p, [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 30, y: 40 }], T1)
    expect(p.nodes.map((n) => [n.x, n.y])).toEqual([[10, 20], [30, 40]])
  })
})

describe('projectIdForNode (I-5a)', () => {
  test('acha o projeto dono do terminal, mesmo fora da aba ativa', () => {
    const a = addTerminal(newProject('pa', 'C:/a', T0, 0), { agent: 'claude', name: 'C', color: '#fff', x: 0, y: 0 }, 'n-a', T1)
    const b = addTerminal(newProject('pb', 'C:/b', T0, 1), { agent: 'claude', name: 'C', color: '#fff', x: 0, y: 0 }, 'n-b', T1)
    expect(projectIdForNode({ pa: a, pb: b }, 'n-b')).toBe('pb')
    expect(projectIdForNode({ pa: a, pb: b }, 'nenhum')).toBeNull()
  })
})
