import { expect, test } from 'vitest'
import { readDefaultProgId } from '../../src/main/browser/detect'

test('lê o navegador padrão deste Windows de verdade', () => {
  expect(readDefaultProgId()).toMatch(/^[A-Za-z]/)
})
