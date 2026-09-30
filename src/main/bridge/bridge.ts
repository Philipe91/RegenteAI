import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface BridgeContext { terminalId: string }
export type BridgeHandler = (ctx: BridgeContext, body: any) => unknown | Promise<unknown>

/**
 * Servidor local (só 127.0.0.1) que o CLI `regente` e os hooks usam.
 * Cada terminal tem um token próprio; é ele que diz quem está chamando.
 * Respostas demoradas (ask) mandam o cabeçalho na hora e espaços periódicos,
 * para nenhum timeout de cliente HTTP cortar a espera.
 */
export class Bridge {
  private server: Server | null = null
  private routes = new Map<string, BridgeHandler>()
  private byToken = new Map<string, string>()
  private byTerminal = new Map<string, string>()
  private readonly heartbeatMs: number

  constructor(opts: { heartbeatMs?: number } = {}) {
    this.heartbeatMs = opts.heartbeatMs ?? 20_000
  }

  route(path: string, handler: BridgeHandler): void {
    this.routes.set(path, handler)
  }

  issueToken(terminalId: string): string {
    this.revoke(terminalId)
    const token = randomBytes(24).toString('hex')
    this.byToken.set(token, terminalId)
    this.byTerminal.set(terminalId, token)
    return token
  }

  revoke(terminalId: string): void {
    const old = this.byTerminal.get(terminalId)
    if (old) this.byToken.delete(old)
    this.byTerminal.delete(terminalId)
  }

  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.requestTimeout = 0
      server.headersTimeout = 60_000
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.server = server
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      })
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.closeAllConnections()
      this.server.close(() => resolve())
      this.server = null
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, payload: unknown) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(payload))
    }
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const terminalId = token ? this.byToken.get(token) : undefined
    if (req.method !== 'POST' || !terminalId) return send(401, { ok: false, error: 'não autorizado' })
    const handler = this.routes.get((req.url ?? '').split('?')[0])
    if (!handler) return send(404, { ok: false, error: 'rota desconhecida' })

    let raw = ''
    for await (const chunk of req) raw += chunk
    let body: unknown = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { return send(400, { ok: false, error: 'JSON inválido' }) }

    let status = 200
    let payload: unknown
    const beat = setInterval(() => {
      if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.write(' ')
    }, this.heartbeatMs)
    try {
      payload = { ok: true, result: await handler({ terminalId }, body) }
    } catch (e) {
      status = 400
      payload = { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearInterval(beat)
    }
    // Se o heartbeat já mandou 200, o erro segue no corpo ({ok:false}); o CLI lê o corpo.
    send(res.headersSent ? 200 : status, payload)
  }
}
