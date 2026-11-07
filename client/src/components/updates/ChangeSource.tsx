import { useId, useState } from 'react'
import { errorDetail } from '../../services/api'
import { getSource, type SourceFragment } from '../../services/analysis.service'
import type { ComparedUnit } from '../../services/versions.service'
import { locatorLabel } from '../analysis/labels'

type SourceState = { kind: 'closed' } | { kind: 'loading' } | { kind: 'ready'; fragment: SourceFragment } | { kind: 'error'; message: string }

/** Resolves one side of a change through GET /api/sources/:sourceId and checks it is the compared text. */
export function ChangeSource({ unit }: { unit: ComparedUnit }) {
  const [view, setView] = useState<SourceState>({ kind: 'closed' })
  const panelId = useId()
  const open = view.kind !== 'closed'
  const toggle = async () => {
    if (open) return setView({ kind: 'closed' })
    setView({ kind: 'loading' })
    try {
      setView({ kind: 'ready', fragment: await getSource(unit.sourceId) })
    } catch (error) {
      setView({ kind: 'error', message: errorDetail(error) })
    }
  }
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/60">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}
        className="inline-flex min-h-9 items-center rounded-md px-3 text-xs font-medium text-accent-700 hover:bg-accent-50">
        {open ? 'Ocultar fuente' : 'Ver fuente verificada'}
      </button>
      {open && (
        <div id={panelId} className="border-t border-zinc-200 px-3 py-2" data-source-panel>
          {view.kind === 'loading' && <p role="status" className="text-xs text-zinc-500">Cargando fuente verificada…</p>}
          {view.kind === 'error' && <p role="alert" className="text-xs font-medium text-red-700">Referencia no disponible: {view.message}</p>}
          {view.kind === 'ready' && (view.fragment.text === unit.text && view.fragment.documentId === unit.documentId ? (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500" data-source-verified>Texto verificado · Versión {unit.version} · {locatorLabel(view.fragment.locator)}</p>
              <p className="max-h-60 overflow-y-auto text-sm leading-6 break-words whitespace-pre-line text-zinc-700" data-source-text>{view.fragment.text}</p>
            </div>
          ) : (
            <p role="alert" className="text-xs font-medium text-red-700">El texto de la fuente no coincide con el comparado; la referencia no puede verificarse.</p>
          ))}
        </div>
      )}
    </div>
  )
}
