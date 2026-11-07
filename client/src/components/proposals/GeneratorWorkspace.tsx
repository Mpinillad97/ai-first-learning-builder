import { useCallback, useRef, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParams, useSearchParam } from '../../router'
import { ApiError, errorDetail, isUnreachable } from '../../services/api'
import { listDocumentAnalyses, type AnalysisSummary } from '../../services/analysis.service'
import type { DocumentRecord } from '../../services/projects.service'
import { generateProposal, getProposal, listAnalysisProposals, type ProposalSummary } from '../../services/proposal.service'
import { SECTIONS } from '../../navigation'
import { Alert } from '../Alert'
import { Button, ButtonLink } from '../Button'
import { ArrowRightIcon } from '../icons'
import { plural, shortId } from '../analysis/labels'
import { formatDate, formatLabel } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'
import { ProposalView } from './ProposalView'
import { REVIEW_STATUS } from './reviewLabels'
import { AnalysisList } from '../selection/AnalysisList'
import { FindingsPanel } from '../findings/FindingsPanel'
import { ProposalDashboard, type GeneratorView } from '../trainings/ProposalDashboard'
import { TrainingDetail } from '../trainings/TrainingDetail'

/** Why an analysis cannot be used (null when eligible). Mirrors the backend checks; the backend checks again. */
function ineligibility(a: AnalysisSummary): string | null {
  if (a.status !== 'completed') return 'El análisis falló y no tiene resultados.'
  if (a.schemaVersion < 2) return 'El análisis tiene un formato anterior sin detección de contradicciones ni vacíos. Ejecuta un nuevo análisis.'
  if (a.counts.confirmed === 0) return 'El análisis no tiene afirmaciones confirmadas; no hay contenido factual que enseñar.'
  return null
}

function generationErrorTitle(error: unknown): string {
  if (isUnreachable(error)) return 'No se pudo conectar con el servidor'
  if (!(error instanceof ApiError)) return 'No se pudo generar la propuesta'
  if (error.status === 503) return 'La generación con IA no está configurada en el servidor'
  if (error.status === 504) return 'El proveedor de IA no respondió a tiempo'
  if (error.status === 502) return /failed validation/.test(error.message) ? 'La propuesta generada no superó la validación' : 'El proveedor de IA falló o devolvió una respuesta inválida'
  if (error.status === 409) return 'Este análisis no permite generar una propuesta'
  return 'No se pudo generar la propuesta'
}

interface GeneratorWorkspaceProps {
  document: DocumentRecord
  projectId: string
  analysisParam: string | null
  proposalParam: string | null
}

/** Analysis selection, proposal generation and persisted proposal history for one document. */
export function GeneratorWorkspace({ document: doc, projectId, analysisParam, proposalParam }: GeneratorWorkspaceProps) {
  const loadAnalyses = useCallback((signal: AbortSignal) => listDocumentAnalyses(doc.id, signal), [doc.id])
  const analyses = useApiResource(doc.id, loadAnalyses)
  const list = analyses.data ?? []
  const analysis = list.find((a) => a.analysisId === analysisParam) ?? (analysisParam ? undefined : list.find((a) => !ineligibility(a)) ?? list[0])
  const reason = analysis ? ineligibility(analysis) : null

  const analysisId = analysis?.analysisId ?? null
  const loadProposals = useCallback((signal: AbortSignal) => listAnalysisProposals(analysisId!, signal), [analysisId])
  const proposals = useApiResource(analysisId, loadProposals)
  const proposalList = proposals.data ?? []
  const proposalId = proposalParam && proposalList.some((p) => p.proposalId === proposalParam) ? proposalParam : proposalList[0]?.proposalId ?? null
  const loadProposal = useCallback((signal: AbortSignal) => getProposal(proposalId!, signal), [proposalId])
  const proposal = useApiResource(proposalId, loadProposal)

  const [generating, setGenerating] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; title: string; detail: string } | null>(null)
  const busy = useRef(false)

  // E5.5: which detail of the selected proposal is open (default: the management panel).
  const vista = useSearchParam('vista')
  const formacion = useSearchParam('formacion')
  const modo = useSearchParam('modo') === 'revision' ? 'revision' : 'documento'
  const openView = (view: GeneratorView | null) => setSearchParams({ vista: null, formacion: null, modo: null, ...(view ?? {}) })

  const select = (values: Record<string, string | null>) => {
    setFeedback(null)
    setSearchParams({ proyecto: projectId, documento: doc.id, vista: null, formacion: null, modo: null, ...values })
  }

  const generate = async () => {
    if (busy.current || !analysisId) return
    busy.current = true
    setGenerating(true)
    setFeedback(null)
    try {
      const created = await generateProposal(analysisId)
      setFeedback({ tone: 'success', title: 'Propuesta generada como borrador', detail: 'Se cargó desde el registro guardado. Requiere revisión humana antes de cualquier uso.' })
      setSearchParams({ proyecto: projectId, documento: doc.id, analisis: analysisId, propuesta: created.proposalId, vista: null, formacion: null, modo: null })
    } catch (error) {
      const recorded = error instanceof Error && /recorded as proposal/.test(error.message)
      setFeedback({ tone: 'error', title: generationErrorTitle(error), detail: `${errorDetail(error)}${recorded ? ' El intento fallido quedó registrado en el historial.' : ''}` })
    } finally {
      busy.current = false
      setGenerating(false)
      proposals.reload()
    }
  }

  return (
    <div className="min-w-0 space-y-8">
      <section aria-labelledby="gen-doc-title" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6" data-print-hidden>
        <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Documento seleccionado</p>
        <h2 id="gen-doc-title" className="text-base font-semibold break-words text-zinc-900">{doc.originalFilename}</h2>
        <p className="text-xs text-zinc-500">{formatLabel(doc.extension)} · subido {formatDate(doc.createdAt)}</p>

        <h3 className="pt-2 text-sm font-semibold text-zinc-900">Análisis disponibles</h3>
        {analyses.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando análisis…</p>}
        {analyses.status === 'error' && <Alert tone="error" title="No se pudieron cargar los análisis" actions={<Button variant="secondary" onClick={analyses.reload}>Reintentar</Button>}>{errorDetail(analyses.error)}</Alert>}
        {analyses.status === 'ready' && list.length === 0 && (
          <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center">
            <p className="text-sm text-zinc-600">Este documento aún no tiene análisis. La propuesta se genera a partir de un análisis completado.</p>
            <ButtonLink to={`${SECTIONS.analysis.path}?proyecto=${projectId}&documento=${doc.id}`}>Ir a Análisis documental <ArrowRightIcon /></ButtonLink>
          </div>
        )}
        {list.length > 0 && analyses.status !== 'loading' && (
          <AnalysisList analyses={list} selectedId={analysis?.analysisId ?? null} onSelect={(id) => select({ analisis: id, propuesta: null })}
            badge={(a) => { const blocked = ineligibility(a); return { tone: blocked ? (a.status === 'failed' ? 'danger' : 'neutral') : 'success', label: blocked ? (a.status === 'failed' ? 'Fallido' : 'No apto') : 'Apto para generar' } }} />
        )}
        {analysisParam && analyses.status === 'ready' && !analysis && <Alert tone="error" title="Análisis no encontrado para este documento">Selecciona un análisis de la lista.</Alert>}
      </section>

      {analysis && (
        <section aria-labelledby="gen-title" className="space-y-4" data-print-hidden>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="gen-title" className="text-base font-semibold text-zinc-900">Propuesta de aprendizaje</h2>
              <p className="text-sm text-zinc-600">
                Análisis <span className="font-mono text-xs" title={analysis.analysisId}>{shortId(analysis.analysisId)}</span> · {formatDate(analysis.createdAt)}
                {analysis.counts.contradictions !== null && ` · ${plural(analysis.counts.contradictions, 'contradicción', 'contradicciones')} · ${plural(analysis.counts.documentationGaps ?? 0, 'vacío', 'vacíos')}`}
              </p>
            </div>
            <Button onClick={generate} disabled={Boolean(reason) || generating} aria-busy={generating} aria-describedby={reason ? 'gen-requirement' : undefined}>
              {generating ? 'Generando…' : 'Generar propuesta'}
            </Button>
          </div>
          {reason && <Alert tone="info" title="Este análisis no permite generar una propuesta"><span id="gen-requirement">{reason}</span></Alert>}
          {generating && <Alert tone="info" title="Generando propuesta con IA…">Puede tardar varios minutos. El resultado quedará guardado como borrador.</Alert>}
          {feedback && !generating && <Alert tone={feedback.tone} title={feedback.title}>{feedback.detail}</Alert>}
          <ProposalHistory proposals={proposals} selectedId={proposalId} onSelect={(id) => select({ analisis: analysis.analysisId, propuesta: id })} />
        </section>
      )}

      {proposalId && (
        <div>
          {proposal.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando propuesta guardada…</p>}
          {proposal.status === 'error' && <Alert tone="error" title="No se pudo cargar la propuesta" actions={<Button variant="secondary" onClick={proposal.reload}>Reintentar</Button>}>{errorDetail(proposal.error)}</Alert>}
          {proposal.status === 'ready' && proposal.data && (() => {
            const data = proposal.data
            const summary = proposalList.find((p) => p.proposalId === proposalId)
            // Failed attempts have no learning content: their validation errors are shown directly.
            if (data.status !== 'draft' || !data.content) return <ProposalView proposal={data} reviewStatus={summary?.reviewStatus} />
            if (vista === 'propuesta') return (
              <div className="space-y-4">
                <Button variant="secondary" onClick={() => openView(null)}>← Volver al panel de la propuesta</Button>
                <ProposalView proposal={data} reviewStatus={summary?.reviewStatus} />
              </div>
            )
            if (vista === 'hallazgos') return <FindingsPanel analysisId={data.analysisId} proposalId={data.proposalId} onBack={() => openView(null)} />
            if (vista === 'formacion' && formacion) return <TrainingDetail key={formacion} trainingId={formacion} mode={modo} onMode={(m) => openView({ vista: 'formacion', formacion, modo: m })} onBack={() => openView(null)} />
            return <ProposalDashboard key={data.proposalId} proposal={data} summary={summary} projectId={projectId} documentId={doc.id} onOpen={openView} />
          })()}
        </div>
      )}
    </div>
  )
}

function ProposalHistory({ proposals, selectedId, onSelect }: { proposals: { status: string; data?: ProposalSummary[]; error: unknown; reload: () => void }; selectedId: string | null; onSelect: (id: string) => void }) {
  if (proposals.status === 'loading') return <p role="status" className="text-sm text-zinc-500">Cargando historial de propuestas…</p>
  if (proposals.status === 'error') return <Alert tone="error" title="No se pudo cargar el historial de propuestas" actions={<Button variant="secondary" onClick={proposals.reload}>Reintentar</Button>}>{errorDetail(proposals.error)}</Alert>
  const list = proposals.data ?? []
  if (list.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-600">Aún no hay propuestas para este análisis.</p>
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-zinc-900">Historial de propuestas ({list.length})</h3>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="Historial de propuestas">
        {list.map((p) => (
          <li key={p.proposalId}>
            <button type="button" onClick={() => onSelect(p.proposalId)} aria-pressed={p.proposalId === selectedId}
              className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left text-sm sm:flex-row sm:items-center sm:justify-between ${p.proposalId === selectedId ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}>
              <span className="min-w-0">
                <span className="block truncate text-zinc-900">{p.title ?? 'Intento fallido'}</span>
                <span className="text-xs text-zinc-500"><time dateTime={p.createdAt}>{formatDate(p.createdAt)}</time> · <span className="font-mono" title={p.proposalId}>{shortId(p.proposalId)}</span>
                  {p.status === 'draft' ? ` · ${plural(p.counts.modules, 'módulo', 'módulos')} · ${plural(p.counts.warnings, 'advertencia', 'advertencias')}` : ` · ${plural(p.counts.validationErrors, 'error de validación', 'errores de validación')}`}
                </span>
              </span>
              <StatusIndicator tone={p.status === 'draft' ? REVIEW_STATUS[p.reviewStatus].tone : 'danger'} label={p.status === 'draft' ? REVIEW_STATUS[p.reviewStatus].short : 'Fallido'} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
