import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StartTerminalRequest } from '@shared/types'
import type { AgentContext } from '../agents/types'
import type { TerminalIntegration } from '../terminals/terminalService'
import type { Bridge } from './bridge'
import { writeShims } from './shims'

const toPosix = (p: string) => p.replace(/\\/g, '/')

export function systemPromptFor(name: string): string {
  return [
    `Você está rodando dentro do Regente, um canvas onde vários agentes de IA trabalham juntos. Seu nome aqui é "${name}".`,
    'Comandos disponíveis no seu terminal (rode pela sua ferramenta de shell):',
    '- `regente peers`: lista os agentes e navegadores ligados a você.',
    '- `regente ask <nome> "<mensagem>"`: pede algo a um agente ligado e ESPERA a resposta, que pode levar minutos. Use o maior timeout que a sua ferramenta de shell permitir (ex.: 600000 ms).',
    '- `regente browser <ação>`: controla o navegador ligado a você (open, goto, snapshot, click, type, press, screenshot, eval, console, tabs). `regente help` mostra tudo.',
    'Quando chegar uma mensagem que começa com "[Mensagem de <nome> via Regente]", responda normalmente: a sua resposta final volta sozinha para quem pediu.'
  ].join('\n')
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
    writeFileSync(settingsPath, JSON.stringify({ hooks: { UserPromptSubmit: [hook('prompt')], Stop: [hook('stop')] } }, null, 2), 'utf8')
    return { settingsPath, systemPrompt: systemPromptFor(req.node.name) }
  }

  onKill(terminalId: string): void {
    this.bridge.revoke(terminalId)
  }
}
