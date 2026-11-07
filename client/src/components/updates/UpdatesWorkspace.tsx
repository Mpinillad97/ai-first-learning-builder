import { useCallback, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParams } from '../../router'
import { errorDetail } from '../../services/api'
import { getExtraction, type Extraction } from '../../services/analysis.service'
import type { DocumentRecord, Project } from '../../services/projects.service'
import { listVersions, type DocumentVersion } from '../../services/versions.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { shortId } from '../analysis/labels'
import { DOCUMENT_STATUS, formatBytes, formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'
import { NewVersionUpload } from './NewVersionUpload'
import { VersionComparison } from './VersionComparison'
import { VersionHistory } from './VersionHistory'

function extractionUnits(e: Extraction): string {
  if (e.format === 'pdf') {
    const pages = e.pages ?? []
    return `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} (${pages.filter((p) => p.text.length > 0).length} con texto)`
  }
  const n = e.paragraphs?.length ?? 0
  return `${n} ${n === 1 ? 'párrafo con texto' : 'párrafos con texto'}`
}

/** Version history, new-version upload and deterministic comparison of one logical document of a project. */
export function UpdatesWorkspace({ project, document: doc }: { project: Project; document: DocumentRecord }) {
  const load = useCallback((signal: AbortSignal) => listVersions(project.id, doc.id, signal), [project.id, doc.id])
  const versions = useApiResource(`${project.id}:${doc.id}`, load)
  const [processingId, setProcessingId] = useState<string | null>(null)

  if (versions.status === 'loading' || versions.status === 'idle') return <p role="status" className="text-sm text-zinc-500">Cargando versiones…</p>
  if (versions.status === 'error' || !versions.data) {
    return (
      <Alert tone="error" title="No se pudo cargar el historial de versiones" actions={<Button variant="secondary" onClick={versions.reload}>Reintentar</Button>}>
        {errorDetail(versions.error)}
      </Alert>
    )
  }
  const list = versions.data.versions
  const current = list[list.length - 1]!

  return (
    <div className="min-w-0 space-y-8">
      <CurrentVersion key={current.documentId} version={current} />
      <VersionHistory versions={list} onChanged={versions.reload} externalProcessingId={processingId} />
      <NewVersionUpload
        project={project}
        document={doc}
        onUploaded={(v) => {
          setProcessingId(v.documentId)
          versions.reload()
        }}
        onSettled={(v, processed) => {
          setProcessingId(null)
          versions.reload()
          // Compare the new version with the latest previously processed one.
          const previous = list.filter((x) => x.status === 'processed' && x.version < v.version).at(-1)
          if (processed && previous) setSearchParams({ desde: String(previous.version), hasta: String(v.version) })
        }}
      />
      <VersionComparison project={project} documentId={doc.id} versions={list} />
    </div>
  )
}

/** The current (latest) version: real metadata and, when processed, its current extraction. */
function CurrentVersion({ version }: { version: DocumentVersion }) {
  const doc = version.document
  const processed = doc.status === 'processed'
  const load = useCallback((signal: AbortSignal) => getExtraction(doc.id, signal), [doc.id])
  const extraction = useApiResource(processed ? doc.id : null, load)
  const status = DOCUMENT_STATUS[doc.status]

  return (
    <section aria-labelledby="current-version-title" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6" data-current-version={version.version}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Versión actual · versión {version.version}</p>
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
            {doc.status === 'failed' ? 'El procesamiento de esta versión falló; no hay texto extraído.'
              : doc.status === 'processing' ? 'Esta versión se está procesando.'
                : 'Esta versión aún no se ha procesado; no hay texto extraído.'}
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
              <dt className="text-xs text-zinc-500">Identificador de extracción</dt>
              <dd className="font-mono text-xs text-zinc-700" data-field="version" title={extraction.data.extractionId ?? undefined}>
                {extraction.data.extractionId ? shortId(extraction.data.extractionId) : 'Formato anterior (sin identificador)'}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  )
}
