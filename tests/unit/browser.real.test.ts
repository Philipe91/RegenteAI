import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { BrowserManager } from '../../src/main/browser/manager'
import { runBrowserCommand } from '../../src/main/browser/commands'
import { chooseBrowser, detectBrowsers, readDefaultProgId } from '../../src/main/browser/detect'

const PAGE = `<!doctype html><html><head><title>Página de Teste</title></head><body>
<h1>Olá Regente</h1>
<input id="nome" placeholder="Seu nome">
<button onclick="document.getElementById('saida').textContent = 'Oi, ' + document.getElementById('nome').value">Enviar</button>
<p id="saida">ninguém</p>
<script>console.log('pagina-carregou')</script>
</body></html>`

let server: Server
let url = ''
let profiles = ''
let manager: BrowserManager
const states: Array<{ status: string }> = []

beforeAll(async () => {
  server = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE) })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  profiles = mkdtempSync(join(tmpdir(), 'rg perfis '))
  manager = new BrowserManager({
    profilesDir: profiles,
    resolveBrowser: () => chooseBrowser('auto', detectBrowsers(), readDefaultProgId()),
    headless: true
  })
  manager.on('state', (_id, s) => states.push(s))
})

afterAll(async () => {
  await manager.closeAll()
  server.close()
  rmSync(profiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('navegador real (Chrome/Edge headless)', () => {
  test('open → snapshot → type → click → eval → console → screenshot → close', async () => {
    const opened = await runBrowserCommand(manager, 'b1', 'open', [url])
    expect(opened).toMatch(/Página de Teste/)

    const snap = await runBrowserCommand(manager, 'b1', 'snapshot', [])
    expect(snap).toMatch(/Olá Regente/)
    const input = /\[(\d+)\] campo "Seu nome"/.exec(snap)?.[1]
    const button = /\[(\d+)\] botão "Enviar"/.exec(snap)?.[1]
    expect(input && button).toBeTruthy()

    await runBrowserCommand(manager, 'b1', 'type', [input!, 'Philipe'])
    await runBrowserCommand(manager, 'b1', 'click', [button!])
    expect(await runBrowserCommand(manager, 'b1', 'eval', ["document.getElementById('saida').textContent"])).toBe('"Oi, Philipe"')
    expect(await runBrowserCommand(manager, 'b1', 'console', [])).toMatch(/pagina-carregou/)

    const shot = await runBrowserCommand(manager, 'b1', 'screenshot', [])
    expect(existsSync(shot.trim().replace(/^Print salvo em: /, ''))).toBe(true)

    expect(await runBrowserCommand(manager, 'b1', 'endpoint', [])).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await manager.close('b1')
    expect(manager.isOpen('b1')).toBe(false)
    expect(states.at(-1)?.status).toBe('closed')
  }, 90_000)

  test('comando sem navegador aberto explica o que fazer', async () => {
    await expect(runBrowserCommand(manager, 'b2', 'snapshot', [])).rejects.toThrow(/regente browser open/)
  })

  test('ação desconhecida → lista as ações', async () => {
    await expect(runBrowserCommand(manager, 'b2', 'voar', [])).rejects.toThrow(/Ações: open/)
  })
})
