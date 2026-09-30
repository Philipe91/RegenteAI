import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const EXTS = ['.exe', '.cmd', '.bat', '.com']

export function findExecutable(
  name: string,
  envPath: string = process.env.PATH ?? process.env.Path ?? '',
  exists: (p: string) => boolean = existsSync
): string | null {
  const dirs = envPath
    .split(delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
  for (const dir of dirs) {
    for (const ext of EXTS) {
      const candidate = join(dir, name + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}
