export interface CliIO {
  env: Record<string, string | undefined>
  out(s: string): void
  err(s: string): void
  readStdin(): Promise<string>
}

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', shell: 'PowerShell', custom: 'Comando', browser: 'Navegador' }
const STATUS_LABEL: Record<string, string> = { idle: 'ocioso', working: 'trabalhando', exited: 'encerrado', stopped: 'fechado', open: 'aberto' }

const HELP = `Regente — conversa entre agentes

  regente peers                          quem está ligado a você
  regente ask <nome> "<mensagem>"        pede algo a um agente ligado e espera a resposta
        [--timeout <min>]                (padrão: 10 minutos)
  regente browser <ação> [...]           controla o navegador ligado a você
        open [url] | goto <url> | back | reload | snapshot | click <n|seletor>
        type <n|seletor> "<texto>" | press <tecla> | screenshot | eval "<js>"
        console | tabs | tab <n> | endpoint
  regente note [read]                    lê a nota ligada a você
  regente note append <texto>            acrescenta uma linha na nota
  regente note write <texto>             substitui o conteúdo da nota
        [--nota NOME]                    quando houver mais de uma nota ligada
`

class Unreachable extends Error {}

async function call(io: CliIO, path: string, body: unknown): Promise<unknown> {
  const url = io.env.REGENTE_URL
  let res: Response
  try {
    res = await fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${io.env.REGENTE_TOKEN}` },
      body: JSON.stringify(body)
    })
  } catch {
    throw new Unreachable('Regente não está rodando (ou foi reiniciado). Reinicie este terminal pelo botão ↻.')
  }
  const text = (await res.text()).trim()
  let json: { ok: boolean; result?: unknown; error?: string }
  try { json = JSON.parse(text) } catch { throw new Error(`resposta inesperada do Regente (HTTP ${res.status})`) }
  if (res.status === 401) throw new Unreachable('Este terminal não está mais autorizado. Reinicie-o pelo botão ↻.')
  if (!json.ok) throw new Error(json.error ?? 'erro desconhecido')
  return json.result
}

function parseTimeout(args: string[]): { rest: string[]; timeoutMin?: number } {
  const i = args.indexOf('--timeout')
  if (i === -1) return { rest: args }
  const n = Number(args[i + 1])
  const rest = [...args.slice(0, i), ...args.slice(i + 2)]
  return { rest, timeoutMin: Number.isFinite(n) && n > 0 ? n : undefined }
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const [cmd, ...args] = argv
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { io.out(HELP); return 0 }

  if (cmd === 'hook') {
    // Hooks nunca podem atrapalhar o agente: qualquer falha é silenciosa.
    try {
      if (!io.env.REGENTE_URL || !io.env.REGENTE_TOKEN) return 0
      const raw = await io.readStdin()
      let payload: unknown = null
      try { payload = raw ? JSON.parse(raw) : null } catch { payload = null }
      await call(io, '/hook', { event: args[0] ?? '', payload })
    } catch { /* ignorado */ }
    return 0
  }

  if (!io.env.REGENTE_URL || !io.env.REGENTE_TOKEN) {
    io.err('Este terminal não foi aberto pelo Regente, então não há colegas para conversar.\n')
    return 2
  }

  try {
    if (cmd === 'peers') {
      const peers = (await call(io, '/peers', {})) as Array<{ name: string; agent: string; kind: string; status: string }>
      if (peers.length === 0) io.out('Ninguém está ligado a você. Ligue terminais com uma corda no canvas.\n')
      for (const p of peers) {
        io.out(`${p.name} (${AGENT_LABEL[p.kind === 'browser' ? 'browser' : p.agent] ?? p.agent}) — ${STATUS_LABEL[p.status] ?? p.status}\n`)
      }
      return 0
    }
    if (cmd === 'ask') {
      const { rest, timeoutMin } = parseTimeout(args)
      const [to, ...words] = rest
      const message = words.join(' ').trim()
      if (!to || !message) { io.err('uso: regente ask <nome> "<mensagem>" [--timeout <min>]\n'); return 2 }
      const reply = await call(io, '/ask', { to, message, ...(timeoutMin ? { timeoutMin } : {}) })
      io.out(`${String(reply)}\n`)
      return 0
    }
    if (cmd === 'note') {
      const i = args.indexOf('--nota')
      const name = i >= 0 ? args[i + 1] : undefined
      const rest = i >= 0 ? [...args.slice(0, i), ...args.slice(i + 2)] : args
      const [action = 'read', ...words] = rest
      const text = words.join(' ').trim()
      if (!['read', 'write', 'append'].includes(action) || (action !== 'read' && !text)) {
        io.err('uso: regente note [read] | regente note write <texto> | regente note append <texto>   [--nota NOME]\n')
        return 2
      }
      const r = (await call(io, '/note', { action, ...(action !== 'read' ? { text } : {}), ...(name ? { name } : {}) })) as { text: string }
      io.out(`${r.text}\n`)
      return 0
    }
    if (cmd === 'browser') {
      const [action, ...rest] = args
      if (!action) { io.err('uso: regente browser <ação> [...]  (veja: regente help)\n'); return 2 }
      const r = (await call(io, '/browser', { action, args: rest })) as { text: string }
      io.out(`${r.text}\n`)
      return 0
    }
    io.err(`comando desconhecido: ${cmd}\n\n${HELP}`)
    return 2
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`)
    return e instanceof Unreachable ? 2 : 1
  }
}
