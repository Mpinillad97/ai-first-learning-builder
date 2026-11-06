import { useCallback, type ComponentType } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { errorDetail } from '../../services/api'
import { getExtraction, type Extraction } from '../../services/analysis.service'
import type { DocumentRecord } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { shortId } from '../analysis/labels'
import { CheckCircleIcon, FileSearchIcon, RefreshIcon, SparklesIcon, type IconProps } from '../icons'
import { DOCUMENT_STATUS, formatBytes, formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'

function extractionUnits(e: Extraction): string {
  if (e.format === 'pdf') {
    const pages = e.pages ?? []
    return `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} (${pages.filter((p) => p.text.length > 0).length} con texto)`
  }
  const n = e.paragraphs?.length ?? 0
  return `${n} ${n === 1 ? 'párrafo con texto' : 'párrafos con texto'}`
}

/** Future E5 steps. Descriptions only: no data, comparisons or results are shown. */
const FUTURE_STEPS: { id: string; title: string; description: string; icon: ComponentType<IconProps> }[] = [
  { id: 'new-version', title: 'Nueva versión', description: 'Subir una nueva versión del documento. La versión actual y sus extracciones se conservarán.', icon: RefreshIcon },
  { id: 'comparison', title: 'Comparación de versiones', description: 'Comparar el texto de la versión actual con el de la nueva versión, página por página o párrafo por párrafo.', icon: FileSearchIcon },
  { id: 'changes', title: 'Cambios detectados', description: 'Listar los pasajes añadidos, eliminados o modificados, con referencias exactas a ambas versiones.', icon: FileSearchIcon },
  { id: 'impact', title: 'Evaluación de impacto', description: 'Identificar qué afirmaciones del análisis dependen de los pasajes que cambiaron.', icon: SparklesIcon },
  { id: 'affected-proposals', title: 'Propuestas afectadas', description: 'Mostrar las propuestas de aprendizaje que usan afirmaciones afectadas, incluidas las aprobadas.', icon: SparklesIcon },
  { id: 'suggested-updates', title: 'Actualizaciones sugeridas', description: 'Proponer cambios al contenido de aprendizaje, siempre respaldados por la nueva versión del documento.', icon: SparklesIcon },
  { id: 'change-review', title: 'Revisión humana de cambios', description: 'Aprobar o rechazar cada cambio propuesto. El contenido aprobado nunca se modifica automáticamente.', icon: CheckCircleIcon },
]

/** Current version (real data) and the prepared, not-yet-available update workflow for one document. */
export function UpdatesWorkspace({ document: doc }: { document: DocumentRecord }) {
  const processed = doc.status === 'processed'
  const load = useCallback((signal: AbortSignal) => getExtraction(doc.id, signal), [doc.id])
  const extraction = useApiResource(processed ? doc.id : null, load)
  const status = DOCUMENT_STATUS[doc.status]

  return (
    <div className="min-w-0 space-y-8">
      <section aria-labelledby="current-version-title" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6" data-current-version>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Versión actual</p>
            <h2 id="current-version-title" className="mt-1 text-base font-semibold break-words text-zinc-900">{doc.originalFilename}</h2>
          </div>
          <StatusIndicator tone={status.tone} label={status.label} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-zinc-500">Formato</dt><dd className="text-zinc-800" data-field="format">{formatLabel(doc.extension)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Tamaño</dt><dd className="text-zinc-800" data-field="size">{formatBytes(doc.sizeBytes)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Subido</dt><dd className="text-zinc-800" data-field="uploaded"><time dateTime={doc.createdAt}>{formatDate(doc.createdAt)}</time></dd></div>
          <div><dt className="text-xs text-zinc-500">Última actualización de estado</dt><dd className="text-zinc-800" data-field="updated"><time dateTime={doc.updatedAt}>{formatDate(doc.updatedAt)}</time></dd></div>
        </dl>
        <div className="border-t border-zinc-200 pt-3 text-sm" data-extraction-info>
          {!processed && (
            <p className="text-zinc-600">
              {doc.status === 'failed' ? 'El procesamiento de este documento falló; no hay texto extraído.' : 'Este documento aún no se ha procesado; no hay texto extraído.'}
            </p>
          )}
          {processed && extraction.status === 'loading' && <p role="status" className="text-zinc-500">Cargando texto extraído…</p>}
          {processed && extraction.status === 'error' && (
            <Alert tone="error" title="No se pudo cargar el texto extraído" actions={<Button variant="secondary" onClick={extraction.reload}>Reintentar</Button>}>{errorDetail(extraction.error)}</Alert>
          )}
          {processed && extraction.status === 'ready' && extraction.data && (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-zinc-500">Texto extraído</dt><dd className="text-zinc-800" data-field="units">{extractionUnits(extraction.data)}</dd></div>
              <div><dt className="text-xs text-zinc-500">Extraído</dt><dd className="text-zinc-800" data-field="extracted"><time dateTime={extraction.data.extractedAt}>{formatDate(extraction.data.extractedAt)}</time></dd></div>
              <div>
                <dt className="text-xs text-zinc-500">Identificador de versión</dt>
                <dd className="font-mono text-xs text-zinc-700" data-field="version" title={extraction.data.extractionId ?? undefined}>
                  {extraction.data.extractionId ? shortId(extraction.data.extractionId) : 'Formato anterior (sin identificador)'}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section aria-labelledby="future-title" className="space-y-3">
        <div>
          <h2 id="future-title" className="text-base font-semibold text-zinc-900">Flujo de actualización</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Estas etapas se habilitarán en una próxima versión. Por ahora no se comparan versiones, no se detectan cambios ni se sugieren actualizaciones.
          </p>
        </div>
        <ol className="space-y-2" aria-label="Etapas del flujo de actualización">
          {FUTURE_STEPS.map((step, index) => (
            <li key={step.id} className="flex gap-3 rounded-lg border border-dashed border-zinc-300 bg-white p-4" data-placeholder={step.id} aria-disabled="true">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400" aria-hidden="true"><step.icon /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium text-zinc-700"><span className="text-zinc-400">{index + 1}.</span> {step.title}</h3>
                  <StatusIndicator tone="neutral" label="Disponible próximamente" />
                </div>
                <p className="mt-1 text-sm text-zinc-500">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
