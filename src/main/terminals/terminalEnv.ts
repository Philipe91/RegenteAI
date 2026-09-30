const BLOCKED = new Set(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'])

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
