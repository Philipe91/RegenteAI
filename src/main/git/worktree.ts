import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Nome do agente → pedaço seguro para branch e pasta. */
export function slugify(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'agente'
}

/** Raiz do repositório git que contém a pasta, ou null. */
export function gitRoot(dir: string): string | null {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']) || null
  } catch {
    return null
  }
}

/**
 * Garante uma pasta de trabalho isolada (git worktree) com branch própria.
 * Reaproveita a pasta se já existir; reaproveita a branch se ela já existir.
 */
export function ensureWorktree(repoDir: string, path: string, branch: string): { path: string; branch: string } {
  if (!gitRoot(repoDir)) throw new Error(`A pasta do projeto não é um repositório git: ${repoDir}`)
  if (existsSync(path) && gitRoot(path)) return { path, branch }
  mkdirSync(dirname(path), { recursive: true })
  git(repoDir, ['worktree', 'prune'])
  let branchExists = true
  try {
    git(repoDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  } catch {
    branchExists = false
  }
  try {
    git(repoDir, branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, 'HEAD'])
  } catch (e) {
    const detail = e instanceof Error && 'stderr' in e ? String((e as { stderr: unknown }).stderr).trim() : String(e)
    throw new Error(`Não consegui criar a pasta isolada: ${detail}`)
  }
  return { path, branch }
}

function branchExists(repoDir: string, branch: string): boolean {
  try {
    git(repoDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/** Pasta isolada nova para um agente: pasta e branch nunca compartilhadas com outro agente. */
export function createAgentWorktree(baseDir: string, repoDir: string, name: string): { path: string; branch: string } {
  const slug = slugify(name)
  for (let n = 1; n < 100; n++) {
    const s = n === 1 ? slug : `${slug}-${n}`
    const path = join(baseDir, s)
    const branch = `regente/${s}`
    if (!existsSync(path) && !branchExists(repoDir, branch)) return ensureWorktree(repoDir, path, branch)
  }
  throw new Error('Não consegui escolher um nome livre para a pasta isolada.')
}
