import { expect, test } from 'vitest'
import { IPC } from '@shared/ipc'

test('nomes de canais IPC são únicos', () => {
  const values = Object.values(IPC)
  expect(new Set(values).size).toBe(values.length)
})
