import { useState } from 'react'
import { useWorkspace } from '../state/workspace'
import type { BrowserPref } from '@shared/types'
import { ProjectsMenu } from './ProjectsMenu'

export function TabBar() {
  const openIds = useWorkspace((s) => s.openIds)
  const projects = useWorkspace((s) => s.projects)
  const activeId = useWorkspace((s) => s.activeId)
  const setActive = useWorkspace((s) => s.setActive)
  const closeProject = useWorkspace((s) => s.closeProject)
  const createProject = useWorkspace((s) => s.createProject)
  const [menu, setMenu] = useState(false)
  const activity = useWorkspace((s) => s.activity)
  const browserPref = useWorkspace((s) => s.browserPref)
  const setBrowserPref = useWorkspace((s) => s.setBrowserPref)
  const tabActivity = (id: string) => {
    const states = projects[id].nodes.map((n) => activity[n.id])
    return states.includes('working') ? 'working' : states.includes('attention') ? 'attention' : null
  }

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
            {tabActivity(id) && <span className={`led ${tabActivity(id)}`} title={tabActivity(id) === 'working' ? 'Agente trabalhando' : 'Agente terminou'} />}
            <button className="close" title="Fechar projeto (salva e encerra os terminais)" onClick={(e) => { e.stopPropagation(); closeProject(id) }}>×</button>
          </div>
        )
      })}
      <button data-testid="new-project" title="Novo projeto" onClick={() => void createProject()}>+</button>
      <div className="spacer" />
      <label className="pref" title="Qual navegador os agentes usam">Navegador
        <select value={browserPref} onChange={(e) => setBrowserPref(e.target.value as BrowserPref)}>
          <option value="auto">Automático (padrão do Windows)</option>
          <option value="chrome">Chrome</option>
          <option value="edge">Edge</option>
          <option value="brave">Brave</option>
        </select>
      </label>
      <button data-testid="projects-menu" onClick={() => setMenu((m) => !m)}>Projetos</button>
      {menu && <ProjectsMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
