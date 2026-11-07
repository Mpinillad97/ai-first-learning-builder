import { useCallback, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParams, useSearchParam } from '../../router'
import { errorDetail } from '../../services/api'
import type { ImpactAnalysis, LearningElementType } from '../../services/impact.service'
import {
  generateLearningUpdate,
  getLearningUpdate,
  getProposalVersions,
  listLearningUpdates,
  reviewLearningUpdate,
  type ElementContent,
  type LearningUpdate,
  type NotUpdatedReason,
  type UpdateOperation,
  type UpdateOperationType,
} from '../../services/learning-updates.service'
import { getProposal } from '../../services/proposal.service'
import type { Project } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { locatorLabel, plural, shortId } from '../analysis/labels'
import { formatDate } from '../projects/format'
import { ReviewPanel, type ReviewPanelLabels } from '../proposals/ReviewPanel'
import { REVIEW_STATUS } from '../proposals/reviewLabels'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'
import { ChangeSource } from './ChangeSource'

const OPERATION: Record<UpdateOperationType, { label: string; tone: StatusTone; border: string }> = {
  add: { label: 'Añadido', tone: 'success', border: 'border-l-emerald-500' },
  modify: { label: 'Modificado', tone: 'warning', border: 'border-l-amber-500' },
  remove: { label: 'Retirado', tone: 'danger', border: 'border-l-red-500' },
}
const ELEMENT: Record<LearningElementType, string> = { module: 'Módulo', lesson: 'Lección', activity: 'Actividad', assessment: 'Evaluación' }
const ELEMENT_ORDER: LearningElementType[] = ['module', 'lesson', 'activity', 'assessment']
const LEVEL: Record<string, { label: string; tone: StatusTone }> = {
  high: { label: 'Impacto alto', tone: 'danger' },
  medium: { label: 'Impacto medio', tone: 'warning' },
  low: { label: 'Impacto bajo', tone: 'info' },
  no_impact: { label: 'Sin impacto', tone: 'neutral' },
}
const KIND: Record<string, string> = { fact: 'Hecho', guidance: 'Orientación', pending_validation: 'Pendiente de validación' }
const NOT_UPDATED: Record<NotUpdatedReason, string> = {
  no_impact: 'Sin impacto en el aprendizaje',
  uncertain: 'Impacto incierto: se conserva el contenido y se marca para revisión',
  not_assessed: 'Sin evaluación válida: requiere revisión manual',
  no_operation: 'La IA no propuso cambios para este cambio documental',
}
const WARNING: Record<string, string> = {
  stale_evidence: 'Algunos elementos sin cambios citan documentación que ya no está en la nueva versión; se marcaron para revisión.',
  flagged_uncertain: 'Los elementos relacionados con resultados inciertos se conservaron y se marcaron para revisión.',
  kept_for_review: 'La IA conservó algunos elementos sin cambios y los marcó para revisión.',
  rejected_operations: 'Algunas operaciones propuestas por la IA no superaron la validación y se descartaron.',
  downgraded_attribute: 'Algunos atributos perdieron su respaldo documental y pasaron a «pendiente de validación».',
  empty_module: 'Un módulo quedó sin lecciones tras la actualización.',
}
const ERROR: Record<string, string> = {
  PROVIDER_ERROR: 'El proveedor de IA no respondió correctamente.',
  PROVIDER_TIMEOUT: 'El proveedor de IA no respondió a tiempo.',
  INVALID_RESPONSE: 'La propuesta de la IA no superó la validación.',
  REFUSAL: 'El proveedor de IA rechazó la solicitud.',
}

/**
 * E5.3: proposes (with AI) an update of the learning content affected by a completed impact analysis, and lets a
 * person review it. Approval makes the new proposal version current; earlier versions are never modified.
 */
export function LearningUpdatePanel({ project, documentId, analysis, proposalTitle }: { project: Project; documentId: string; analysis: ImpactAnalysis; proposalTitle: string }) {
  const updateParam = useSearchParam('actualizacion')
  const loadList = useCallback((s: AbortSignal) => listLearningUpdates(project.id, documentId, analysis.impactAnalysisId, s), [project.id, documentId, analysis.impactAnalysisId])
  const list = useApiResource(`${analysis.impactAnalysisId}:updates`, loadList)
  const entries = list.data ?? []
  const shownId = entries.find((e) => e.updateId === updateParam)?.updateId ?? entries[0]?.updateId ?? null
  const loadDetail = useCallback((s: AbortSignal) => getLearningUpdate(shownId!, s), [shownId])
  const detail = useApiResource(shownId, loadDetail)
  const [run, setRun] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  const actionable = analysis.results.filter((r) => r.origin === 'ai' && r.certainty === 'supported' && r.impact !== null && r.impact !== 'no_impact')
  const generate = async () => {
    setRun({ kind: 'running' })
    try {
      const created = await generateLearningUpdate(project.id, documentId, analysis.impactAnalysisId)
      setRun({ kind: 'idle' })
      setSearchParams({ actualizacion: created.updateId })
    } catch (error) {
      setRun({ kind: 'error', message: errorDetail(error) })
    } finally {
      list.reload()
    }
  }
  const refresh = () => { list.reload(); detail.reload() }

  return (
    <section aria-labelledby="update-title" className="space-y-4 border-t border-zinc-200 pt-6" data-learning-update>
      <div>
        <h3 id="update-title" className="text-base font-semibold text-zinc-900">Actualización del contenido de aprendizaje</h3>
        <p className="mt-1 text-sm text-zinc-600">
          La IA propone cambios solo para los elementos con impacto respaldado. La propuesta original no se modifica: si apruebas la actualización, se crea una nueva versión de la propuesta.
        </p>
      </div>

      {actionable.length === 0 ? (
        <Alert tone="info" title="No hay contenido que actualizar">
          Ningún cambio tiene un impacto alto, medio o bajo respaldado por evidencia. Los cambios sin impacto, inciertos o sin evaluación válida no se convierten en modificaciones de contenido.
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={run.kind === 'running'} aria-busy={run.kind === 'running'} data-generate-update>
            {run.kind === 'running' ? 'Generando…' : 'Generar actualización con IA'}
          </Button>
          <span className="text-xs text-zinc-500">{plural(actionable.length, 'cambio con impacto respaldado', 'cambios con impacto respaldado')} sobre «{proposalTitle}».</span>
          {run.kind === 'running' && <StatusIndicator tone="info" label="Generando la propuesta de actualización con IA. Puede tardar unos minutos." live />}
        </div>
      )}
      {run.kind === 'error' && <Alert tone="error" title="No se pudo generar la actualización">{run.message}</Alert>}

      {list.status === 'error' && (
        <Alert tone="error" title="No se pudo cargar el historial de actualizaciones" actions={<Button variant="secondary" onClick={list.reload}>Reintentar</Button>}>{errorDetail(list.error)}</Alert>
      )}
      {entries.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="update-history" className="text-sm font-medium text-zinc-900">Actualizaciones generadas ({entries.length})</label>
          <select id="update-history" value={shownId ?? ''} onChange={(e) => setSearchParams({ actualizacion: e.target.value })}
            className="block min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm">
            {entries.map((e) => (
              <option key={e.updateId} value={e.updateId}>
                {formatDate(e.createdAt)} · versión {e.sourceProposalVersion} → {e.proposalVersion} · {e.status === 'failed' ? 'fallida' : `${REVIEW_STATUS[e.reviewStatus ?? 'unavailable'].short}${e.isCurrent ? ' · vigente' : ''}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {detail.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando actualización…</p>}
      {detail.status === 'error' && (
        <Alert tone="error" title="No se pudo cargar la actualización" actions={<Button variant="secondary" onClick={detail.reload}>Reintentar</Button>}>{errorDetail(detail.error)}</Alert>
      )}
      {detail.status === 'ready' && detail.data && <UpdateView key={detail.data.updateId} update={detail.data} project={project} documentId={documentId} proposalTitle={proposalTitle} onChanged={refresh} />}
    </section>
  )
}

function UpdateView({ update: u, project, documentId, proposalTitle, onChanged }: { update: LearningUpdate; project: Project; documentId: string; proposalTitle: string; onChanged: () => void }) {
  const loadCandidate = useCallback((s: AbortSignal) => getProposal(u.candidateProposalId!, s), [u.candidateProposalId])
  const candidate = useApiResource(u.candidateProposalId, loadCandidate)
  const loadVersions = useCallback((s: AbortSignal) => getProposalVersions(u.rootProposalId, s), [u.rootProposalId])
  const versions = useApiResource(`${u.rootProposalId}:${u.reviews.length}:${u.reviewStatus}`, loadVersions)
  const review = REVIEW_STATUS[u.reviewStatus ?? 'unavailable']

  const header = (
    <dl className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3" data-update-header>
      <div><dt className="text-xs text-zinc-500">Propuesta original</dt><dd className="break-words text-zinc-800">{proposalTitle} · versión {u.sourceProposalVersion} <span className="font-mono text-xs text-zinc-500">{shortId(u.sourceProposalId)}</span></dd></div>
      <div><dt className="text-xs text-zinc-500">Nueva propuesta</dt><dd className="text-zinc-800" data-new-version>{u.candidateProposalId ? <>Versión {u.proposalVersion} <span className="font-mono text-xs text-zinc-500">{shortId(u.candidateProposalId)}</span></> : 'No se generó'}</dd></div>
      <div>
        <dt className="text-xs text-zinc-500">Estado de revisión</dt>
        <dd className="flex flex-wrap items-center gap-2" data-update-status>
          {u.status === 'failed' ? <StatusIndicator tone="danger" label="Generación fallida" /> : <StatusIndicator tone={review.tone} label={review.short} />}
          {u.isCurrent && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700" data-current-proposal>Versión vigente</span>}
        </dd>
      </div>
      <div><dt className="text-xs text-zinc-500">Versiones del documento</dt><dd className="text-zinc-800">Versión {u.from.version} → versión {u.to.version}</dd></div>
      <div><dt className="text-xs text-zinc-500">Generada</dt><dd className="text-zinc-800"><time dateTime={u.createdAt}>{formatDate(u.createdAt)}</time></dd></div>
      <div><dt className="text-xs text-zinc-500">Modelo</dt><dd className="text-zinc-800">{u.model} · {u.promptVersion}</dd></div>
    </dl>
  )
  if (u.status === 'failed') {
    return (
      <div className="space-y-3" data-update-result="failed">
        {header}
        <Alert tone="error" title="Esta actualización falló">{ERROR[u.error?.code ?? ''] ?? 'La generación no pudo completarse.'} No se creó una nueva versión de la propuesta.</Alert>
      </div>
    )
  }

  const count = (op: UpdateOperationType) => u.operations.filter((o) => o.operation === op).length
  const counts: [string, number, StatusTone][] = [
    ['Añadidos', count('add'), 'success'], ['Modificados', count('modify'), 'warning'], ['Retirados', count('remove'), 'danger'],
    ['Sin cambios', u.unchangedElementIds.length, 'neutral'], ['Conservados para revisión', u.keptForReview.length, 'warning'],
  ]
  const moduleTitle = (moduleId: string) => {
    const fromCandidate = candidate.data?.content?.modules.find((m) => m.moduleId === moduleId)?.title
    const removed = u.operations.find((o) => o.elementType === 'module' && o.elementId === moduleId)?.previous
    return fromCandidate ?? (removed?.elementType === 'module' ? removed.title : moduleId)
  }
  const modules = [...new Set(u.operations.map((o) => o.moduleId))]
  const labels: ReviewPanelLabels = {
    approve: 'Aprobar actualización',
    reject: 'Rechazar actualización',
    approvedTitle: `Actualización aprobada: la versión ${u.proposalVersion} es ahora la vigente`,
    rejectedTitle: 'Actualización rechazada: se mantiene la versión vigente anterior',
    approvalNote: `Al aprobar, la versión ${u.proposalVersion} de la propuesta pasa a ser la vigente. La versión ${u.sourceProposalVersion} y sus decisiones se conservan sin cambios. No se publica nada.`,
    conflictTitle: 'La actualización cambió mientras la revisabas',
  }

  return (
    <div className="space-y-5" data-update-result="completed">
      {header}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Resumen de la actualización">
        {counts.map(([label, n, tone]) => (
          <div key={label} className="rounded-md border border-zinc-200 bg-white px-3 py-2" data-update-count={label}>
            <dt><StatusIndicator tone={tone} label={label} /></dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-900">{n}</dd>
          </div>
        ))}
      </dl>
      {u.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-update-warnings>
          <p className="font-medium">Advertencias e incertidumbres</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {u.warnings.map((w, i) => (
              <li key={i}>
                {w.code ? WARNING[w.code] ?? w.message : w.message}{w.source === 'ai' && <span className="text-amber-700"> (IA)</span>}
                {w.elementIds.length > 0 && <span className="font-mono text-xs text-amber-700"> {w.elementIds.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {modules.map((moduleId) => (
        <section key={moduleId} aria-label={`Cambios en ${moduleTitle(moduleId)}`} className="space-y-3" data-update-module={moduleId}>
          <h4 className="text-sm font-semibold text-zinc-900">Módulo · {moduleTitle(moduleId)} <span className="font-mono text-xs font-normal text-zinc-500">{moduleId}</span></h4>
          {ELEMENT_ORDER.map((type) => {
            const ops = u.operations.filter((o) => o.moduleId === moduleId && o.elementType === type)
            return ops.length === 0 ? null : (
              <div key={type} className="space-y-2" data-update-type={type}>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{ELEMENT[type]} ({ops.length})</p>
                <ol className="space-y-3">{ops.map((o) => <OperationCard key={o.operationId} op={o} />)}</ol>
              </div>
            )
          })}
        </section>
      ))}

      {u.keptForReview.length > 0 && (
        <div className="space-y-2" data-kept-for-review>
          <h4 className="text-sm font-semibold text-zinc-900">Conservados sin cambios y marcados para revisión</h4>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {u.keptForReview.map((k) => (
              <li key={k.elementId} className="px-4 py-2.5 text-sm text-zinc-800">
                <span className="font-medium">{ELEMENT[k.elementType]}</span> · {k.title} <span className="font-mono text-xs text-zinc-500">{k.elementId}</span>
                <p className="text-xs text-zinc-600">{k.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {u.notUpdatedChanges.length > 0 && (
        <div className="space-y-2" data-not-updated>
          <h4 className="text-sm font-semibold text-zinc-900">Cambios documentales sin modificación de contenido ({u.notUpdatedChanges.length})</h4>
          <ul className="space-y-1 text-sm text-zinc-700">
            {u.notUpdatedChanges.map((c) => (
              <li key={c.changeId} className="flex flex-wrap items-center gap-2">
                <StatusIndicator tone={c.impact ? LEVEL[c.impact].tone : 'warning'} label={c.impact ? LEVEL[c.impact].label : 'Sin evaluar'} />
                <span>{NOT_UPDATED[c.reason]}</span> <span className="font-mono text-xs text-zinc-500">{shortId(c.changeId.replace(/^chg_/, ''))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {u.rejectedOperations.length > 0 && <p className="text-xs text-zinc-500">{plural(u.rejectedOperations.length, 'operación de la IA se descartó', 'operaciones de la IA se descartaron')} por no superar la validación (elementos, cambios o referencias no válidos, o afirmaciones sin respaldo).</p>}

      {versions.status === 'ready' && versions.data && (
        <div className="space-y-2" data-proposal-versions>
          <h4 className="text-sm font-semibold text-zinc-900">Versiones de la propuesta</h4>
          <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {versions.data.versions.map((v) => (
              <li key={v.proposalId} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between" data-proposal-version={v.proposalVersion} data-version-current={v.isCurrent}>
                <span className="min-w-0 break-words text-zinc-800">
                  Versión {v.proposalVersion}{v.documentVersion !== null && ` · documento v${v.documentVersion}`} · {v.title ?? 'Sin título'} <span className="font-mono text-xs text-zinc-500">{shortId(v.proposalId)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {v.proposalVersion > 1 && <StatusIndicator tone={REVIEW_STATUS[v.reviewStatus].tone} label={REVIEW_STATUS[v.reviewStatus].short} />}
                  {v.isCurrent && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Vigente</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {candidate.status === 'error' && <Alert tone="error" title="No se pudo cargar la nueva versión de la propuesta" actions={<Button variant="secondary" onClick={candidate.reload}>Reintentar</Button>}>{errorDetail(candidate.error)}</Alert>}
      {candidate.status === 'ready' && candidate.data && (
        <ReviewPanel proposal={candidate.data} labels={labels} onDecided={onChanged}
          submit={(request) => reviewLearningUpdate(project.id, documentId, u.updateId, request)} />
      )}
    </div>
  )
}

function OperationCard({ op }: { op: UpdateOperation }) {
  const meta = OPERATION[op.operation]
  return (
    <li className={`space-y-3 rounded-lg border border-l-4 border-zinc-200 bg-white p-4 ${meta.border}`} data-operation={op.operation} data-element-id={op.elementId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900">
          <StatusIndicator tone={meta.tone} label={meta.label} /> {ELEMENT[op.elementType]} <span className="font-mono text-xs text-zinc-500">{op.elementId}</span>
        </p>
        <StatusIndicator tone={LEVEL[op.impactLevel].tone} label={LEVEL[op.impactLevel].label} />
      </div>
      <div className={`grid gap-3 ${op.previous && op.proposed ? 'md:grid-cols-2' : ''}`}>
        {op.previous && <ContentBox title="Contenido anterior" content={op.previous} tone={op.operation === 'remove' ? 'removed' : 'previous'} />}
        {op.proposed && <ContentBox title="Contenido propuesto" content={op.proposed} tone="proposed" />}
      </div>
      <div className="text-sm"><p className="text-xs font-medium text-zinc-500">Justificación</p><p className="break-words text-zinc-800" data-op-justification>{op.justification}</p></div>
      {op.reviewNotes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
          {op.reviewNotes.includes('pending_validation_content') && <li>Incluye información pendiente de validación; no se presenta como confirmada.</li>}
          {op.reviewNotes.includes('unresolved_issue') && <li>Involucra afirmaciones pendientes o con contradicciones sin resolver.</li>}
        </ul>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-500">Fuentes verificadas</p>
        <div className="grid gap-3 md:grid-cols-2">
          {op.references.map((r) => (
            <div key={r.sourceId} className="min-w-0 space-y-1.5" data-op-reference={r.version}>
              <p className="text-xs text-zinc-500">Versión {r.version} · {locatorLabel(r.locator)}</p>
              <p className="max-h-32 overflow-y-auto text-sm break-words whitespace-pre-line text-zinc-700">{r.text}</p>
              <ChangeSource unit={r} />
            </div>
          ))}
        </div>
      </div>
    </li>
  )
}

function ContentBox({ title, content: c, tone }: { title: string; content: ElementContent; tone: 'previous' | 'proposed' | 'removed' }) {
  const styles = { previous: 'border-zinc-200 bg-zinc-50', proposed: 'border-emerald-200 bg-emerald-50/50', removed: 'border-red-200 bg-red-50/50' }[tone]
  return (
    <div className={`min-w-0 space-y-1.5 rounded-md border p-3 text-sm ${styles}`} data-content-box={tone}>
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      {c.elementType === 'module' && <><p className="font-medium break-words text-zinc-900">{c.title}</p><p className="break-words text-zinc-700">{c.learningObjective}</p></>}
      {c.elementType === 'activity' && <><p className="font-medium break-words text-zinc-900">{c.title}</p><p className="break-words text-zinc-700">{c.instructions}</p></>}
      {c.elementType === 'lesson' && (
        <>
          <p className="font-medium break-words text-zinc-900">{c.title}</p>
          <ul className="space-y-1">
            {c.content.map((item, i) => (
              <li key={i} className="break-words text-zinc-700">
                <span className={`mr-1 rounded px-1 text-xs ${item.kind === 'pending_validation' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600'}`}>{KIND[item.kind]}</span>
                {item.text}{item.requiresReview && <span className="ml-1 text-xs text-amber-700">· requiere revisión</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {c.elementType === 'assessment' && (
        <>
          <p className="font-medium break-words text-zinc-900">{c.question}</p>
          {c.options.length > 0 && (
            <ul className="list-disc pl-5 text-zinc-700">
              {c.options.map((o) => <li key={o} className={o === c.correctAnswer ? 'font-medium text-zinc-900' : ''}>{o}{o === c.correctAnswer && ' (correcta)'}</li>)}
            </ul>
          )}
          {c.options.length === 0 && <p className="text-zinc-700">Respuesta esperada: {c.correctAnswer}</p>}
        </>
      )}
    </div>
  )
}
