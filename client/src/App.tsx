import { useBackendHealth, type ConnectionState } from './hooks/useBackendHealth'
import './App.css'

const STATUS_LABEL: Record<ConnectionState, string> = {
  loading: 'Checking…',
  connected: 'Connected',
  disconnected: 'Disconnected',
}

function App() {
  const { state, message, lastChecked, checking, recheck } = useBackendHealth()

  return (
    <main className="app">
      <header className="app-header">
        <h1>AI-First Learning Builder</h1>
        <p className="subtitle">Technical integration check</p>
      </header>

      <section className="status-card" aria-labelledby="backend-status-title">
        <div className="status-card__header">
          <h2 id="backend-status-title">Backend connection</h2>
          <span className={`status-badge status-badge--${state}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {STATUS_LABEL[state]}
          </span>
        </div>

        <dl className="status-details">
          <dt>Endpoint</dt>
          <dd>
            <code>GET /api/health</code>
          </dd>
          <dt>Response</dt>
          <dd data-testid="status-message">{message}</dd>
          <dt>Last checked</dt>
          <dd>{lastChecked ? lastChecked.toLocaleTimeString() : '—'}</dd>
        </dl>

        <button type="button" className="button" onClick={recheck} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </section>
    </main>
  )
}

export default App
