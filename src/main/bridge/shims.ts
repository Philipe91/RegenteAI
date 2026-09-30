import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CMD = [
  '@echo off',
  'setlocal',
  'set ELECTRON_RUN_AS_NODE=1',
  '"%REGENTE_ELECTRON%" "%REGENTE_CLI%" %*',
  ''
].join('\r\n')

// Para o Git Bash (é nele que o Claude roda comandos e hooks no Windows).
const SH = ['#!/bin/sh', 'ELECTRON_RUN_AS_NODE=1 exec "$REGENTE_ELECTRON" "$REGENTE_CLI" "$@"', ''].join('\n')

/** Gera os atalhos do comando `regente`. Os caminhos reais chegam por variáveis de ambiente do terminal. */
export function writeShims(binDir: string): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'regente.cmd'), CMD, 'utf8')
  writeFileSync(join(binDir, 'regente'), SH, { encoding: 'utf8', mode: 0o755 })
}

/** Coloca uma pasta no início do PATH, respeitando a grafia da chave (no Windows costuma ser "Path"). */
export function prependPath(env: Record<string, string>, dir: string): void {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const parts = (env[key] ?? '').split(';').filter((p) => p && p !== dir)
  env[key] = [dir, ...parts].join(';')
}
