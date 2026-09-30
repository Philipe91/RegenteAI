import { describe, expect, test } from 'vitest'
import { Topology } from '../../src/main/bridge/topology'
import { noteCommand } from '../../src/main/bridge/notes'

function topo(text = '- [ ] login') {
  const t = new Topology()
  t.update('p', [
    { id: 'l', name: 'Líder', agent: 'claude', kind: 'terminal' },
    { id: 'n', name: 'Tarefas', agent: 'note', kind: 'note', text }
  ], [{ id: 'e', source: 'l', target: 'n' }])
  return t
}

describe('noteCommand', () => {
  test('read devolve o texto (ou aviso de vazia)', () => {
    expect(noteCommand(topo(), 'l', { action: 'read' })).toEqual({ text: '- [ ] login' })
    expect(noteCommand(topo(''), 'l', { action: 'read' })).toEqual({ text: '(a nota Tarefas está vazia)' })
  })
  test('append acrescenta uma linha e pede atualização da nota', () => {
    const t = topo()
    const r = noteCommand(t, 'l', { action: 'append', text: '- [ ] testes' })
    expect(r).toEqual({ text: 'Nota Tarefas atualizada.', update: { nodeId: 'n', text: '- [ ] login\n- [ ] testes' } })
    expect(t.notePeer('l').text).toBe('- [ ] login\n- [ ] testes')
  })
  test('write substitui', () => {
    expect(noteCommand(topo(), 'l', { action: 'write', text: 'novo' }).update).toEqual({ nodeId: 'n', text: 'novo' })
  })
  test('ação inválida ou texto faltando → erro', () => {
    expect(() => noteCommand(topo(), 'l', { action: 'apagar' })).toThrow(/uso: regente note/)
    expect(() => noteCommand(topo(), 'l', { action: 'append' })).toThrow(/uso: regente note/)
  })
  test('texto grande demais é recusado (nota fica leve)', () => {
    expect(() => noteCommand(topo(), 'l', { action: 'write', text: 'x'.repeat(200_001) })).toThrow(/grande demais/)
  })
})
