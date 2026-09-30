import type { AgentId } from '@shared/types'

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
}
