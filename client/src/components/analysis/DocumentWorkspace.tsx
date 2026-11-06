import { useCallback, useEffect, useRef, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParam } from '../../router'
import { ApiError, errorDetail, isUnreachable } from '../../services/api'
import {
  getAnalysis,
  getExtraction,
  listDocumentAnalyses,
  processDocument,
  startAnalysis,
  type AnalysisSummary,
  type Extraction,
} from '../../services/analysis.service'
import type { DocumentRecord } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { DOCUMENT_STATUS, formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'
import { AnalysisResult } from './AnalysisResult'
import { plural } from './labels'

type Feedback = { tone: 'success' | 'error'; title: string; detail?: string } | null

function analysisErrorTitle(error: unknown): string {
  if (isUnreachable(error)) return 'No se pudo conectar con el servidor'
  if (!(error instanceof ApiError)) return 'El análisis no pudo completarse'
  if (error.status === 503) return 'El análisis con IA no está configurado en el servidor'
  if (error.status === 504) return 'El proveedor de IA no respondió a tiempo'
  if (error.status === 502) return 'El proveedor de IA falló o devolvió una respuesta inválida'
  if (error.status === 409) return 'El documento no está listo para el análisis'
  if (error.status === 422) return 'El documento no puede analizarse'
  return 'El análisis no pudo completarse'
}

function extractionUnits(extraction: Extraction): string {
  if (extraction.format === 'pdf') {
    const pages = extraction.pages ?? []
    const withText = pages.filter((p) => p.text.length > 0).length
    return `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} (${withText} con texto)`
  }
  const count = extraction.paragraphs?.length ?? 0
  return `${count} ${count === 1 ? 'párrafo con texto' : 'párrafos con texto'}`
}

interface DocumentWorkspaceProps {
  document: DocumentRecord
  selectedAnalysisId: string | null
  /** Ask the parent to reload document metadata (status) from the backend. */
  onDocumentChanged: () => void
}

/** Processing, AI analysis and persisted results for one selected document. */
export function DocumentWorkspace({ document: doc, selectedAnalysisId, onDocumentChanged }: DocumentWorkspaceProps) {
  const [processing, setProcessing] = useState(false)
  const [processFeedback, setProcessFeedback] = useState<Feedback>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisFeedback, setAnalysisFeedback] = useState<Feedback>(null)
  const busy = useRef(false) // blocks double submission before React re-renders the disabled button

  const processed = doc.status === 'processed'
  const loadExtraction = useCallback((signal: AbortSignal) => getExtraction(doc.id, signal), [doc.id])
  const extraction = useApiResource(processed ? `${doc.id}:${doc.updatedAt}` : null, loadExtraction)
  const loadHistory = useCallback((signal: AbortSignal) => listDocumentAnalyses(doc.id, signal), [doc.id])
  const history = useApiResource(doc.id, loadHistory)

  const historyList = history.data ?? []
  const shownAnalysisId = selectedAnalysisId && historyList.some((a) => a.analysisId === selectedAnalysisId) ? selectedAnalysisId : historyList[0]?.analysisId ?? null
  const loadAnalysis = useCallback((signal: AbortSignal) => getAnalysis(shownAnalysisId!, signal), [shownAnalysisId])
  const analysis = useApiResource(shownAnalysisId, loadAnalysis)

  const currentExtractionId = extraction.status === 'ready' ? extraction.data?.extractionId ?? null : null
  const legacyExtraction = extraction.status === 'ready' && !extraction.data?.extractionId
  const canAnalyze = processed && extraction.status === 'ready' && !legacyExtraction

  const process = async () => {
    if (busy.current) return
    busy.current = true
    setProcessing(true)
    setProcessFeedback(null)
    try {
      const summary = await processDocument(doc.id)
      const units = 'pageCount' in summary ? `${summary.pageCount} páginas (${summary.pagesWithText} con texto)` : `${summary.paragraphCount} párrafos con texto`
      setProcessFeedback({ tone: 'success', title: 'Documento procesado', detail: `Se extrajo el texto: ${units}. Ya puedes iniciar el análisis con IA.` })
    } catch (error) {
      setProcessFeedback({ tone: 'error', title: 'No se pudo procesar el documento', detail: errorDetail(error) })
    } finally {
      busy.current = false
      setProcessing(false)
      onDocumentChanged() // status always comes from the backend
    }
  }

  const analyze = async () => {
    if (busy.current) return
    busy.current = true
    setAnalyzing(true)
    setAnalysisFeedback(null)
    try {
      const created = await startAnalysis(doc.id)
      setAnalysisFeedback({ tone: 'success', title: 'Análisis completado', detail: 'Los resultados se cargaron desde el registro guardado.' })
      setSearchParam('analisis', created.analysisId) // the result itself is re-read with GET /api/analyses/:id
    } catch (error) {
      const recorded = error instanceof Error && /recorded as analysis/.test(error.message)
      setAnalysisFeedback({
        tone: 'error',
        title: analysisErrorTitle(error),
        detail: `${errorDetail(error)}${recorded ? ' El intento fallido quedó registrado en el historial.' : ''}`,
      })
    } finally {
      busy.current = false
      setAnalyzing(false)
      history.reload()
    }
  }

  // Move focus to a newly displayed result.
  const lastShown = useRef<string | null>(null)
  useEffect(() => {
    if (analysis.status === 'ready' && analysis.data && lastShown.current !== analysis.data.analysisId) {
      if (lastShown.current !== null) window.document.getElementById('analysis-title')?.focus()
      lastShown.current = analysis.data.analysisId
    }
  }, [analysis.status, analysis.data])

  const status = DOCUMENT_STATUS[doc.status]
  return (
    <div className="min-w-0 space-y-8">
      {/* Document and processing */}
      <section aria-labelledby="doc-title" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Documento seleccionado</p>
            <h2 id="doc-title" className="mt-1 text-base font-semibold break-words text-zinc-900">{doc.originalFilename}</h2>
            <p className="text-xs text-zinc-500">{formatLabel(doc.extension)} · subido {formatDate(doc.createdAt)}</p>
          </div>
          <StatusIndicator tone={processing ? 'info' : status.tone} label={processing ? 'Procesando' : status.label} live />
        </div>

        {processing && <Alert tone="info" title="Procesando documento…">Extrayendo el texto del documento original. Esto puede tardar unos segundos.</Alert>}
        {processFeedback && !processing && <Alert tone={processFeedback.tone} title={processFeedback.title}>{processFeedback.detail}</Alert>}

        {!processing && doc.status === 'uploaded' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={process}>Procesar documento</Button>
            <p className="text-xs text-zinc-500">Extrae el texto del documento. No inicia el análisis con IA.</p>
          </div>
        )}
        {!processing && doc.status === 'failed' && (
          <div className="space-y-3">
            {!processFeedback && <Alert tone="error" title="El último procesamiento falló">Revisa que el archivo sea un PDF o DOCX con texto (los documentos escaneados no son compatibles) y vuelve a intentarlo.</Alert>}
            <Button onClick={process}>Reintentar procesamiento</Button>
          </div>
        )}
        {!processing && doc.status === 'processing' && (
          <div className="space-y-3">
            <Alert tone="info" title="El documento figura en procesamiento">Si el proceso se interrumpió, puedes reintentarlo.</Alert>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onDocumentChanged}>Actualizar estado</Button>
              <Button onClick={process}>Reintentar procesamiento</Button>
            </div>
          </div>
        )}
        {processed && (
          <div className="border-t border-zinc-200 pt-3 text-sm" data-extraction-summary>
            {extraction.status === 'loading' && <p role="status" className="text-zinc-500">Cargando texto extraído…</p>}
            {extraction.status === 'error' && <Alert tone="error" title="No se pudo cargar el texto extraído" actions={<Button variant="secondary" onClick={extraction.reload}>Reintentar</Button>}>{errorDetail(extraction.error)}</Alert>}
            {extraction.status === 'ready' && extraction.data && (
              <>
                <p className="text-zinc-700">Texto extraído: <strong className="font-semibold text-zinc-900" data-units>{extractionUnits(extraction.data)}</strong> · {formatDate(extraction.data.extractedAt)}</p>
                {legacyExtraction && (
                  <div className="mt-3 space-y-2">
                    <Alert tone="info" title="Se requiere volver a procesar">Esta extracción es de una versión anterior del sistema y no permite referencias verificables.</Alert>
                    <Button onClick={process}>Volver a procesar</Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* AI analysis */}
      <section aria-labelledby="ai-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="ai-title" className="text-base font-semibold text-zinc-900">Análisis con IA</h2>
            <p className="text-sm text-zinc-600">Identifica afirmaciones verificables, contradicciones y vacíos a partir del texto extraído.</p>
          </div>
          <Button onClick={analyze} disabled={!canAnalyze || analyzing || processing} aria-busy={analyzing} aria-describedby={!canAnalyze ? 'analyze-requirement' : undefined}>
            {analyzing ? 'Analizando…' : historyList.length > 0 ? 'Nuevo análisis' : 'Iniciar análisis con IA'}
          </Button>
        </div>
        {!canAnalyze && !analyzing && (
          <p id="analyze-requirement" className="text-xs text-zinc-500">
            {legacyExtraction ? 'Vuelve a procesar el documento para habilitar el análisis.' : 'El análisis se habilita cuando el documento está procesado.'}
          </p>
        )}
        {analyzing && <Alert tone="info" title="Análisis con IA en curso…">Puede tardar varios minutos. No cierres esta página; el resultado quedará guardado.</Alert>}
        {analysisFeedback && !analyzing && <Alert tone={analysisFeedback.tone} title={analysisFeedback.title}>{analysisFeedback.detail}</Alert>}

        <AnalysisHistory history={history} shownAnalysisId={shownAnalysisId} />
      </section>

      {shownAnalysisId && (
        <div>
          {analysis.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando análisis guardado…</p>}
          {analysis.status === 'error' && <Alert tone="error" title="No se pudo cargar el análisis" actions={<Button variant="secondary" onClick={analysis.reload}>Reintentar</Button>}>{errorDetail(analysis.error)}</Alert>}
          {analysis.status === 'ready' && analysis.data && <AnalysisResult analysis={analysis.data} document={doc} currentExtractionId={currentExtractionId} />}
        </div>
      )}
    </div>
  )
}

function AnalysisHistory({ history, shownAnalysisId }: { history: ReturnType<typeof useApiResource<AnalysisSummary[]>>; shownAnalysisId: string | null }) {
  if (history.status === 'loading') return <p role="status" className="text-sm text-zinc-500">Cargando historial de análisis…</p>
  if (history.status === 'error') return <Alert tone="error" title="No se pudo cargar el historial de análisis" actions={<Button variant="secondary" onClick={history.reload}>Reintentar</Button>}>{errorDetail(history.error)}</Alert>
  const list = history.data ?? []
  if (list.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-600">Este documento aún no tiene análisis.</p>
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-zinc-900">Historial de análisis ({list.length})</h3>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="Historial de análisis">
        {list.map((a) => {
          const selected = a.analysisId === shownAnalysisId
          return (
            <li key={a.analysisId}>
              <button
                type="button"
                onClick={() => setSearchParam('analisis', a.analysisId)}
                aria-pressed={selected}
                className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm ${selected ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}
              >
                <span className="text-zinc-800"><time dateTime={a.createdAt}>{formatDate(a.createdAt)}</time></span>
                <span className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-600">
                  {a.status === 'completed'
                    ? <span>{[
                        plural(a.counts.confirmed, 'confirmada', 'confirmadas'),
                        plural(a.counts.pendingValidation, 'pendiente', 'pendientes'),
                        ...(a.counts.contradictions !== null ? [plural(a.counts.contradictions, 'contradicción', 'contradicciones'), plural(a.counts.documentationGaps ?? 0, 'vacío', 'vacíos')] : []),
                      ].join(' · ')}</span>
                    : <span>Sin resultados</span>}
                  <StatusIndicator tone={a.status === 'completed' ? 'success' : 'danger'} label={a.status === 'completed' ? 'Completado' : 'Fallido'} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
