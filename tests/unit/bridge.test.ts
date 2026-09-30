import { afterEach, describe, expect, test } from 'vitest'
import { Bridge } from '../../src/main/bridge/bridge'

let bridge: Bridge | null = null
afterEach(async () => { await bridge?.close(); bridge = null })

async function call(url: string, path: string, token: string | null, body: unknown) {
  const res = await fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  return { status: res.status, json: JSON.parse((await res.text()).trim()) }
}

describe('Bridge', () => {
  test('rota recebe o terminal dono do token', async () => {
    bridge = new Bridge()
    bridge.route('/echo', (ctx, body) => ({ from: ctx.terminalId, body }))
    const url = await bridge.listen()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const tok = bridge.issueToken('t1')
    expect(await call(url, '/echo', tok, { a: 1 })).toEqual({ status: 200, json: { ok: true, result: { from: 't1', body: { a: 1 } } } })
  })
  test('sem token ou token revogado → 401', async () => {
    bridge = new Bridge()
    bridge.route('/echo', () => 'x')
    const url = await bridge.listen()
    expect((await call(url, '/echo', null, {})).status).toBe(401)
    const tok = bridge.issueToken('t1')
    bridge.revoke('t1')
    expect((await call(url, '/echo', tok, {})).status).toBe(401)
  })
  test('erro da rota vira {ok:false, error} com 400; rota inexistente 404', async () => {
    bridge = new Bridge()
    bridge.route('/falha', () => { throw new Error('Revisor não está ligado a você') })
    const url = await bridge.listen()
    const tok = bridge.issueToken('t1')
    expect(await call(url, '/falha', tok, {})).toEqual({ status: 400, json: { ok: false, error: 'Revisor não está ligado a você' } })
    expect((await call(url, '/nada', tok, {})).status).toBe(404)
  })
  test('resposta lenta: cabeçalho sai na hora e o corpo chega depois (long-poll)', async () => {
    bridge = new Bridge({ heartbeatMs: 20 })
    bridge.route('/lento', () => new Promise((r) => setTimeout(() => r('fim'), 120)))
    const url = await bridge.listen()
    const tok = bridge.issueToken('t1')
    expect((await call(url, '/lento', tok, {})).json).toEqual({ ok: true, result: 'fim' })
  })
})
