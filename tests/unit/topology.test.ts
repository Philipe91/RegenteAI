import { describe, expect, test } from 'vitest'
import { Topology } from '../../src/main/bridge/topology'

const nodes = [
  { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' as const },
  { id: 'r', name: 'Revisor', agent: 'claude', kind: 'terminal' as const },
  { id: 's', name: 'Solto', agent: 'shell', kind: 'terminal' as const }
]

describe('Topology', () => {
  test('peers vale nos dois sentidos e ignora quem não está ligado', () => {
    const t = new Topology()
    t.update('p1', nodes, [{ id: 'e', source: 'l', target: 'r' }])
    expect(t.peers('l').map((n) => n.id)).toEqual(['r'])
    expect(t.peers('r').map((n) => n.id)).toEqual(['l'])
    expect(t.peers('s')).toEqual([])
  })
  test('findPeer por nome, sem diferenciar maiúsculas nem acentos de espaço', () => {
    const t = new Topology()
    t.update('p1', nodes, [{ id: 'e', source: 'l', target: 'r' }])
    expect(t.findPeer('l', 'revisor')?.id).toBe('r')
    expect(t.findPeer('l', '  Revisor ')?.id).toBe('r')
    expect(t.findPeer('l', 'Solto')).toBeNull()
  })
  test('node devolve o projeto dono; remove limpa', () => {
    const t = new Topology()
    t.update('p1', nodes, [])
    expect(t.node('s')?.projectId).toBe('p1')
    t.remove('p1')
    expect(t.node('s')).toBeNull()
  })
})
