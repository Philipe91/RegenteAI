import { describe, expect, test } from 'vitest'
import { systemPromptFor } from '../../src/main/bridge/integration'

describe('systemPromptFor', () => {
  test('uma linha só, sem caracteres que o cmd.exe interpreta (claude.cmd)', () => {
    const p = systemPromptFor('Revisor 50%')
    expect(p).not.toMatch(/[\r\n"%<>]/)
    expect(p).toContain('Revisor 50')
    expect(p).toContain('regente ask')
  })
  test('inclui as instruções do papel quando houver', () => {
    expect(systemPromptFor('R', 'reviewer')).toMatch(/Revisor/)
    expect(systemPromptFor('R')).not.toMatch(/Seu papel/)
  })
})

test('texto preservado (acentos e palavras com s intactos)', () => {
  expect(systemPromptFor('Líder')).toContain('Seu nome aqui é Líder.')
  expect(systemPromptFor('X')).toContain('regente send NOME TAREFA delega trabalho')
  expect(systemPromptFor('X')).toContain('regente ask NOME PERGUNTA só para perguntas rápidas')
})
