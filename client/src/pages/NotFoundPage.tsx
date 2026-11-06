import { ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { DEFAULT_PATH } from '../navigation'

export function NotFoundPage() {
  return (
    <div className="space-y-8">
      <header className="border-b border-zinc-200 pb-6">
        <h1 id="page-title" tabIndex={-1} className="text-xl font-semibold tracking-tight text-zinc-900 outline-none sm:text-2xl">Página no encontrada</h1>
        <p className="mt-1 text-sm text-zinc-600">La dirección no corresponde a ninguna sección de la aplicación.</p>
      </header>
      <EmptyState
        title="Esta página no existe"
        description="Usa el menú de navegación o vuelve a la sección inicial."
        actions={<ButtonLink to={DEFAULT_PATH} variant="primary">Ir a Nuevo proyecto</ButtonLink>}
      />
    </div>
  )
}
