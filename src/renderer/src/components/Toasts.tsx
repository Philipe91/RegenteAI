import { useWorkspace } from '../state/workspace'

export function Toasts() {
  const toasts = useWorkspace((s) => s.toasts)
  const dismiss = useWorkspace((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>{t.message}</div>)}
    </div>
  )
}
