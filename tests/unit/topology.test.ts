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

describe('browserPeer', () => {
  test('acha o navegador ligado; sem navegador → erro que explica', () => {
    const t = new Topology()
    t.update('p1', [...nodes, { id: 'b', name: 'Navegador', agent: 'browser', kind: 'browser' as const }], [{ id: 'e', source: 'l', target: 'b' }])
    expect(t.browserPeer('l').id).toBe('b')
    expect(() => t.browserPeer('r')).toThrow(/Nenhum navegador ligado a você/)
  })
})

describe('notas na topologia', () => {
  const withNotes = () => {
    const t = new Topology()
    t.update('p1', [...nodes,
      { id: 'n1', name: 'Tarefas', agent: 'note', kind: 'note' as const, text: 'a' },
      { id: 'n2', name: 'Ideias', agent: 'note', kind: 'note' as const, text: 'b' }
    ], [{ id: 'e1', source: 'l', target: 'n1' }, { id: 'e2', source: 'l', target: 'n2' }, { id: 'e3', source: 'r', target: 'n1' }])
    return t
  }
  test('uma nota ligada: acha sem nome; várias: exige nome e lista', () => {
    const t = withNotes()
    expect(t.notePeer('r').id).toBe('n1')
    expect(() => t.notePeer('l')).toThrow(/Há 2 notas ligadas a você \(Tarefas, Ideias\)/)
    expect(t.notePeer('l', 'ideias').id).toBe('n2')
    expect(() => t.notePeer('s')).toThrow(/Nenhuma nota ligada a você/)
  })
  test('setNoteText atualiza a cópia local', () => {
    const t = withNotes()
    t.setNoteText('n1', 'novo')
    expect(t.notePeer('r').text).toBe('novo')
  })
})
