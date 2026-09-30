import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function readJsonSafe(path: string): { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'corrupt' } {
  if (!existsSync(path)) return { ok: false, reason: 'missing' }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}
