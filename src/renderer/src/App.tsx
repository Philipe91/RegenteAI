import { useEffect } from 'react'
import { useWorkspace } from './state/workspace'
import { TabBar } from './components/TabBar'
import { Canvas } from './components/Canvas'
import { Toasts } from './components/Toasts'

export function App() {
  const ready = useWorkspace((s) => s.ready)
  const init = useWorkspace((s) => s.init)
  const activeId = useWorkspace((s) => s.activeId)
  const projects = useWorkspace((s) => s.projects)
  const createProject = useWorkspace((s) => s.createProject)
  const flushSaves = useWorkspace((s) => s.flushSaves)

  useEffect(() => { void init() }, [init])
  useEffect(() => {
    const onUnload = () => flushSaves()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [flushSaves])

  if (!ready) return null
  const active = activeId ? projects[activeId] : null

  return (
    <div className="app">
      <TabBar />
      {active ? (
        <Canvas key={active.id} project={active} />
      ) : (
        <div className="empty">
          <div>
            <p>Nenhum projeto aberto.</p>
            <button className="primary" onClick={() => void createProject()}>Abrir uma pasta de projeto</button>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  )
}
