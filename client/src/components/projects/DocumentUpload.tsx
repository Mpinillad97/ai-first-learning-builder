import { useId, useRef, useState, type FormEvent } from 'react'
import { isUnreachable } from '../../services/api'
import { UPLOAD_RULES, uploadProjectDocument, type DocumentRecord, type Project } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { checkFile } from './format'

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'success'; document: DocumentRecord }
  | { kind: 'error'; filename: string; message: string }


/** Uploads one document at a time to the selected project. Documents are not processed automatically. */
export function DocumentUpload({ project, onUploaded }: { project: Project; onUploaded: (document: DocumentRecord) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [state, setState] = useState<UploadState>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const uploading = state.kind === 'uploading'

  const choose = (selected: File | null) => {
    setFile(selected)
    setFileError(selected ? checkFile(selected) : null)
    if (state.kind !== 'uploading') setState({ kind: 'idle' })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) {
      setFileError('Selecciona un archivo PDF o DOCX.')
      inputRef.current?.focus()
      return
    }
    const problem = checkFile(file)
    if (problem) {
      setFileError(problem)
      inputRef.current?.focus()
      return
    }
    setState({ kind: 'uploading', filename: file.name })
    try {
      const document = await uploadProjectDocument(project.id, file)
      setState({ kind: 'success', document })
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onUploaded(document)
    } catch (error) {
      const message = isUnreachable(error)
        ? 'No se pudo conectar con el servidor. Verifica que la API esté en ejecución.'
        : error instanceof Error ? error.message : 'Error desconocido.'
      setState({ kind: 'error', filename: file.name, message })
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={`Subir documento a ${project.name}`}>
      <div>
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-900">Documento autorizado</label>
        <p id={`${inputId}-hint`} className="mt-0.5 text-xs text-zinc-500">PDF o DOCX, hasta 15 MB. Se sube al proyecto «{project.name}».</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={UPLOAD_RULES.accept}
            disabled={uploading}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={[`${inputId}-hint`, fileError && `${inputId}-error`].filter(Boolean).join(' ')}
            className="block w-full min-w-0 text-sm text-zinc-700 file:mr-3 file:min-h-9 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-50 disabled:opacity-60"
          />
          <Button type="submit" disabled={uploading || Boolean(fileError)} aria-busy={uploading} className="shrink-0">
            {uploading ? 'Subiendo…' : 'Subir documento'}
          </Button>
        </div>
        {fileError && <p id={`${inputId}-error`} className="mt-1 text-xs font-medium text-red-700">{fileError}</p>}
      </div>

      {state.kind === 'uploading' && <Alert tone="info" title={`Subiendo «${state.filename}»…`}>No cierres esta página hasta que termine.</Alert>}
      {state.kind === 'success' && (
        <Alert tone="success" title={`Documento «${state.document.originalFilename}» subido`}>
          Quedó asociado a este proyecto con estado «Cargado, sin procesar». El procesamiento se realizará en el análisis documental.
        </Alert>
      )}
      {state.kind === 'error' && <Alert tone="error" title={`No se pudo subir «${state.filename}»`}>{state.message}</Alert>}
    </form>
  )
}
