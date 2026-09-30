import type { Project } from '@shared/types'

export function createSaver(save: (p: Project) => void, delayMs: number) {
  const pending = new Map<string, Project>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    const items = [...pending.values()]
    pending.clear()
    items.forEach(save)
  }

  return {
    schedule(p: Project) {
      pending.set(p.id, p)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
