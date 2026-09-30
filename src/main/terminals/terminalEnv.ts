/**
 * Variáveis que identificam a sessão de um Claude Code "pai" (quando o Regente é aberto de dentro de um).
 * Se vazarem para os filhos, o Claude filho se acha aninhado e desliga o salvamento da conversa,
 * o que quebra o --resume. Variáveis de configuração (ex.: CLAUDE_CODE_GIT_BASH_PATH) passam normalmente.
 */
const BLOCKED = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL'
])

export function buildTerminalEnv(base: NodeJS.ProcessEnv, ids: { terminalId: string; projectId: string }): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !BLOCKED.has(k.toUpperCase())) env[k] = v
  }
  env.COLORTERM = 'truecolor'
  env.REGENTE_TERMINAL_ID = ids.terminalId
  env.REGENTE_PROJECT_ID = ids.projectId
  return env
}
