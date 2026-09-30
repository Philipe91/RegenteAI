import { afterEach, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureWorktree, gitRoot, slugify } from '../../src/main/git/worktree'

const dirs: string[] = []
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 }) })

function repo(): string {
  const d = tmp('rg repo ')
  const git = (...a: string[]) => execFileSync('git', a, { cwd: d })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(join(d, 'a.txt'), 'oi')
  git('add', '.')
  git('commit', '-qm', 'inicial')
  return d
}

describe('slugify', () => {
  test('nome do agente vira nome de branch/pasta seguro', () => {
    expect(slugify('Dev Front-end 1')).toBe('dev-front-end-1')
    expect(slugify('Revisão Ação')).toBe('revisao-acao')
    expect(slugify('***')).toBe('agente')
  })
})

describe('gitRoot', () => {
  test('acha a raiz do repositório; fora de repositório → null', () => {
    const r = repo()
    expect(gitRoot(r)).not.toBeNull()
    expect(gitRoot(tmp('rg nada '))).toBeNull()
  })
})

describe('ensureWorktree', () => {
  test('cria pasta isolada com branch própria a partir do HEAD', () => {
    const r = repo()
    const base = tmp('rg wt ')
    const wt = ensureWorktree(r, join(base, 'dev1'), 'regente/dev1')
    expect(wt).toEqual({ path: join(base, 'dev1'), branch: 'regente/dev1' })
    expect(readFileSync(join(base, 'dev1', 'a.txt'), 'utf8')).toBe('oi')
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: wt.path, encoding: 'utf8' }).trim()).toBe('regente/dev1')
  })
  test('chamar de novo reaproveita (pasta existente ou branch existente)', () => {
    const r = repo()
    const base = tmp('rg wt ')
    ensureWorktree(r, join(base, 'dev1'), 'regente/dev1')
    expect(ensureWorktree(r, join(base, 'dev1'), 'regente/dev1').path).toBe(join(base, 'dev1'))
    execFileSync('git', ['worktree', 'remove', '--force', join(base, 'dev1')], { cwd: r })
    expect(existsSync(join(base, 'dev1'))).toBe(false)
    expect(ensureWorktree(r, join(base, 'dev1'), 'regente/dev1').branch).toBe('regente/dev1')
  })
  test('fora de repositório → erro claro', () => {
    expect(() => ensureWorktree(tmp('rg nada '), join(tmp('x '), 'w'), 'regente/x')).toThrow(/não é um repositório git/)
  })
})

describe('createAgentWorktree', () => {
  test('nomes repetidos ganham pastas e branches diferentes', async () => {
    const { createAgentWorktree } = await import('../../src/main/git/worktree')
    const r = repo()
    const base = tmp('rg wts ')
    const a = createAgentWorktree(base, r, 'Dev')
    const b = createAgentWorktree(base, r, 'Dev')
    expect(a.branch).toBe('regente/dev')
    expect(b.branch).toBe('regente/dev-2')
    expect(a.path).not.toBe(b.path)
  })
})
