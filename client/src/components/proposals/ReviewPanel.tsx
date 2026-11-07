import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { ApiError, errorDetail, isUnreachable } from '../../services/api'
import type { LearningProposal } from '../../services/proposal.service'
import { getReviewLog, submitDecision, type DecisionRequest, type ReviewDecision } from '../../services/review.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { formatDate } from '../projects/format'
import { plural } from '../analysis/labels'
import { StatusIndicator } from '../StatusIndicator'
import { REVIEW_STATUS } from './reviewLabels'

const REASON_MAX = 2000

function counts(proposal: LearningProposal) {
  const modules = proposal.content?.modules ?? []
  const items = modules.flatMap((m) => m.lessons.flatMap((l) => l.content))
  return {
    warnings: proposal.warnings.length,
    pending: items.filter((c) => c.kind === 'pending_validation').length,
    review: items.filter((c) => c.requiresReview).length
      + modules.reduce((n, m) => n + m.activities.filter((a) => a.requiresReview).length + m.assessments.filter((a) => a.requiresReview).length, 0),
    rejected: proposal.rejectedItems.length,
  }
}

export interface ReviewPanelLabels {
  approve: string
  reject: string
  approvedTitle: string
  rejectedTitle: string
  approvalNote: string
  conflictTitle: string
}

const DEFAULT_LABELS: ReviewPanelLabels = {
  approve: 'Aprobar propuesta',
  reject: 'Rechazar propuesta',
  approvedTitle: 'Propuesta aprobada',
  rejectedTitle: 'Propuesta rechazada',
  approvalNote: 'La aprobación queda registrada con fecha. No publica la propuesta ni modifica su contenido.',
  conflictTitle: 'La propuesta cambió mientras la revisabas',
}

/**
 * Human decision workflow for one proposal. Decisions are only sent on an explicit, confirmed action.
 * E5.3: `submit` and `labels` let a learning update reuse it (its decisions go through the update endpoint).
 */
export function ReviewPanel({ proposal, onDecided, submit: send = (r) => submitDecision(proposal.proposalId, r), labels = DEFAULT_LABELS }: {
  proposal: LearningProposal
  onDecided: () => void
  submit?: (request: DecisionRequest) => Promise<unknown>
  labels?: ReviewPanelLabels
}) {
  const load = useCallback((signal: AbortSignal) => getReviewLog(proposal.proposalId, signal), [proposal.proposalId])
  const log = useApiResource(proposal.proposalId, load)
  const [mode, setMode] = useState<ReviewDecision | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; title: string; detail?: string } | null>(null)
  const busy = useRef(false)
  const reasonId = useId()

  const c = counts(proposal)
  const needsAck = c.warnings > 0 || c.pending > 0
  const reviewable = proposal.status === 'draft' && proposal.validationErrors.length === 0
  const status = log.status === 'ready' && log.data ? log.data.reviewStatus : null
  const latest = log.data?.reviews[0] ?? null

  const open = (decision: ReviewDecision) => {
    setMode(decision)
    setFeedback(null)
    setAcknowledged(false)
    setComment('')
    setReason('')
    setReasonError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy.current || !mode || log.status !== 'ready') return
    if (mode === 'rejected' && !reason.trim()) {
      setReasonError('Indica el motivo del rechazo.')
      document.getElementById(reasonId)?.focus()
      return
    }
    if (mode === 'approved' && needsAck && !acknowledged) return
    busy.current = true
    setSubmitting(true)
    try {
      await send({
        decision: mode,
        ...(mode === 'rejected' ? { reason: reason.trim() } : { acknowledgedWarnings: acknowledged }),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        basedOnReviewId: latest?.reviewId ?? null,
      })
      setFeedback({ tone: 'success', title: mode === 'approved' ? labels.approvedTitle : labels.rejectedTitle, detail: 'La decisión quedó registrada en el historial de revisión.' })
      setMode(null)
      onDecided()
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      setFeedback({
        tone: 'error',
        title: conflict ? labels.conflictTitle : isUnreachable(error) ? 'No se pudo conectar con el servidor' : 'No se pudo registrar la decisión',
        detail: conflict ? `${errorDetail(error)} Se recargó su estado actual; revísalo antes de decidir.` : errorDetail(error),
      })
      if (conflict) { setMode(null); onDecided() }
    } finally {
      busy.current = false
      setSubmitting(false)
      log.reload()
    }
  }

  return (
    <section aria-labelledby="review-title" className="space-y-4 rounded-lg border-2 border-accent-100 bg-white p-4 sm:p-6" data-review-panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-title" className="text-base font-semibold text-zinc-900">Revisión humana</h2>
        {log.status === 'loading' && <span role="status" className="text-xs text-zinc-500">Cargando historial de revisión…</span>}
        {status && <StatusIndicator tone={REVIEW_STATUS[status].tone} label={REVIEW_STATUS[status].short} live />}
      </div>

      {!reviewable ? (
        <Alert tone="error" title="Esta propuesta no puede aprobarse ni rechazarse">
          La generación falló con errores de validación críticos y no contiene contenido revisable. Genera una nueva propuesta desde el Generador de aprendizaje.
        </Alert>
      ) : (
        <>
          <div className="rounded-md border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm" data-review-checklist>
            <p className="font-medium text-zinc-900">Antes de decidir, revisa:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-700">
              <li><a className="underline" href="#warnings-title">{plural(c.warnings, 'advertencia sin resolver', 'advertencias sin resolver')}</a></li>
              <li>{plural(c.pending, 'contenido pendiente de validación', 'contenidos pendientes de validación')}</li>
              <li>{plural(c.review, 'elemento marcado «Requiere revisión»', 'elementos marcados «Requiere revisión»')}</li>
              <li>{plural(c.rejected, 'elemento descartado por falta de respaldo', 'elementos descartados por falta de respaldo')}</li>
            </ul>
          </div>

          {log.status === 'error' && (
            <Alert tone="error" title="No se pudo cargar el historial de revisión" actions={<Button variant="secondary" onClick={log.reload}>Reintentar</Button>}>
              {errorDetail(log.error)} No se pueden registrar decisiones hasta conocer el estado actual.
            </Alert>
          )}

          {feedback && <Alert tone={feedback.tone} title={feedback.title}>{feedback.detail}</Alert>}

          {log.status === 'ready' && !mode && (
            <div className="flex flex-wrap gap-2">
              {status !== 'approved' && <Button onClick={() => open('approved')}>{status === 'rejected' ? 'Aprobar (cambiar decisión)' : labels.approve}</Button>}
              {status !== 'rejected' && <Button variant="secondary" onClick={() => open('rejected')}>{status === 'approved' ? 'Rechazar (revocar aprobación)' : labels.reject}</Button>}
            </div>
          )}

          {mode && (
            <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-zinc-200 p-4" aria-label={mode === 'approved' ? 'Confirmar aprobación' : 'Confirmar rechazo'} data-decision-form={mode}>
              {mode === 'approved' ? (
                <>
                  <p className="text-sm text-zinc-700">{labels.approvalNote}</p>
                  {needsAck && (
                    <label className="flex items-start gap-2 text-sm text-zinc-800">
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} disabled={submitting} className="mt-0.5 size-4 shrink-0" />
                      <span>He revisado las {plural(c.warnings, 'advertencia', 'advertencias')} y el contenido pendiente de validación ({c.pending}).</span>
                    </label>
                  )}
                </>
              ) : (
                <div>
                  <label htmlFor={reasonId} className="text-sm font-medium text-zinc-900">Motivo del rechazo <span className="text-red-600">*</span></label>
                  <textarea id={reasonId} value={reason} maxLength={REASON_MAX} rows={3} disabled={submitting}
                    onChange={(e) => { setReason(e.target.value); if (reasonError && e.target.value.trim()) setReasonError(null) }}
                    aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? `${reasonId}-error` : undefined}
                    className={`mt-1.5 block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm ${reasonError ? 'border-red-400' : 'border-zinc-300'}`} />
                  {reasonError && <p id={`${reasonId}-error`} className="mt-1 text-xs font-medium text-red-700">{reasonError}</p>}
                </div>
              )}
              <div>
                <label htmlFor={`${reasonId}-comment`} className="text-sm font-medium text-zinc-900">Comentario <span className="font-normal text-zinc-500">(opcional)</span></label>
                <textarea id={`${reasonId}-comment`} value={comment} maxLength={REASON_MAX} rows={2} disabled={submitting} onChange={(e) => setComment(e.target.value)}
                  className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={submitting || (mode === 'approved' && needsAck && !acknowledged)} aria-busy={submitting}>
                  {submitting ? 'Registrando decisión…' : mode === 'approved' ? 'Confirmar aprobación' : 'Confirmar rechazo'}
                </Button>
                <Button variant="secondary" onClick={() => setMode(null)} disabled={submitting}>Cancelar</Button>
              </div>
            </form>
          )}
        </>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900">Historial de revisión</h3>
        {log.status === 'ready' && log.data && log.data.reviews.length === 0 && <p className="text-sm text-zinc-500">Aún no hay decisiones registradas.</p>}
        {log.data && log.data.reviews.length > 0 && (
          <ol className="divide-y divide-zinc-200 overflow-hidden rounded-md border border-zinc-200" aria-label="Historial de revisión">
            {log.data.reviews.map((r) => (
              <li key={r.reviewId} className="space-y-1 px-4 py-3 text-sm" data-review={r.decision}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusIndicator tone={r.decision === 'approved' ? 'success' : 'danger'} label={r.decision === 'approved' ? 'Aprobada' : 'Rechazada'} />
                  <time dateTime={r.decidedAt} className="text-xs text-zinc-500">{formatDate(r.decidedAt)}</time>
                </div>
                {r.reason && <p className="break-words text-zinc-800"><span className="text-xs text-zinc-500">Motivo: </span>{r.reason}</p>}
                {r.comment && <p className="break-words text-zinc-700"><span className="text-xs text-zinc-500">Comentario: </span>{r.comment}</p>}
                <p className="text-xs text-zinc-500">
                  Al decidir: {plural(r.warningCount, 'advertencia', 'advertencias')}, {plural(r.pendingValidationItemCount, 'contenido pendiente', 'contenidos pendientes')}
                  {r.decision === 'approved' && (r.warningsAcknowledged ? ' · revisados y reconocidos' : '')}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
