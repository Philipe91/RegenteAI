import { Component, type ReactNode } from 'react'

interface Props { projectName: string; onClose(): void; children: ReactNode }
interface State { error: Error | null }

/** Um projeto com problema não pode derrubar o app inteiro: mostra o erro e deixa fechar a aba. */
export class ProjectErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty">
        <div>
          <p>O projeto <b>{this.props.projectName}</b> não pôde ser exibido.</p>
          <p><small>{this.state.error.message}</small></p>
          <button className="primary" onClick={this.props.onClose}>Fechar este projeto</button>
        </div>
      </div>
    )
  }
}
