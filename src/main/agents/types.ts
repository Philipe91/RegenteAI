import type { AgentId } from '@shared/types'

/** O que o Regente passa ao agente para ligá-lo ao resto do canvas. */
export interface AgentContext { settingsPath: string; systemPrompt: string }

export interface LaunchSpec { file: string; args: string[] | string }

export interface AgentAdapter {
  id: AgentId
  label: string
  /** true = o Regente escolhe o ID da sessão ao criar o terminal */
  createsSessionId: boolean
  /** caminho do executável, ou null se não estiver instalado */
  detect(): string | null
  launch(exe: string, sessionId: string | undefined, command?: string): LaunchSpec
  /** null = este agente não sabe retomar sessão */
  resume(exe: string, sessionId: string): LaunchSpec | null
  /** false = a sessão com certeza não existe mais (pula o resume). Ausente = não dá pra saber. */
  hasSession?(sessionId: string): boolean
  /** Argumentos extras para hooks e instruções (só agentes que suportam). */
  integrationArgs?(ctx: AgentContext): string[]
}
