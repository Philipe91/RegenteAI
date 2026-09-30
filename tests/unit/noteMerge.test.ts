import { describe, expect, test } from 'vitest'
import { mergeNote } from '@shared/noteMerge'

describe('mergeNote (você e um agente escrevendo na mesma nota)', () => {
  test('só um lado mudou → fica a mudança', () => {
    expect(mergeNote('a', 'a', 'a\nb')).toBe('a\nb')
    expect(mergeNote('a', 'a!', 'a')).toBe('a!')
  })
  test('agente acrescentou enquanto você digitava → as duas coisas ficam', () => {
    expect(mergeNote('- [ ] login', '- [x] login', '- [ ] login\n- [ ] testes')).toBe('- [x] login\n- [ ] testes')
  })
  test('você acrescentou e o agente reescreveu → reescrita + o que você acrescentou', () => {
    expect(mergeNote('a', 'a\nminha linha', 'tudo novo')).toBe('tudo novo\nminha linha')
  })
  test('conflito sem prefixo comum → nada se perde', () => {
    expect(mergeNote('a', 'x', 'y')).toBe('y\n\n--- seu rascunho (conflito) ---\nx')
  })
})
