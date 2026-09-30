import type { Topology } from './topology'

const MAX_NOTE = 200_000

function appendLine(text: string, line: string): string {
  const base = text.replace(/\n+$/, '')
  return base ? `${base}\n${line}` : line
}

/** Lê ou altera a nota ligada ao terminal. `update` diz ao app o que gravar no projeto. */
export function noteCommand(
  topology: Topology,
  terminalId: string,
  body: { action?: unknown; text?: unknown; name?: unknown }
): { text: string; update?: { nodeId: string; text: string } } {
  const action = body.action
  const text = typeof body.text === 'string' ? body.text : ''
  if ((action !== 'read' && action !== 'write' && action !== 'append') || (action !== 'read' && !text.trim())) {
    throw new Error('uso: regente note [read] | regente note write <texto> | regente note append <texto>   [--nota NOME]')
  }
  const note = topology.notePeer(terminalId, typeof body.name === 'string' ? body.name : undefined)
  const current = note.text ?? ''
  if (action === 'read') return { text: current.trim() ? current : `(a nota ${note.name} está vazia)` }
  const next = action === 'write' ? text : appendLine(current, text)
  if (next.length > MAX_NOTE) throw new Error('Texto grande demais para uma nota (limite de 200 mil caracteres).')
  topology.setNoteText(note.id, next)
  return { text: `Nota ${note.name} atualizada.`, update: { nodeId: note.id, text: next } }
}
