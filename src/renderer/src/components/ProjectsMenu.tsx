import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useWorkspace } from '../state/workspace'

export function ProjectsMenu({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<ProjectSummary[]>([])
  const openIds = useWorkspace((s) => s.openIds)
  const openProject = useWorkspace((s) => s.openProject)

  useEffect(() => { void window.regente.projects.list().then(setItems) }, [])
  const closed = items.filter((p) => !openIds.includes(p.id))

  return (
    <div className="menu" onMouseLeave={onClose}>
      {closed.length === 0 && <div className="item"><small>Nenhum outro projeto salvo.</small></div>}
      {closed.map((p) => (
        <div key={p.id} className="item" onClick={() => { void openProject(p.id); onClose() }}>
          <span><span style={{ color: p.color }}>●</span> {p.name}</span>
          <small>{p.cwd}</small>
        </div>
      ))}
    </div>
  )
}
