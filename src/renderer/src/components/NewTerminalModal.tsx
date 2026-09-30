import { useState } from 'react'
import { PROJECT_COLORS, type AgentId } from '@shared/types'
import { useWorkspace } from '../state/workspace'

interface Props {
  count: number
  onCancel(): void
  onCreate(v: { agent: AgentId; name: string; color: string; command?: string }): void
}

export function NewTerminalModal({ count, onCancel, onCreate }: Props) {
  const agents = useWorkspace((s) => s.agents)
  const [agent, setAgent] = useState<AgentId>(agents.find((a) => a.available)?.id ?? 'shell')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[count % PROJECT_COLORS.length])
  const [command, setCommand] = useState('')
  const label = agents.find((a) => a.id === agent)?.label ?? 'Terminal'
  const canCreate = agent !== 'custom' || command.trim().length > 0

  const submit = () => {
    if (!canCreate) return
    onCreate({ agent, name: name.trim() || `${label} ${count + 1}`, color, command: agent === 'custom' ? command.trim() : undefined })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      >
        <h2>Novo terminal</h2>
        <div className="agents">
          {agents.map((a) => (
            <button
              key={a.id}
              data-testid={`agent-option-${a.id}`}
              className={agent === a.id ? 'on' : ''}
              disabled={!a.available}
              title={a.available ? '' : `${a.label} não está instalado neste PC`}
              onClick={() => setAgent(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {agent === 'custom' && (
          <label>Comando<input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder="ex.: npm run dev" /></label>
        )}
        <label>Nome<input autoFocus={agent !== 'custom'} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${label} ${count + 1}`} /></label>
        <label>Cor
          <div className="colors">
            {PROJECT_COLORS.map((c) => (
              <button key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </label>
        <div className="row">
          <button onClick={onCancel}>Cancelar</button>
          <button className="primary" data-testid="create-terminal" disabled={!canCreate} onClick={submit}>Criar</button>
        </div>
      </div>
    </div>
  )
}
