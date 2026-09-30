import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StartTerminalRequest } from '@shared/types'
import type { AgentContext } from '../agents/types'
import type { TerminalIntegration } from '../terminals/terminalService'
import type { Bridge } from './bridge'
import { writeShims } from './shims'
import { ROLES, type RoleId } from '@shared/roles'

const toPosix = (p: string) => p.replace(/\\/g, '/')

/** Uma linha só e sem " % < > : o texto passa pela linha de comando (e pelo cmd.exe quando o claude é .cmd). */
export function systemPromptFor(name: string, role?: RoleId): string {
  const safe = (t: string) => t.replace(/[\r\n"%<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = [
    `Você está rodando dentro do Regente, um canvas onde vários agentes de IA trabalham juntos. Seu nome aqui é ${safe(name)}.`,
    role ? `Seu papel: ${ROLES[role].prompt}` : '',
    'Comandos no seu terminal (rode pela sua ferramenta de shell):',
    'regente peers lista quem está ligado a você e se está livre;',
    'regente send NOME TAREFA delega trabalho (implementar, testar, pesquisar) e retorna na hora: você segue livre, pode mandar várias em paralelo para agentes diferentes e encerrar seu turno, e cada resposta chega sozinha como uma nova mensagem [Resposta de NOME · tarefa #N] — não fique consultando;',
    'regente ask NOME PERGUNTA só para perguntas rápidas: espera a resposta ali mesmo (até 9 min; use o maior timeout que sua ferramenta de shell permitir, ex.: 600000 ms);',
    'regente tasks lista suas tarefas, regente result N mostra um resultado e regente cancel N cancela;',
    'regente browser AÇÃO controla o navegador ligado a você (open, goto, snapshot, click, type, press, screenshot, eval, console, tabs);',
    'regente note lê a nota ligada a você e regente note append TEXTO acrescenta nela;',
    'regente help mostra tudo.',
    'Quando chegar [Mensagem de NOME via Regente] ou [Tarefa #N de NOME via Regente], faça o pedido e termine com um resumo objetivo do resultado (o que fez, onde, o que falta): essa resposta final volta sozinha para quem pediu.'
  ]
  return safe(parts.filter(Boolean).join(' '))
}

/** Liga cada terminal ao Regente: token, atalhos do `regente`, hooks do Claude e instruções. */
export class RegenteIntegration implements TerminalIntegration {
  readonly pathDir: string
  private readonly hooksDir: string

  constructor(
    private readonly bridge: Bridge,
    private readonly url: string,
    dataDir: string,
    private readonly electronPath: string,
    private readonly cliPath: string
  ) {
    this.pathDir = join(dataDir, 'bin')
    this.hooksDir = join(dataDir, 'hooks')
    writeShims(this.pathDir)
    mkdirSync(this.hooksDir, { recursive: true })
  }

  env(req: StartTerminalRequest): Record<string, string> {
    return {
      REGENTE_URL: this.url,
      REGENTE_TOKEN: this.bridge.issueToken(req.node.id),
      REGENTE_TERMINAL_ID: req.node.id,
      REGENTE_BIN: toPosix(this.pathDir),
      REGENTE_ELECTRON: this.electronPath,
      REGENTE_CLI: this.cliPath
    }
  }

  agentContext(req: StartTerminalRequest): AgentContext {
    const hook = (event: string) => ({ hooks: [{ type: 'command', command: `"$REGENTE_BIN/regente" hook ${event}` }] })
    const settingsPath = join(this.hooksDir, `${req.node.id}.json`)
    const hooks = { SessionStart: [hook('session')], UserPromptSubmit: [hook('prompt')], Stop: [hook('stop')], Notification: [hook('notification')] }
    writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2), 'utf8')
    return { settingsPath, systemPrompt: systemPromptFor(req.node.name, req.node.role) }
  }

  onKill(terminalId: string): void {
    this.bridge.revoke(terminalId)
  }
}
