import type { useProjectDocuments } from '../../hooks/useProjectDocuments'
import { errorDetail } from '../../services/api'
import type { DocumentRecord, Project } from '../../services/projects.service'
import { SECTIONS } from '../../navigation'
import { Alert } from '../Alert'
import { Button, ButtonLink } from '../Button'
import { ArrowRightIcon } from '../icons'
import { DOCUMENT_STATUS, formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'

/** Project dropdown (real projects only). */
export function ProjectSelect({ id, projects, selectedId, onChange }: { id: string; projects: Project[]; selectedId: string | null; onChange: (id: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-zinc-900">Proyecto</label>
      <select
        id={id}
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block min-h-9 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm"
      >
        {!selectedId && <option value="">Selecciona un proyecto</option>}
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

interface DocumentPickerProps {
  project: Project
  documents: ReturnType<typeof useProjectDocuments>
  selectedId: string | null
  onSelect: (id: string) => void
  listLabel: string
}

/** The project's documents as a selectable list, with loading / error / empty states. */
export function DocumentPicker({ project, documents, selectedId, onSelect, listLabel }: DocumentPickerProps) {
  const docs: DocumentRecord[] = documents.data ?? []
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900">Documentos del proyecto</h2>
      {documents.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando documentos…</p>}
      {documents.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar los documentos" actions={<Button variant="secondary" onClick={documents.reload}>Reintentar</Button>}>{errorDetail(documents.error)}</Alert>
      )}
      {documents.status === 'ready' && docs.length === 0 && (
        <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center">
          <p className="text-sm text-zinc-600">Este proyecto no tiene documentos.</p>
          <ButtonLink to={`${SECTIONS.newProject.path}?proyecto=${project.id}`}>Subir documentos <ArrowRightIcon /></ButtonLink>
        </div>
      )}
      {docs.length > 0 && documents.status !== 'loading' && (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label={listLabel}>
          {docs.map((d) => {
            const selected = d.id === selectedId
            const st = DOCUMENT_STATUS[d.status]
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onSelect(d.id)} aria-pressed={selected}
                  className={`relative flex w-full flex-col items-start gap-1 px-4 py-3 text-left ${selected ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}>
                  {selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-600" aria-hidden="true" />}
                  <span className="line-clamp-2 w-full text-sm font-medium break-words text-zinc-900" data-filename>{d.originalFilename}</span>
                  <span className="text-xs text-zinc-500">{formatLabel(d.extension)} · {formatDate(d.createdAt)}</span>
                  <StatusIndicator tone={st.tone} label={st.label} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
