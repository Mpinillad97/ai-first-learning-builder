import { useId, useRef, useState, type FormEvent } from 'react'
import { errorDetail } from '../../services/api'
import { processDocument } from '../../services/analysis.service'
import { UPLOAD_RULES, type DocumentRecord, type Project } from '../../services/projects.service'
import { uploadVersion, type DocumentVersion } from '../../services/versions.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { checkFile } from '../projects/format'

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'processing'; version: DocumentVersion }
  | { kind: 'done'; version: DocumentVersion }
  | { kind: 'upload-error'; filename: string; message: string }
  | { kind: 'process-error'; version: DocumentVersion; message: string }

/**
 * Uploads a new version of the logical document and then processes it with the existing E2 workflow
 * (POST /api/documents/:id/process). No AI analysis is started.
 */
export function NewVersionUpload({ project, document: doc, onUploaded, onSettled }: {
  project: Project
  document: DocumentRecord
  /** The version was stored and its processing is starting. */
  onUploaded: (version: DocumentVersion) => void
  /** Processing finished (processed = false when it failed). */
  onSettled: (version: DocumentVersion, processed: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const busy = state.kind === 'uploading' || state.kind === 'processing'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = file ? checkFile(file) : 'Selecciona un archivo PDF o DOCX.'
    if (!file || problem) {
      setFileError(problem)
      inputRef.current?.focus()
      return
    }
    setState({ kind: 'uploading', filename: file.name })
    let version: DocumentVersion
    try {
      version = await uploadVersion(project.id, doc.id, file)
    } catch (error) {
      setState({ kind: 'upload-error', filename: file.name, message: errorDetail(error) })
      return
    }
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    setState({ kind: 'processing', version })
    onUploaded(version)
    try {
      await processDocument(version.documentId)
      setState({ kind: 'done', version })
      onSettled(version, true)
    } catch (error) {
      setState({ kind: 'process-error', version, message: errorDetail(error) })
      onSettled(version, false)
    }
  }

  return (
    <section aria-labelledby="new-version-title" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6" data-new-version>
      <div>
        <h2 id="new-version-title" className="text-base font-semibold text-zinc-900">Subir nueva versión</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Se guarda como una versión nueva de «{doc.originalFilename}» y se procesa automáticamente. Las versiones anteriores y sus extracciones no se modifican.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-2" aria-label="Subir nueva versión del documento">
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-900">Archivo de la nueva versión</label>
        <p id={`${inputId}-hint`} className="text-xs text-zinc-500">PDF o DOCX, hasta 15 MB.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={UPLOAD_RULES.accept}
            disabled={busy}
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null
              setFile(selected)
              setFileError(selected ? checkFile(selected) : null)
              if (!busy) setState({ kind: 'idle' })
            }}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={[`${inputId}-hint`, fileError && `${inputId}-error`].filter(Boolean).join(' ')}
            className="block w-full min-w-0 text-sm text-zinc-700 file:mr-3 file:min-h-9 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-50 disabled:opacity-60"
          />
          <Button type="submit" disabled={busy || Boolean(fileError)} aria-busy={busy} className="shrink-0">
            {state.kind === 'uploading' ? 'Subiendo…' : state.kind === 'processing' ? 'Procesando…' : 'Subir y procesar'}
          </Button>
        </div>
        {fileError && <p id={`${inputId}-error`} className="text-xs font-medium text-red-700">{fileError}</p>}
      </form>

      {state.kind === 'uploading' && <Alert tone="info" title={`Subiendo «${state.filename}»…`}>No cierres esta página hasta que termine.</Alert>}
      {state.kind === 'processing' && <Alert tone="info" title={`Versión ${state.version.version} subida. Extrayendo texto…`}>El texto se extrae con el mismo procesamiento que el resto de documentos.</Alert>}
      {state.kind === 'done' && (
        <Alert tone="success" title={`Versión ${state.version.version} subida y procesada`}>
          «{state.version.originalFilename}» es ahora la versión actual. Las versiones anteriores se conservan sin cambios.
        </Alert>
      )}
      {state.kind === 'upload-error' && <Alert tone="error" title={`No se pudo subir «${state.filename}»`}>{state.message}</Alert>}
      {state.kind === 'process-error' && (
        <Alert tone="error" title={`La versión ${state.version.version} se guardó, pero no se pudo procesar`}>
          {state.message} No hay texto extraído de esta versión, por lo que no puede compararse. Puedes reintentar el procesamiento desde el historial.
        </Alert>
      )}
    </section>
  )
}
