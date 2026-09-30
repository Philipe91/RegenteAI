import { useState } from 'react'
import { useWorkspace } from '../state/workspace'
import { ProjectsMenu } from './ProjectsMenu'

export function TabBar() {
  const openIds = useWorkspace((s) => s.openIds)
  const projects = useWorkspace((s) => s.projects)
  const activeId = useWorkspace((s) => s.activeId)
  const setActive = useWorkspace((s) => s.setActive)
  const closeProject = useWorkspace((s) => s.closeProject)
  const createProject = useWorkspace((s) => s.createProject)
  const [menu, setMenu] = useState(false)

  return (
    <div className="tabbar">
      {openIds.map((id) => {
        const p = projects[id]
        return (
          <div
            key={id}
            data-testid="tab"
            className={`tab${id === activeId ? ' active' : ''}`}
            title={p.cwd}
            onClick={() => setActive(id)}
            onAuxClick={(e) => { if (e.button === 1) closeProject(id) }}
          >
            <span className="dot" style={{ background: p.color }} />
            <span className="name">{p.name}</span>
            <button className="close" title="Fechar projeto (salva e encerra os terminais)" onClick={(e) => { e.stopPropagation(); closeProject(id) }}>×</button>
          </div>
        )
      })}
      <button data-testid="new-project" title="Novo projeto" onClick={() => void createProject()}>+</button>
      <div className="spacer" />
      <button data-testid="projects-menu" onClick={() => setMenu((m) => !m)}>Projetos</button>
      {menu && <ProjectsMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
