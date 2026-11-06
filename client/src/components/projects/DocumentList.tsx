import type { DocumentRecord } from '../../services/projects.service'
import { StatusIndicator } from '../StatusIndicator'
import { DOCUMENT_STATUS, formatBytes, formatDate, formatLabel } from './format'

/** The selected project's documents: filename, format, upload date and processing status. */
export function DocumentList({ documents }: { documents: DocumentRecord[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="hidden grid-cols-[minmax(0,1fr)_3.5rem_8.5rem_10rem] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500 md:grid" aria-hidden="true">
        <span>Archivo</span>
        <span>Formato</span>
        <span>Subido</span>
        <span>Estado</span>
      </div>
      <ul className="divide-y divide-zinc-200" aria-label="Documentos del proyecto">
        {documents.map((doc) => {
          const status = DOCUMENT_STATUS[doc.status]
          return (
            <li key={doc.id} className="grid gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_3.5rem_8.5rem_10rem] md:items-center md:gap-4">
              <div className="min-w-0">
                <p data-filename className="line-clamp-2 text-sm font-medium break-words text-zinc-900" title={doc.originalFilename}>{doc.originalFilename}</p>
                <p className="text-xs text-zinc-500">{formatBytes(doc.sizeBytes)}</p>
              </div>
              <p className="text-sm text-zinc-700"><span className="md:hidden text-zinc-500">Formato: </span>{formatLabel(doc.extension)}</p>
              <p className="text-sm text-zinc-700"><span className="md:hidden text-zinc-500">Subido: </span><time dateTime={doc.createdAt}>{formatDate(doc.createdAt)}</time></p>
              <div><StatusIndicator tone={status.tone} label={status.label} /></div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
