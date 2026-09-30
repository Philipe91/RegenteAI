import { describe, expect, test } from 'vitest'
import { notificationFor } from '../../src/main/notify/notify'

describe('notificationFor', () => {
  test('agente terminou com a janela sem foco → avisa com nome e começo da resposta', () => {
    const n = notificationFor({ name: 'Revisor', message: 'Achei 2 problemas no login.ts: ' + 'x'.repeat(300), focused: false, enabled: true })
    expect(n?.title).toBe('Revisor terminou')
    expect(n?.body.length).toBeLessThanOrEqual(141)
    expect(n?.body.startsWith('Achei 2 problemas')).toBe(true)
    expect(n?.body.endsWith('…')).toBe(true)
  })
  test('janela em foco ou avisos desligados → não avisa', () => {
    expect(notificationFor({ name: 'R', message: 'ok', focused: true, enabled: true })).toBeNull()
    expect(notificationFor({ name: 'R', message: 'ok', focused: false, enabled: false })).toBeNull()
  })
  test('resposta vazia → corpo genérico; espaços e quebras compactados', () => {
    expect(notificationFor({ name: 'R', message: '', focused: false, enabled: true })?.body).toBe('Pronto para o próximo passo.')
    expect(notificationFor({ name: 'R', message: 'a\n\n  b', focused: false, enabled: true })?.body).toBe('a b')
  })
})

test('precisa de você tem título próprio', () => {
  expect(notificationFor({ name: 'Dev1', message: 'Claude needs your permission', focused: false, enabled: true, kind: 'needs-user' })?.title).toBe('Dev1 precisa de você')
})
