import { useCallback, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { SECTIONS } from '../../navigation'
import { setSearchParams, useSearchParam } from '../../router'
import { errorDetail } from '../../services/api'
import {
  createImpactAnalysis,
  getImpactAnalysis,
  listCompatibleProposals,
  listImpactAnalyses,
  type ImpactAnalysis,
  type ImpactLevel,
  type ImpactResult,
  type ImpactReviewReason,
  type LearningElementType,
} from '../../services/impact.service'
import type { Project } from '../../services/projects.service'
import type { ProposalSummary } from '../../services/proposal.service'
import { Alert } from '../Alert'
import { Button, ButtonLink } from '../Button'
import { EmptyState } from '../EmptyState'
import { locatorLabel, plural, shortId } from '../analysis/labels'
import { SparklesIcon } from '../icons'
import { formatDate } from '../projects/format'
import { REVIEW_STATUS } from '../proposals/reviewLabels'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'
import { ChangeSource } from './ChangeSource'
import { LearningUpdatePanel } from './LearningUpdatePanel'

type Group = ImpactLevel | 'not_assessed'
const GROUPS: { id: Group; title: string; label: string; tone: StatusTone }[] = [
  { id: 'high', title: 'Impacto alto', label: 'Alto', tone: 'danger' },
  { id: 'medium', title: 'Impacto medio', label: 'Medio', tone: 'warning' },
  { id: 'low', title: 'Impacto bajo', label: 'Bajo', tone: 'info' },
  { id: 'not_assessed', title: 'Sin evaluación válida', label: 'Sin evaluar', tone: 'warning' },
  { id: 'no_impact', title: 'Cambios sin impacto', label: 'Sin impacto', tone: 'neutral' },
]
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<Group, (typeof GROUPS)[number]>

const ELEMENT: Record<LearningElementType, string> = { module: 'Módulo', lesson: 'Lección', activity: 'Actividad', assessment: 'Evaluación' }
const CHANGE: Record<ImpactResult['changeType'], string> = { added: 'Contenido añadido', removed: 'Contenido eliminado', modified: 'Contenido modificado' }
const REASON: Record<ImpactReviewReason, string> = {
  uncertain: 'La IA no pudo establecer con suficiente respaldo la relación con el contenido.',
  not_assessed: 'No hay una evaluación válida de la IA para este cambio; debe revisarse manualmente.',
  unresolved_issue: 'Involucra contenido con información pendiente de validación o contradicciones sin resolver.',
  no_element_identified: 'Indica impacto sin identificar elementos de aprendizaje afectados.',
  linked_elements_not_listed: 'Hay elementos que citan el texto anterior y la evaluación no los incluye.',
  element_requires_review: 'Incluye elementos ya marcados para revisión en la propuesta.',
}
const WARNING: Record<string, (a: ImpactAnalysis) => string> = {
  proposal_rejected: () => 'La propuesta evaluada fue rechazada en revisión humana.',
  proposal_pending_review: () => 'La propuesta evaluada aún no tiene una decisión de revisión humana.',
  review_status_unavailable: () => 'No se pudo leer el estado de revisión de la propuesta.',
  source_analysis_unavailable: () => 'No se pudo leer el análisis documental de la propuesta; se desconoce el estado de sus afirmaciones.',
  rejected_results: (a) => `${plural(a.rejectedResults.length, 'resultado de la IA no superó', 'resultados de la IA no superaron')} la validación y se descartaron.`,
  not_assessed: (a) => `${plural(a.summary.not_assessed, 'cambio no tiene', 'cambios no tienen')} una evaluación válida y deben revisarse manualmente.`,
}
const ERROR: Record<string, string> = {
  PROVIDER_ERROR: 'El proveedor de IA no respondió correctamente.',
  PROVIDER_TIMEOUT: 'El proveedor de IA no respondió a tiempo.',
  INVALID_RESPONSE: 'La respuesta de la IA no superó la validación.',
  REFUSAL: 'El proveedor de IA rechazó la solicitud.',
}

/**
 * E5.2: AI impact analysis of the changes between two versions on a learning proposal of the previous version.
 * Results are persisted recommendations for human review; no learning content is created or modified.
 */
export function ImpactAnalysisPanel({ project, documentId, from, to }: { project: Project; documentId: string; from: number; to: number }) {
  const proposalParam = useSearchParam('propuesta')
  const impactParam = useSearchParam('impacto')
  const loadProposals = useCallback((s: AbortSignal) => listCompatibleProposals(project.id, documentId, from, s), [project.id, documentId, from])
  const compatible = useApiResource(`${documentId}:${from}:proposals`, loadProposals)
  const loadHistory = useCallback((s: AbortSignal) => listImpactAnalyses(project.id, documentId, from, to, s), [project.id, documentId, from, to])
  const history = useApiResource(`${documentId}:${from}:${to}:impact`, loadHistory)
  const [run, setRun] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  const proposals = compatible.data?.proposals ?? []
  const selected = proposals.find((p) => p.proposalId === proposalParam) ?? null
  const entries = history.data ?? []
  const shownId = entries.find((e) => e.impactAnalysisId === impactParam)?.impactAnalysisId ?? entries[0]?.impactAnalysisId ?? null
  const loadDetail = useCallback((s: AbortSignal) => getImpactAnalysis(shownId!, s), [shownId])
  const detail = useApiResource(shownId, loadDetail)
  const titleOf = (id: string) => proposals.find((p) => p.proposalId === id)?.title ?? `Propuesta ${shortId(id)}`

  const analyze = async () => {
    if (!selected) return
    setRun({ kind: 'running' })
    try {
      const created = await createImpactAnalysis(project.id, documentId, from, to, selected.proposalId)
      setRun({ kind: 'idle' })
      setSearchParams({ impacto: created.impactAnalysisId, actualizacion: null })
    } catch (error) {
      setRun({ kind: 'error', message: errorDetail(error) })
    } finally {
      history.reload()
    }
  }

  return (
    <section aria-labelledby="impact-title" className="space-y-4 border-t border-zinc-200 pt-6" data-impact>
      <div>
        <h2 id="impact-title" className="text-base font-semibold text-zinc-900">Análisis de impacto</h2>
        <p className="mt-1 text-sm text-zinc-600">
          La IA evalúa cómo afectan los cambios de la versión {from} a la {to} a una propuesta de aprendizaje de la versión {from}. Es una recomendación para revisión humana: no modifica ni genera contenido.
        </p>
      </div>

      {compatible.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando propuestas de la versión {from}…</p>}
      {compatible.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar las propuestas" actions={<Button variant="secondary" onClick={compatible.reload}>Reintentar</Button>}>{errorDetail(compatible.error)}</Alert>
      )}
      {compatible.status === 'ready' && proposals.length === 0 && (
        <EmptyState icon={SparklesIcon} title={`No hay contenido de aprendizaje de la versión ${from}`}
          description={`Ninguna propuesta se generó a partir del texto extraído de la versión ${from}, así que no hay contenido que evaluar. Las propuestas de otras versiones no se usan.`}
          actions={<ButtonLink to={SECTIONS.generator.path}>Ir al Generador de aprendizaje</ButtonLink>} />
      )}
      {compatible.status === 'ready' && proposals.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-900">Propuesta a evaluar (versión {from})</legend>
          <div className="space-y-2" data-proposal-options>
            {proposals.map((p) => <ProposalOption key={p.proposalId} proposal={p} checked={p.proposalId === selected?.proposalId}
              onChange={() => setSearchParams({ propuesta: p.proposalId })} />)}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={analyze} disabled={!selected || run.kind === 'running'} aria-busy={run.kind === 'running'} data-run-impact>
              {run.kind === 'running' ? 'Analizando…' : 'Analizar impacto con IA'}
            </Button>
            {!selected && <span className="text-xs text-zinc-500">Selecciona la propuesta que quieres evaluar.</span>}
            {run.kind === 'running' && <StatusIndicator tone="info" label="Analizando el impacto con IA. Puede tardar unos minutos." live />}
          </div>
        </fieldset>
      )}
      {run.kind === 'error' && <Alert tone="error" title="No se pudo completar el análisis de impacto">{run.message}</Alert>}

      {history.status === 'error' && (
        <Alert tone="error" title="No se pudo cargar el historial de análisis" actions={<Button variant="secondary" onClick={history.reload}>Reintentar</Button>}>{errorDetail(history.error)}</Alert>
      )}
      {entries.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="impact-history" className="text-sm font-medium text-zinc-900">Análisis realizados ({entries.length})</label>
          <select id="impact-history" value={shownId ?? ''} onChange={(e) => setSearchParams({ impacto: e.target.value, actualizacion: null })}
            className="block min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm">
            {entries.map((e) => (
              <option key={e.impactAnalysisId} value={e.impactAnalysisId}>
                {formatDate(e.createdAt)} · {titleOf(e.proposalId)} · {e.status === 'failed' ? 'fallido' : `${e.summary.high} alto, ${e.summary.medium} medio, ${e.summary.low} bajo`}
              </option>
            ))}
          </select>
        </div>
      )}
      {history.status === 'ready' && entries.length === 0 && proposals.length > 0 && <p className="text-sm text-zinc-500">Aún no hay análisis de impacto para estas versiones.</p>}

      {detail.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando análisis de impacto…</p>}
      {detail.status === 'error' && (
        <Alert tone="error" title="No se pudo cargar el análisis de impacto" actions={<Button variant="secondary" onClick={detail.reload}>Reintentar</Button>}>{errorDetail(detail.error)}</Alert>
      )}
      {detail.status === 'ready' && detail.data && <ImpactView key={detail.data.impactAnalysisId} analysis={detail.data} proposalTitle={titleOf(detail.data.proposalId)} />}
      {detail.status === 'ready' && detail.data?.status === 'completed' && (
        <LearningUpdatePanel key={`update:${detail.data.impactAnalysisId}`}project={project} documentId={documentId} analysis={detail.data} proposalTitle={titleOf(detail.data.proposalId)} />
      )}
    </section>
  )
}

function ProposalOption({ proposal: p, checked, onChange }: { proposal: ProposalSummary; checked: boolean; onChange: () => void }) {
  const review = REVIEW_STATUS[p.reviewStatus]
  return (
    <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${checked ? 'border-accent-500 bg-accent-50/40' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`} data-proposal={p.proposalId}>
      <input type="radio" name="impact-proposal" checked={checked} onChange={onChange} className="mt-1 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words text-zinc-900">{p.title ?? 'Propuesta sin título'} <span className="font-normal text-zinc-500">· versión {p.proposalVersion ?? 1}</span></span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          {formatDate(p.createdAt)} · {plural(p.counts.modules, 'módulo', 'módulos')} · {plural(p.counts.lessons, 'lección', 'lecciones')} · <span className="font-mono">{shortId(p.proposalId)}</span>
        </span>
        <span className="mt-1 block"><StatusIndicator tone={review.tone} label={review.short} /></span>
      </span>
    </label>
  )
}

function ImpactView({ analysis: a, proposalTitle }: { analysis: ImpactAnalysis; proposalTitle: string }) {
  const review = REVIEW_STATUS[a.proposalReviewStatus]
  const meta = (
    <p className="text-xs text-zinc-500">
      {formatDate(a.createdAt)} · {proposalTitle} ({review.short.toLowerCase()} al analizar) · Modelo {a.model} · {a.promptVersion} · <span className="font-mono">{shortId(a.impactAnalysisId)}</span>
    </p>
  )
  if (a.status === 'failed') {
    return (
      <div className="space-y-2" data-impact-result="failed">
        {meta}
        <Alert tone="error" title="Este análisis de impacto falló">
          {ERROR[a.error?.code ?? ''] ?? 'El análisis no pudo completarse.'} No se generaron resultados.
        </Alert>
      </div>
    )
  }
  const groups = GROUPS.map((g) => ({ ...g, results: a.results.filter((r) => (r.impact ?? 'not_assessed') === g.id) })).filter((g) => g.results.length > 0)
  const counts: [string, number, StatusTone][] = [
    ...GROUPS.map((g): [string, number, StatusTone] => [g.label, a.summary[g.id], g.tone]),
    ['Requieren revisión humana', a.summary.requiresHumanReview, 'warning'],
  ]
  return (
    <div className="space-y-5" data-impact-result="completed">
      {meta}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Resumen del análisis de impacto">
        {counts.map(([label, n, tone]) => (
          <div key={label} className="rounded-md border border-zinc-200 bg-white px-3 py-2" data-impact-count={label}>
            <dt><StatusIndicator tone={tone} label={label} /></dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-900">{n}</dd>
          </div>
        ))}
      </dl>
      <Alert tone="info" title="Recomendación para revisión humana">
        Estos resultados no modifican la propuesta. A partir de ellos puedes generar una actualización del contenido, que solo se aplica como nueva versión si la apruebas.
      </Alert>
      {a.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-impact-warnings>
          <p className="font-medium">Advertencias</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {a.warnings.map((w, i) => <li key={i}>{w.code ? WARNING[w.code]?.(a) ?? w.message : w.message}{w.source === 'ai' && <span className="text-amber-700"> (IA)</span>}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-900">Elementos de aprendizaje afectados ({a.affectedElements.length})</h3>
        {a.affectedElements.length === 0 ? <p className="text-sm text-zinc-500">Ningún elemento existente aparece como afectado.</p> : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white" data-affected-elements>
            {a.affectedElements.map((e) => (
              <li key={e.elementId} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between" data-element={e.elementId}>
                <span className="min-w-0 text-sm break-words text-zinc-800">
                  <span className="font-medium">{ELEMENT[e.elementType]}</span> · {e.title} <span className="font-mono text-xs text-zinc-500">{e.elementId}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
                  {plural(e.changeIds.length, 'cambio', 'cambios')}
                  <StatusIndicator tone={GROUP[e.highestImpact].tone} label={GROUP[e.highestImpact].title} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`impact-group-${g.id}`} className="space-y-3" data-impact-group={g.id}>
          <h3 id={`impact-group-${g.id}`} className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <StatusIndicator tone={g.tone} label={g.title} /> <span className="text-zinc-500">({g.results.length})</span>
          </h3>
          <ol className="space-y-3">{g.results.map((r) => <ImpactCard key={r.changeId} result={r} />)}</ol>
        </section>
      ))}
      {a.rejectedResults.length > 0 && (
        <p className="text-xs text-zinc-500">{plural(a.rejectedResults.length, 'resultado de la IA se descartó', 'resultados de la IA se descartaron')} por no superar la validación (cambios, elementos o referencias inexistentes).</p>
      )}
    </div>
  )
}

function ImpactCard({ result: r }: { result: ImpactResult }) {
  return (
    <li className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4" data-impact-change={r.changeId} data-impact-level={r.impact ?? 'not_assessed'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900">{CHANGE[r.changeType]}</p>
        <div className="flex flex-wrap gap-3">
          {r.certainty === 'uncertain' && r.origin === 'ai' && <StatusIndicator tone="warning" label="Incierto" />}
          {r.requiresHumanReview && <span data-requires-review><StatusIndicator tone="warning" label="Requiere revisión humana" /></span>}
        </div>
      </div>
      {r.origin === 'backend' ? (
        <p className="text-sm text-zinc-700">No hay una evaluación válida de la IA para este cambio. Revísalo manualmente frente al contenido de aprendizaje.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          <div><dt className="text-xs font-medium text-zinc-500">Justificación</dt><dd className="break-words text-zinc-800" data-justification>{r.justification}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-500">Recomendación de revisión</dt><dd className="break-words text-zinc-800">{r.reviewRecommendation}</dd></div>
        </dl>
      )}
      {r.affectedElements.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-500">Elementos afectados</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {r.affectedElements.map((e) => (
              <li key={e.elementId} className="max-w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs break-words text-zinc-700" data-affected={e.elementId}>
                {ELEMENT[e.elementType]} · {e.title} <span className="font-mono text-zinc-500">{e.elementId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.reviewReasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800" data-review-reasons>
          {r.reviewReasons.map((reason) => <li key={reason}>{REASON[reason]}</li>)}
        </ul>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-500">Fuentes verificadas</p>
        <div className="grid gap-3 md:grid-cols-2">
          {r.evidence.map((e) => (
            <div key={e.sourceId} className="min-w-0 space-y-1.5" data-evidence={e.version}>
              <p className="text-xs text-zinc-500">Versión {e.version} · {locatorLabel(e.locator)}</p>
              <p className="max-h-32 overflow-y-auto text-sm break-words whitespace-pre-line text-zinc-700">{e.text}</p>
              <ChangeSource unit={e} />
            </div>
          ))}
        </div>
      </div>
    </li>
  )
}
