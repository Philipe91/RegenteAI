import type { LaunchSpec } from './types'

function quote(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a
}

/** Arquivos .cmd/.bat não rodam direto no ConPTY: passam pelo cmd.exe com a linha já montada. */
export function toSpawnable(spec: LaunchSpec, comspec: string = process.env.ComSpec ?? 'cmd.exe'): LaunchSpec {
  if (!/\.(cmd|bat)$/i.test(spec.file)) return spec
  const args = Array.isArray(spec.args) ? spec.args : [spec.args]
  const line = [spec.file, ...args].map(quote).join(' ')
  return { file: comspec, args: `/d /s /c "${line}"` }
}
