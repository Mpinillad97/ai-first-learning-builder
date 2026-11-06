import { useId, useState } from 'react'
import { errorDetail } from '../../services/api'
import { getSource, type Evidence, type SourceFragment } from '../../services/analysis.service'
import { locatorLabel } from './labels'

type ViewState = { kind: 'closed' } | { kind: 'loading' } | { kind: 'ready'; fragment: SourceFragment } | { kind: 'error'; message: string }

/**
 * A cited passage: locator and quote, plus an expandable view of the verified source text resolved through
 * GET /api/sources/:sourceId, with the quote highlighted at its stored offsets.
 */
export function SourceReference({ evidence }: { evidence: Evidence }) {
  const [view, setView] = useState<ViewState>({ kind: 'closed' })
  const panelId = useId()
  const open = view.kind !== 'closed'

  const toggle = async () => {
    if (open) {
      setView({ kind: 'closed' })
      return
    }
    setView({ kind: 'loading' })
    try {
      setView({ kind: 'ready', fragment: await getSource(evidence.sourceId) })
    } catch (error) {
      setView({ kind: 'error', message: errorDetail(error) })
    }
  }

  return (
    <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50/60">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-500">{locatorLabel(evidence.locator)}</p>
          <blockquote className="mt-0.5 text-sm break-words text-zinc-800">«{evidence.quote}»</blockquote>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-9 shrink-0 items-center rounded-md px-2 text-xs font-medium text-accent-700 hover:bg-accent-50"
        >
          {open ? 'Ocultar fuente' : 'Ver en la fuente'}
        </button>
      </div>
      {open && (
        <div id={panelId} className="border-t border-zinc-200 px-3 py-2" data-source-panel>
          {view.kind === 'loading' && <p role="status" className="text-xs text-zinc-500">Cargando fuente verificada…</p>}
          {view.kind === 'error' && (
            <p role="alert" className="text-xs font-medium text-red-700">Referencia no disponible: {view.message}</p>
          )}
          {view.kind === 'ready' && <VerifiedSource fragment={view.fragment} evidence={evidence} />}
        </div>
      )}
    </div>
  )
}

function VerifiedSource({ fragment, evidence }: { fragment: SourceFragment; evidence: Evidence }) {
  const { text } = fragment
  const matches = text.slice(evidence.startOffset, evidence.endOffset) === evidence.quote
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-zinc-500">
        Texto verificado · {locatorLabel(fragment.locator)}
        {!fragment.isCurrent && ' · versión anterior del documento'}
      </p>
      {matches ? (
        <p className="max-h-60 overflow-y-auto text-sm leading-6 break-words whitespace-pre-line text-zinc-700" data-source-text>
          {text.slice(0, evidence.startOffset)}
          <mark className="rounded-sm bg-amber-100 px-0.5 text-zinc-900">{text.slice(evidence.startOffset, evidence.endOffset)}</mark>
          {text.slice(evidence.endOffset)}
        </p>
      ) : (
        <p role="alert" className="text-xs font-medium text-red-700">La cita no coincide con el texto de la fuente; la referencia no puede verificarse.</p>
      )}
    </div>
  )
}
