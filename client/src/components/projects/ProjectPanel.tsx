import { useCallback } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { isUnreachable } from '../../services/api'
import { listProjectDocuments, type Project } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { formatDate } from './format'

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`mt-0.5 text-sm break-words whitespace-pre-line ${value ? 'text-zinc-800' : 'text-zinc-400'}`}>{value || 'No especificado'}</dd>
    </div>
  )
}

/** The selected project: its details, the upload form and its documents. */
export function ProjectPanel({ project, onDocumentUploaded }: { project: Project; onDocumentUploaded: () => void }) {
  const load = useCallback((signal: AbortSignal) => listProjectDocuments(project.id, signal), [project.id])
  const documents = useApiResource(project.id, load)

  return (
    <section aria-labelledby="selected-project-title" className="min-w-0 space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Proyecto seleccionado</p>
        <h2 id="selected-project-title" tabIndex={-1} className="mt-1 text-lg font-semibold break-words text-zinc-900 outline-none">{project.name}</h2>
        <p className="text-xs text-zinc-500">Creado {formatDate(project.createdAt)}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="Producto" value={project.product} />
          <Detail label="Audiencia" value={project.audience} />
          <div className="sm:col-span-2"><Detail label="Objetivo de aprendizaje" value={project.learningObjective} /></div>
          <div className="sm:col-span-2"><Detail label="Contexto" value={project.context} /></div>
        </dl>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">Subir documentación</h3>
        <DocumentUpload project={project} onUploaded={() => { documents.reload(); onDocumentUploaded() }} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">Documentos del proyecto</h3>
        {documents.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando documentos…</p>}
        {documents.status === 'error' && (
          <Alert tone="error" title="No se pudieron cargar los documentos" actions={<Button variant="secondary" onClick={documents.reload}>Reintentar</Button>}>
            {isUnreachable(documents.error) ? 'No se pudo conectar con el servidor.' : documents.error instanceof Error ? documents.error.message : 'Error desconocido.'}
          </Alert>
        )}
        {documents.status === 'ready' && documents.data && documents.data.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-600">
            Este proyecto aún no tiene documentos. Sube un PDF o DOCX para comenzar.
          </p>
        )}
        {documents.data && documents.data.length > 0 && documents.status !== 'loading' && <DocumentList documents={documents.data} />}
      </div>
    </section>
  )
}
