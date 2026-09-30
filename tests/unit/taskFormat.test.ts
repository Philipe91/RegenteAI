import { describe, expect, test } from 'vitest'
import { formatRecord, formatTaskList } from '../../src/main/bridge/taskFormat'
import type { TaskRecord } from '../../src/main/bridge/orchestrator'

const rec = (over: Partial<TaskRecord>): TaskRecord => ({
  id: 't1', from: 'l', fromName: 'Líder', to: 'd', toName: 'Dev1', message: 'implemente o login com testes', state: 'working', createdAt: 0, ...over
})

describe('formatação de tarefas', () => {
  test('lista enviadas e recebidas com estado em português', () => {
    const text = formatTaskList({ sent: [rec({})], received: [rec({ id: 't2', fromName: 'Revisor', state: 'queued' })] })
    expect(text).toContain('Enviadas por você:')
    expect(text).toContain('#t1 → Dev1 · trabalhando · implemente o login com testes')
    expect(text).toContain('Recebidas:')
    expect(text).toContain('#t2 ← Revisor · na fila')
  })
  test('lista vazia', () => {
    expect(formatTaskList({ sent: [], received: [] })).toBe('Nenhuma tarefa enviada ou recebida.')
  })
  test('registro: concluída mostra o resultado; falhou mostra o erro', () => {
    expect(formatRecord(rec({ state: 'done', result: 'Pronto.' }))).toBe('Tarefa #t1 (Líder → Dev1): concluída\nPronto.')
    expect(formatRecord(rec({ state: 'failed', error: 'Dev1 foi fechado' }))).toBe('Tarefa #t1 (Líder → Dev1): falhou\nDev1 foi fechado')
    expect(formatRecord(rec({ state: 'working' }))).toBe('Tarefa #t1 (Líder → Dev1): trabalhando')
  })
})
