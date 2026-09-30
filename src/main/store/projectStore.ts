import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, PROJECT_VERSION, type AppState, type LoadResult, type Project, type ProjectSummary } from '@shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomicJson'
import { isProject, sanitizeAppState } from './validate'

const ID_RE = /^[A-Za-z0-9-]+$/
const FILE_RE = /^[A-Za-z0-9-]+\.json$/

export const isValidProjectId = (id: string): boolean => ID_RE.test(id)

export class ProjectStore {
  private readonly projectsDir: string

  constructor(private readonly baseDir: string) {
    this.projectsDir = join(baseDir, 'projects')
    mkdirSync(this.projectsDir, { recursive: true })
  }

  private file(id: string): string {
    if (!isValidProjectId(id)) throw new Error(`id inválido: ${id}`)
    return join(this.projectsDir, `${id}.json`)
  }

  list(): ProjectSummary[] {
    return readdirSync(this.projectsDir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => this.load(f.slice(0, -5)).project)
      .filter((p): p is Project => p !== null)
      .map(({ id, name, cwd, color, updatedAt }) => ({ id, name, cwd, color, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  load(id: string): LoadResult {
    const path = this.file(id)
    const r = readJsonSafe(path)
    if (!r.ok && r.reason === 'missing') return { project: null, warning: `Projeto ${id} não encontrado.` }
    const value = r.ok ? r.value : null
    const version = typeof value === 'object' && value !== null ? (value as { version?: unknown }).version : undefined
    if (typeof version === 'number' && version > PROJECT_VERSION) {
      return { project: null, warning: `O projeto ${id} foi salvo por uma versão mais nova do Regente. Atualize o app.` }
    }
    if (!r.ok || !isProject(value)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(path, join(this.projectsDir, `${id}.corrupt-${stamp}.json`))
      return { project: null, warning: `O projeto ${id} estava corrompido. Uma cópia foi guardada como ${id}.corrupt-${stamp}.json.` }
    }
    return { project: value }
  }

  save(p: Project): void {
    writeJsonAtomic(this.file(p.id), p)
  }

  loadApp(): AppState {
    const r = readJsonSafe(join(this.baseDir, 'app.json'))
    return sanitizeAppState(r.ok ? r.value : null, isValidProjectId, APP_VERSION)
  }

  saveApp(s: AppState): void {
    writeJsonAtomic(join(this.baseDir, 'app.json'), s)
  }
}
