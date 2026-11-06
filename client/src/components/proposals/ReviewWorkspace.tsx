import { useCallback } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParams } from '../../router'
import { errorDetail } from '../../services/api'
import { listDocumentAnalyses } from '../../services/analysis.service'
import type { DocumentRecord } from '../../services/projects.service'
import { getProposal, listAnalysisProposals } from '../../services/proposal.service'
import { SECTIONS } from '../../navigation'
import { Alert } from '../Alert'
import { Button, ButtonLink } from '../Button'
import { ArrowRightIcon } from '../icons'
import { plural, shortId } from '../analysis/labels'
import { formatDate, formatLabel } from '../projects/format'
import { AnalysisList } from '../selection/AnalysisList'
import { StatusIndicator } from '../StatusIndicator'
import { ProposalView } from './ProposalView'
import { ReviewPanel } from './ReviewPanel'
import { REVIEW_STATUS } from './reviewLabels'

interface ReviewWorkspaceProps {
  document: DocumentRecord
  projectId: string
  analysisParam: string | null
  proposalParam: string | null
}

/** Analysis → proposal selection and the review of one proposal. */
export function ReviewWorkspace({ document: doc, projectId, analysisParam, proposalParam }: ReviewWorkspaceProps) {
  const loadAnalyses = useCallback((signal: AbortSignal) => listDocumentAnalyses(doc.id, signal), [doc.id])
  const analyses = useApiResource(doc.id, loadAnalyses)
  const list = analyses.data ?? []
  const analysis = list.find((a) => a.analysisId === analysisParam) ?? (analysisParam ? undefined : list.find((a) => a.status === 'completed') ?? list[0])

  const analysisId = analysis?.analysisId ?? null
  const loadProposals = useCallback((signal: AbortSignal) => listAnalysisProposals(analysisId!, signal), [analysisId])
  const proposals = useApiResource(analysisId, loadProposals)
  const proposalList = proposals.data ?? []
  // Default: the newest proposal awaiting review, else the newest one.
  const proposalSummary = proposalList.find((p) => p.proposalId === proposalParam)
    ?? (proposalParam ? undefined : proposalList.find((p) => p.reviewStatus === 'pending_review') ?? proposalList[0])
  const proposalId = proposalSummary?.proposalId ?? null
  const loadProposal = useCallback((signal: AbortSignal) => getProposal(proposalId!, signal), [proposalId])
  const proposal = useApiResource(proposalId, loadProposal)

  const select = (values: Record<string, string | null>) => setSearchParams({ proyecto: projectId, documento: doc.id, ...values })

  return (
    <div className="min-w-0 space-y-8">
      <section aria-labelledby="rev-doc-title" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Documento seleccionado</p>
        <h2 id="rev-doc-title" className="text-base font-semibold break-words text-zinc-900">{doc.originalFilename}</h2>
        <p className="text-xs text-zinc-500">{formatLabel(doc.extension)} · subido {formatDate(doc.createdAt)}</p>

        <h3 className="pt-2 text-sm font-semibold text-zinc-900">Análisis</h3>
        {analyses.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando análisis…</p>}
        {analyses.status === 'error' && <Alert tone="error" title="No se pudieron cargar los análisis" actions={<Button variant="secondary" onClick={analyses.reload}>Reintentar</Button>}>{errorDetail(analyses.error)}</Alert>}
        {analyses.status === 'ready' && list.length === 0 && (
          <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center">
            <p className="text-sm text-zinc-600">Este documento aún no tiene análisis ni propuestas que revisar.</p>
            <ButtonLink to={`${SECTIONS.analysis.path}?proyecto=${projectId}&documento=${doc.id}`}>Ir a Análisis documental <ArrowRightIcon /></ButtonLink>
          </div>
        )}
        {list.length > 0 && analyses.status !== 'loading' && (
          <AnalysisList analyses={list} selectedId={analysisId} onSelect={(id) => select({ analisis: id, propuesta: null })}
            badge={(a) => (a.status === 'completed' ? { tone: 'success', label: 'Completado' } : { tone: 'danger', label: 'Fallido' })} />
        )}
        {analysisParam && analyses.status === 'ready' && !analysis && <Alert tone="error" title="Análisis no encontrado para este documento">Selecciona un análisis de la lista.</Alert>}
      </section>

      {analysis && (
        <section aria-labelledby="rev-proposals-title" className="space-y-3">
          <h2 id="rev-proposals-title" className="text-base font-semibold text-zinc-900">Propuestas generadas</h2>
          {proposals.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando propuestas…</p>}
          {proposals.status === 'error' && <Alert tone="error" title="No se pudieron cargar las propuestas" actions={<Button variant="secondary" onClick={proposals.reload}>Reintentar</Button>}>{errorDetail(proposals.error)}</Alert>}
          {proposals.status === 'ready' && proposalList.length === 0 && (
            <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center">
              <p className="text-sm text-zinc-600">No hay propuestas para este análisis.</p>
              <ButtonLink to={`${SECTIONS.generator.path}?proyecto=${projectId}&documento=${doc.id}&analisis=${analysis.analysisId}`}>Ir al Generador de aprendizaje <ArrowRightIcon /></ButtonLink>
            </div>
          )}
          {proposalList.length > 0 && proposals.status !== 'loading' && (
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="Propuestas para revisar">
              {proposalList.map((p) => {
                const st = REVIEW_STATUS[p.reviewStatus]
                return (
                  <li key={p.proposalId}>
                    <button type="button" onClick={() => select({ analisis: analysis.analysisId, propuesta: p.proposalId })} aria-pressed={p.proposalId === proposalId}
                      className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left text-sm sm:flex-row sm:items-center sm:justify-between ${p.proposalId === proposalId ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-zinc-900">{p.title ?? 'Intento de generación fallido'}</span>
                        <span className="text-xs text-zinc-500"><time dateTime={p.createdAt}>{formatDate(p.createdAt)}</time> · <span className="font-mono" title={p.proposalId}>{shortId(p.proposalId)}</span>
                          {p.status === 'draft' ? ` · ${plural(p.counts.warnings, 'advertencia', 'advertencias')}` : ` · ${plural(p.counts.validationErrors, 'error de validación', 'errores de validación')}`}
                        </span>
                      </span>
                      <StatusIndicator tone={st.tone} label={st.short} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {proposalId && (
        <div className="space-y-8">
          {proposal.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando propuesta…</p>}
          {proposal.status === 'error' && <Alert tone="error" title="No se pudo cargar la propuesta" actions={<Button variant="secondary" onClick={proposal.reload}>Reintentar</Button>}>{errorDetail(proposal.error)}</Alert>}
          {proposal.status === 'ready' && proposal.data && (
            <>
              <ReviewPanel key={proposal.data.proposalId} proposal={proposal.data} onDecided={proposals.reload} />
              <ProposalView proposal={proposal.data} reviewStatus={proposalSummary?.reviewStatus} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
