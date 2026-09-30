import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeShims, prependPath } from '../../src/main/bridge/shims'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('writeShims', () => {
  test('cria regente.cmd e regente (sh) usando as variáveis do terminal', () => {
    dir = mkdtempSync(join(tmpdir(), 'rg bin '))
    writeShims(dir)
    const cmd = readFileSync(join(dir, 'regente.cmd'), 'utf8')
    expect(cmd).toContain('set ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain('"%REGENTE_ELECTRON%" "%REGENTE_CLI%" %*')
    const sh = readFileSync(join(dir, 'regente'), 'utf8')
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true)
    expect(sh).toContain('ELECTRON_RUN_AS_NODE=1 exec "$REGENTE_ELECTRON" "$REGENTE_CLI" "$@"')
    expect(sh).not.toContain('\r')
  })
})

describe('prependPath', () => {
  test('respeita a chave Path do Windows e não duplica', () => {
    const env: Record<string, string> = { Path: 'C:/a;C:/b' }
    prependPath(env, 'C:/rg bin')
    expect(env).toEqual({ Path: 'C:/rg bin;C:/a;C:/b' })
    prependPath(env, 'C:/rg bin')
    expect(env.Path).toBe('C:/rg bin;C:/a;C:/b')
  })
  test('cria PATH se não existir', () => {
    const env: Record<string, string> = {}
    prependPath(env, 'C:/x')
    expect(env.PATH).toBe('C:/x')
  })
})
