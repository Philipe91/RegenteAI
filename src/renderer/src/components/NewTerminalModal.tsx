import { useEffect, useState } from 'react'
import { PROJECT_COLORS, type AgentId } from '@shared/types'
import { ROLE_IDS, ROLES, type RoleId } from '@shared/roles'
import { useWorkspace } from '../state/workspace'

interface Props {
  projectId: string
  cwd: string
  count: number
  onCancel(): void
  onCreate(v: { agent: AgentId; name: string; color: string; command?: string; role?: RoleId; worktree?: { path: string; branch: string } }): void
}

export function NewTerminalModal({ projectId, cwd, count, onCancel, onCreate }: Props) {
  const agents = useWorkspace((s) => s.agents)
  const [agent, setAgent] = useState<AgentId>(agents.find((a) => a.available)?.id ?? 'shell')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[count % PROJECT_COLORS.length])
  const [command, setCommand] = useState('')
  const [role, setRole] = useState<RoleId | undefined>(undefined)
  const canHaveRole = agent === 'claude'
  const [isRepo, setIsRepo] = useState(false)
  const [isolated, setIsolated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.regente.git.isRepo(cwd).then(setIsRepo) }, [cwd])
  const label = agents.find((a) => a.id === agent)?.label ?? 'Terminal'
  const canCreate = agent !== 'custom' || command.trim().length > 0

  const submit = async () => {
    if (!canCreate || busy) return
    const chosenRole = canHaveRole ? role : undefined
    const fallback = chosenRole ? ROLES[chosenRole].label : `${label} ${count + 1}`
    const finalName = name.trim() || fallback
    let worktree: { path: string; branch: string } | undefined
    if (isRepo && isolated) {
      setBusy(true)
      const r = await window.regente.git.worktree(projectId, cwd, finalName)
      setBusy(false)
      if (!r.ok) { setError(r.error); return }
      worktree = { path: r.path, branch: r.branch }
    }
    onCreate({ agent, name: finalName, color, command: agent === 'custom' ? command.trim() : undefined, role: chosenRole, worktree })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onCancel() }}
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
        {canHaveRole && (
          <label>Papel
            <div className="roles">
              <button className={role ? '' : 'on'} onClick={() => setRole(undefined)}>Nenhum</button>
              {ROLE_IDS.map((id) => (
                <button key={id} data-testid={`role-${id}`} className={role === id ? 'on' : ''} style={{ borderLeft: `3px solid ${ROLES[id].color}` }}
                  title={ROLES[id].prompt} onClick={() => { setRole(id); setColor(ROLES[id].color) }}>{ROLES[id].label}</button>
              ))}
            </div>
          </label>
        )}
        <label>Nome<input autoFocus={agent !== 'custom'} value={name} onChange={(e) => setName(e.target.value)} placeholder={canHaveRole && role ? ROLES[role].label : `${label} ${count + 1}`} /></label>
        <label>Cor
          <div className="colors">
            {PROJECT_COLORS.map((c) => (
              <button key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </label>
        {isRepo && (
          <label className="check" title="Cria uma cópia de trabalho do repositório (git worktree) com branch própria: vários agentes editam o mesmo projeto sem pisar um no outro.">
            <input type="checkbox" data-testid="isolated" checked={isolated} onChange={(e) => setIsolated(e.target.checked)} />
            Pasta isolada (git worktree, branch própria)
          </label>
        )}
        {error && <div className="modal-error">{error}</div>}
        <div className="row">
          <button onClick={onCancel}>Cancelar</button>
          <button className="primary" data-testid="create-terminal" disabled={!canCreate || busy} onClick={() => void submit()}>{busy ? 'Criando pasta…' : 'Criar'}</button>
        </div>
      </div>
    </div>
  )
}
