import type { TaskRecord, TaskState } from './orchestrator'

const STATE: Record<TaskState, string> = {
  queued: 'na fila',
  delivered: 'entregue',
  working: 'trabalhando',
  done: 'concluída',
  failed: 'falhou',
  cancelled: 'cancelada'
}

const short = (s: string, n = 70) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export function formatTaskList(t: { sent: TaskRecord[]; received: TaskRecord[] }): string {
  if (!t.sent.length && !t.received.length) return 'Nenhuma tarefa enviada ou recebida.'
  const lines: string[] = []
  if (t.sent.length) {
    lines.push('Enviadas por você:')
    for (const r of t.sent) lines.push(`  #${r.id} → ${r.toName} · ${STATE[r.state]} · ${short(r.message)}`)
  }
  if (t.received.length) {
    lines.push('Recebidas:')
    for (const r of t.received) lines.push(`  #${r.id} ← ${r.fromName} · ${STATE[r.state]} · ${short(r.message)}`)
  }
  return lines.join('\n')
}

export function formatRecord(r: TaskRecord): string {
  const head = `Tarefa #${r.id} (${r.fromName} → ${r.toName}): ${STATE[r.state]}`
  if (r.state === 'done') return `${head}\n${r.result || '(sem texto)'}`
  if (r.state === 'failed') return `${head}\n${r.error ?? ''}`
  return head
}
