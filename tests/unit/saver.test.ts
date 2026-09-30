import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { newProject } from '@shared/types'
import { createSaver } from '../../src/renderer/src/state/saver'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('agrupa gravações e guarda só a última versão de cada projeto', () => {
  const save = vi.fn()
  const s = createSaver(save, 300)
  const a = newProject('a', 'C:\\a', 't', 0)
  s.schedule(a)
  s.schedule({ ...a, name: 'A2' })
  s.schedule(newProject('b', 'C:\\b', 't', 1))
  expect(save).not.toHaveBeenCalled()
  vi.advanceTimersByTime(300)
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls.map((c) => c[0].name)).toEqual(['A2', 'b'])
})

test('flush grava na hora o que estiver pendente', () => {
  const save = vi.fn()
  const s = createSaver(save, 300)
  s.schedule(newProject('a', 'C:\\a', 't', 0))
  s.flush()
  expect(save).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1000)
  expect(save).toHaveBeenCalledTimes(1)
})
