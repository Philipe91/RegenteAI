import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { BrowserInfo } from './detect'

import type { BrowserUiState } from '@shared/types'

export type BrowserState = BrowserUiState

interface Session {
  info: BrowserInfo
  proc: ChildProcess
  port: number
  browser: Browser
  current: Page | null
  console: string[]
  lastPreview: number
  previewTimer?: ReturnType<typeof setTimeout>
}

export interface BrowserManagerOptions {
  profilesDir: string
  resolveBrowser(): { browser: BrowserInfo | null; note?: string }
  headless?: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Abre o navegador real do usuário (Chrome/Edge/Brave) com depuração remota, num perfil
 * separado por nó, e o controla via CDP. O usuário pode usar a mesma janela ao mesmo tempo.
 */
export class BrowserManager extends EventEmitter {
  private sessions = new Map<string, Session>()
  private opening = new Map<string, Promise<Session>>()

  constructor(private readonly opts: BrowserManagerOptions) {
    super()
  }

  isOpen(nodeId: string): boolean {
    return this.sessions.has(nodeId)
  }

  endpoint(nodeId: string): string | null {
    const s = this.sessions.get(nodeId)
    return s ? `http://127.0.0.1:${s.port}` : null
  }

  consoleLines(nodeId: string): string[] {
    return this.sessions.get(nodeId)?.console ?? []
  }

  async open(nodeId: string): Promise<Session> {
    const existing = this.sessions.get(nodeId)
    if (existing) return existing
    const pending = this.opening.get(nodeId)
    if (pending) return pending
    const p = this.launch(nodeId).finally(() => this.opening.delete(nodeId))
    this.opening.set(nodeId, p)
    return p
  }

  /** Aba ativa; se não houver nenhuma, abre uma. */
  async page(nodeId: string): Promise<Page> {
    const s = this.sessions.get(nodeId)
    if (!s) throw new Error('O navegador está fechado. Use `regente browser open [url]` primeiro.')
    if (s.current && !s.current.isClosed()) return s.current
    const ctx = s.browser.contexts()[0]
    const open = ctx.pages().filter((p) => !p.isClosed())
    s.current = open.at(-1) ?? (await ctx.newPage())
    return s.current
  }

  pages(nodeId: string): Page[] {
    const s = this.sessions.get(nodeId)
    return s ? s.browser.contexts()[0].pages().filter((p) => !p.isClosed()) : []
  }

  async selectPage(nodeId: string, index: number): Promise<Page> {
    const s = this.sessions.get(nodeId)
    const list = this.pages(nodeId)
    const page = list[index]
    if (!s || !page) throw new Error(`Não existe a aba ${index}. Use \`regente browser tabs\`.`)
    s.current = page
    await page.bringToFront()
    void this.report(nodeId)
    return page
  }

  async close(nodeId: string): Promise<void> {
    const s = this.sessions.get(nodeId)
    if (!s) return
    this.sessions.delete(nodeId)
    if (s.previewTimer) clearTimeout(s.previewTimer)
    try { await s.browser.close() } catch { /* conexão já caiu */ }
    // Espera o processo sair de verdade (libera o perfil para reabrir/apagar).
    if (s.proc.exitCode === null) {
      const exited = new Promise<void>((r) => s.proc.once('exit', () => r()))
      s.proc.kill()
      await Promise.race([exited, wait(5000)])
    }
    this.emit('state', nodeId, { status: 'closed', browser: s.info.label } satisfies BrowserState)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }

  /** Avisa a interface do título/endereço atual. */
  async report(nodeId: string): Promise<void> {
    const s = this.sessions.get(nodeId)
    if (!s) return
    const page = s.current && !s.current.isClosed() ? s.current : null
    let title = ''
    try { title = page ? await page.title() : '' } catch { /* navegando */ }
    const state: BrowserState = { status: 'open', browser: s.info.label, title, url: page?.url() ?? '' }
    // Prévia da tela para o nó do canvas (no máximo a cada 1,5 s, para não pesar).
    const since = Date.now() - s.lastPreview
    if (page && since <= 1500 && !s.previewTimer) {
      // Dentro da janela: agenda uma captura para o fim dela em vez de perder a imagem mais nova.
      s.previewTimer = setTimeout(() => { s.previewTimer = undefined; void this.report(nodeId) }, 1500 - since + 50)
    }
    if (page && since > 1500) {
      s.lastPreview = Date.now()
      try {
        const jpg = await page.screenshot({ type: 'jpeg', quality: 45, timeout: 3000 })
        state.preview = `data:image/jpeg;base64,${jpg.toString('base64')}`
      } catch { /* página em transição */ }
    }
    this.emit('state', nodeId, state)
  }

  private async launch(nodeId: string): Promise<Session> {
    const { browser: info, note } = this.opts.resolveBrowser()
    if (!info) throw new Error(note ?? 'Nenhum navegador compatível encontrado.')
    this.emit('state', nodeId, { status: 'opening', browser: info.label, note } satisfies BrowserState)

    const profile = join(this.opts.profilesDir, nodeId)
    mkdirSync(profile, { recursive: true })
    const portFile = join(profile, 'DevToolsActivePort')
    rmSync(portFile, { force: true })
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(this.opts.headless ? ['--headless=new'] : []),
      'about:blank'
    ]
    const proc = spawn(info.path, args, { stdio: 'ignore', windowsHide: false })

    let port = 0
    for (let i = 0; i < 150 && !port; i++) {
      if (proc.exitCode !== null) break
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]) || 0
      if (!port) await wait(100)
    }
    if (!port) {
      if (proc.exitCode === null) proc.kill()
      this.emit('state', nodeId, { status: 'closed', browser: info.label } satisfies BrowserState)
      throw new Error(`Não consegui abrir o ${info.label} com controle remoto. Se ele pedir algo na tela, responda e tente de novo.`)
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const session: Session = { info, proc, port, browser, current: null, console: [], lastPreview: 0 }
    this.sessions.set(nodeId, session)

    const watch = (page: Page) => {
      page.on('console', (m) => {
        session.console.push(`[${m.type()}] ${m.text()}`)
        if (session.console.length > 200) session.console.shift()
      })
      page.on('load', () => { if (session.current === page) void this.report(nodeId) })
    }
    const ctx = browser.contexts()[0]
    ctx.pages().forEach(watch)
    ctx.on('page', (page) => { watch(page); session.current = page; void this.report(nodeId) })

    // Fechou a janela na mão (ou o navegador caiu): o nó volta para "fechado".
    proc.on('exit', () => {
      if (this.sessions.get(nodeId) !== session) return
      this.sessions.delete(nodeId)
      this.emit('state', nodeId, { status: 'closed', browser: info.label } satisfies BrowserState)
    })

    await this.page(nodeId)
    await this.report(nodeId)
    return session
  }
}
