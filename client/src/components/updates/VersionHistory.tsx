import { useState } from 'react'
import { errorDetail } from '../../services/api'
import { processDocument } from '../../services/analysis.service'
import type { DocumentVersion } from '../../services/versions.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { DOCUMENT_STATUS, formatBytes, formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'

/** Ordered version history (newest first). Unprocessed or failed versions can be processed with the existing E2 workflow. */
export function VersionHistory({ versions, onChanged, externalProcessingId }: {
  versions: DocumentVersion[]
  onChanged: () => void
  /** A version being processed elsewhere on the page (right after its upload). */
  externalProcessingId: string | null
}) {
  const [ownRun, setRunning] = useState<string | null>(null)
  const running = ownRun ?? externalProcessingId
  const [failure, setFailure] = useState<{ version: number; message: string } | null>(null)

  const process = async (v: DocumentVersion) => {
    setRunning(v.documentId)
    setFailure(null)
    try {
      await processDocument(v.documentId)
    } catch (error) {
      setFailure({ version: v.version, message: errorDetail(error) })
    } finally {
      setRunning(null)
      onChanged()
    }
  }

  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <h2 id="history-title" className="text-base font-semibold text-zinc-900">Historial de versiones</h2>
      {failure && <Alert tone="error" title={`No se pudo procesar la versión ${failure.version}`}>{failure.message}</Alert>}
      <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white" aria-label="Versiones del documento">
        {[...versions].reverse().map((v) => {
          const busy = running === v.documentId
          const status = busy ? DOCUMENT_STATUS.processing : DOCUMENT_STATUS[v.status]
          return (
            <li key={v.documentId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-version={v.version} data-status={v.status}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900">
                  Versión {v.version}
                  {v.isCurrent && <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700" data-current>Actual</span>}
                </p>
                <p className="mt-0.5 text-sm break-words text-zinc-700" data-filename>{v.originalFilename}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {formatLabel(v.document.extension)} · {formatBytes(v.document.sizeBytes)} · subida el <time dateTime={v.uploadedAt}>{formatDate(v.uploadedAt)}</time>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <StatusIndicator tone={status.tone} label={status.label} live={busy} />
                {(v.status === 'uploaded' || v.status === 'failed') && (
                  <Button variant="secondary" onClick={() => process(v)} disabled={running !== null} aria-busy={busy}>
                    {busy ? 'Procesando…' : v.status === 'failed' ? 'Reintentar procesamiento' : 'Procesar'}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
