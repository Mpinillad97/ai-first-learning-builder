import { useCallback, useEffect, useRef, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { ApiError, errorDetail, isUnreachable } from '../../services/api'
import { listFindings } from '../../services/findings.service'
import type { LearningProposal, ProposalSummary } from '../../services/proposal.service'
import { generateTrainings, getProposalTrainings, type Audience, type AudienceTrainingState } from '../../services/trainings.service'
import { SECTIONS } from '../../navigation'
import { Alert } from '../Alert'
import { Button, ButtonLink } from '../Button'
import { plural, shortId } from '../analysis/labels'
import { formatDate } from '../projects/format'
import { REVIEW_STATUS } from '../proposals/reviewLabels'
import { StatusIndicator } from '../StatusIndicator'
import { AUDIENCE_DESCRIPTION, GENERATION_STATE } from './trainingLabels'

export type GeneratorView = { vista: 'propuesta' | 'hallazgos' } | { vista: 'formacion'; formacion: string; modo: 'documento' | 'revision' }

interface DashboardProps {
  proposal: LearningProposal
  summary: ProposalSummary | undefined
  projectId: string
  documentId: string
  onOpen: (view: GeneratorView) => void
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold text-zinc-900 tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * E5.5: management panel of one proposal: a summary (no module/lesson listing), its findings and review status,
 * and one card per audience training. Details open in the document / review / findings views.
 */
export function ProposalDashboard({ proposal, summary, projectId, documentId, onOpen }: DashboardProps) {
  const id = proposal.proposalId
  const loadTrainings = useCallback((signal: AbortSignal) => getProposalTrainings(id, signal), [id])
  const trainings = useApiResource(id, loadTrainings)
  const loadFindings = useCallback((signal: AbortSignal) => listFindings(proposal.analysisId, id, signal), [proposal.analysisId, id])
  const findings = useApiResource(id, loadFindings)
  const [busy, setBusy] = useState<Audience[]>([])
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; title: string; detail: string } | null>(null)
  const running = useRef(false)

  // Poll while a generation (e.g. the automatic one after approval) is running.
  const generating = trainings.data?.audiences.some((a) => a.state === 'generating') ?? false
  const { reload } = trainings
  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(reload, 2000)
    return () => window.clearInterval(timer)
  }, [generating, reload])

  const generate = async (audiences: Audience[]) => {
    if (running.current) return
    running.current = true
    setBusy(audiences)
    setFeedback(null)
    try {
      const result = await generateTrainings(id, audiences)
      const failedOnes = result.audiences.filter((a) => audiences.includes(a.audience) && a.lastAttempt?.status === 'failed' && a.state !== 'generated')
      setFeedback(failedOnes.length
        ? { tone: 'error', title: `No se pudo generar: ${failedOnes.map((a) => a.label).join(', ')}`, detail: 'El intento fallido quedó registrado. Las formaciones generadas correctamente se conservan; puedes reintentar solo la fallida.' }
        : { tone: 'success', title: 'Formación generada como borrador', detail: 'Requiere revisión y aprobación humana.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        title: isUnreachable(error) ? 'No se pudo conectar con el servidor' : error instanceof ApiError && error.status === 503 ? 'La generación con IA no está configurada en el servidor' : 'No se pudo generar la formación',
        detail: errorDetail(error),
      })
    } finally {
      running.current = false
      setBusy([])
      trainings.reload()
      findings.reload()
    }
  }

  const c = proposal.content
  const modules = c?.modules ?? []
  const reviewStatus = summary?.reviewStatus ?? trainings.data?.proposalReviewStatus
  const st = reviewStatus ? REVIEW_STATUS[reviewStatus] : null
  const approved = reviewStatus === 'approved'
  const counts = findings.data?.counts
  const reviewUrl = `${SECTIONS.review.path}?proyecto=${projectId}&documento=${documentId}&analisis=${proposal.analysisId}&propuesta=${id}`
  const missing = trainings.data?.audiences.filter((a) => a.canGenerate && a.state === 'not_generated').map((a) => a.audience) ?? []

  return (
    <div className="space-y-6" data-proposal-dashboard={id}>
      <section aria-labelledby="dash-title" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Propuesta v{proposal.lineage?.proposalVersion ?? 1} · <span className="font-mono normal-case" title={id}>{shortId(id)}</span></p>
            <h2 id="dash-title" className="text-lg font-semibold break-words text-zinc-900">{c?.title}</h2>
            <p className="text-xs text-zinc-500">Generada {formatDate(proposal.createdAt)} · {proposal.model}</p>
          </div>
          {st && <StatusIndicator tone={st.tone} label={st.label} live />}
        </div>
        {c && <p className="text-sm leading-6 text-zinc-700" data-proposal-summary>{c.learningObjective}</p>}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Resumen del contenido">
          <Stat label="Módulos" value={modules.length} />
          <Stat label="Lecciones" value={modules.reduce((n, m) => n + m.lessons.length, 0)} />
          <Stat label="Actividades" value={modules.reduce((n, m) => n + m.activities.length, 0)} />
          <Stat label="Evaluaciones" value={modules.reduce((n, m) => n + m.assessments.length, 0)} />
          <Stat label="Advertencias" value={proposal.warnings.length} />
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm" data-findings-indicator>
          {findings.status === 'ready' && counts ? (
            <span className="text-zinc-800">
              <strong>{plural(counts.open, 'hallazgo pendiente', 'hallazgos pendientes')}</strong>
              {' '}({counts.unresolved} sin resolver · {counts.pending_validation} pendientes de validación · {counts.resolved_with_evidence} resueltos con evidencia)
            </span>
          ) : findings.status === 'error' ? <span className="text-red-700">No se pudieron cargar los hallazgos.</span> : <span className="text-zinc-500">Cargando hallazgos…</span>}
          <Button variant="secondary" onClick={() => onOpen({ vista: 'hallazgos' })}>Gestionar hallazgos</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onOpen({ vista: 'propuesta' })}>Ver propuesta completa</Button>
          <ButtonLink to={reviewUrl}>{approved ? 'Ver revisión de la propuesta' : 'Ir a revisión y aprobación'}</ButtonLink>
        </div>
      </section>

      <section aria-labelledby="trainings-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="trainings-title" className="text-base font-semibold text-zinc-900">Formaciones por audiencia</h2>
            <p className="text-sm text-zinc-600">Cada propuesta aprobada produce una formación para Sales y otra para Customer Experience, con revisión humana independiente.</p>
          </div>
          {missing.length === 2 && <Button onClick={() => generate(missing)} disabled={busy.length > 0}>{busy.length ? 'Generando…' : 'Generar ambas formaciones'}</Button>}
        </div>
        {!approved && reviewStatus && (
          <Alert tone="info" title="Las formaciones se generan al aprobar la propuesta">
            Cuando la propuesta se aprueba en Revisión y aprobación, se generan automáticamente las formaciones de Sales y Customer Experience como borradores.
          </Alert>
        )}
        {trainings.data && !trainings.data.aiConfigured && approved && missing.length > 0 && (
          <Alert tone="error" title="La generación con IA no está configurada en el servidor">Configura OPENAI_API_KEY en el backend para generar las formaciones.</Alert>
        )}
        {feedback && <Alert tone={feedback.tone} title={feedback.title}>{feedback.detail}</Alert>}
        {trainings.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando formaciones…</p>}
        {trainings.status === 'error' && <Alert tone="error" title="No se pudieron cargar las formaciones" actions={<Button variant="secondary" onClick={trainings.reload}>Reintentar</Button>}>{errorDetail(trainings.error)}</Alert>}
        {trainings.data && (
          <div className="grid gap-4 md:grid-cols-2">
            {trainings.data.audiences.map((a) => (
              <TrainingCard key={a.audience} state={a} busy={busy.includes(a.audience)} disabled={busy.length > 0} onGenerate={() => generate([a.audience])}
                onOpen={(modo) => a.current && onOpen({ vista: 'formacion', formacion: a.current.trainingId, modo })} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function TrainingCard({ state: a, busy, disabled, onGenerate, onOpen }: {
  state: AudienceTrainingState
  busy: boolean
  disabled: boolean
  onGenerate: () => void
  onOpen: (modo: 'documento' | 'revision') => void
}) {
  const gen = GENERATION_STATE[busy ? 'generating' : a.state]
  const t = a.current
  const failedLast = a.lastAttempt?.status === 'failed' ? a.lastAttempt : null
  const rs = t ? REVIEW_STATUS[t.reviewStatus] : null
  const accent = a.audience === 'sales' ? 'border-t-sky-500' : 'border-t-emerald-500'
  return (
    <article className={`flex min-w-0 flex-col gap-3 rounded-lg border border-t-4 border-zinc-200 bg-white p-4 ${accent}`} aria-labelledby={`card-${a.audience}`} data-training-card={a.audience} data-state={busy ? 'generating' : a.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`card-${a.audience}`} className="text-base font-semibold text-zinc-900">{a.label}</h3>
          <p className="text-xs text-zinc-500">{AUDIENCE_DESCRIPTION[a.audience]}</p>
        </div>
        <StatusIndicator tone={gen.tone} label={gen.label} live />
      </div>

      {t ? (
        <>
          <div className="min-w-0">
            <p className="text-sm font-medium break-words text-zinc-900" data-training-title>{t.title}</p>
            <p className="mt-1 line-clamp-3 text-sm text-zinc-600">{t.learningObjective}</p>
          </div>
          <p className="text-xs text-zinc-600">
            {plural(t.counts.competencies, 'competencia', 'competencias')} · {plural(t.counts.modules, 'módulo', 'módulos')} · {plural(t.counts.lessons, 'lección', 'lecciones')} · {plural(t.counts.activities, 'actividad', 'actividades')} · {plural(t.counts.assessments, 'evaluación', 'evaluaciones')}
          </p>
          <p className="text-xs text-amber-800" data-training-warnings>
            {plural(t.counts.warnings, 'advertencia pendiente', 'advertencias pendientes')} · {plural(t.counts.pendingItems, 'contenido por validar', 'contenidos por validar')}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {rs && <StatusIndicator tone={rs.tone} label={rs.short} />}
            <span>v{t.trainingVersion} · {formatDate(t.createdAt)}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-600">{a.state === 'generating' || busy ? 'La IA está generando esta formación. Puede tardar varios minutos.' : a.state === 'failed' ? 'La última generación falló; no hay contenido.' : 'Aún no se ha generado.'}</p>
      )}
      {failedLast && !busy && a.state !== 'generating' && (
        <p role="note" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" data-training-error>Último intento fallido ({formatDate(failedLast.createdAt)}): {failedLast.error?.message}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {t && <Button variant="secondary" onClick={() => onOpen('documento')}>Ver documento</Button>}
        {t && <Button variant="secondary" onClick={() => onOpen('revision')}>Revisar</Button>}
        {a.canGenerate && (
          <Button onClick={onGenerate} disabled={disabled} aria-busy={busy}>
            {busy ? 'Generando…' : a.state === 'failed' ? 'Reintentar generación' : t ? 'Generar nueva versión' : 'Generar formación'}
          </Button>
        )}
      </div>
    </article>
  )
}
