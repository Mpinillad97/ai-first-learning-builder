import { useCallback } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { errorDetail } from '../../services/api'
import type { DecisionRequest } from '../../services/review.service'
import { getCompetencyProfiles, getTraining, getTrainingReviewLog, submitTrainingDecision, trainingDocumentUrl } from '../../services/trainings.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { ReviewPanel, type ReviewPanelLabels } from '../proposals/ReviewPanel'
import { TrainingDocument } from './TrainingDocument'

const loadProfiles = (signal: AbortSignal) => getCompetencyProfiles(signal)

const LABELS: ReviewPanelLabels = {
  approve: 'Aprobar formación',
  reject: 'Rechazar formación',
  approvedTitle: 'Formación aprobada',
  rejectedTitle: 'Formación rechazada',
  approvalNote: 'La aprobación queda registrada con fecha. No publica la formación ni modifica su contenido; requiere que la propuesta de origen siga aprobada.',
  conflictTitle: 'La formación cambió mientras la revisabas',
}

/** E5.5: one audience training, as a document (consult, download, print to PDF) or under review. */
export function TrainingDetail({ trainingId, mode, onMode, onBack }: {
  trainingId: string
  mode: 'documento' | 'revision'
  onMode: (mode: 'documento' | 'revision') => void
  onBack: () => void
}) {
  const load = useCallback((signal: AbortSignal) => getTraining(trainingId, signal), [trainingId])
  const training = useApiResource(trainingId, load)
  const profiles = useApiResource('competency-profiles', loadProfiles)
  const loadLog = useCallback((signal: AbortSignal) => getTrainingReviewLog(trainingId, signal), [trainingId])
  const submit = useCallback((r: DecisionRequest) => submitTrainingDecision(trainingId, r), [trainingId])
  const t = training.data

  return (
    <div className="space-y-4" data-training-detail={trainingId}>
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hidden>
        <Button variant="secondary" onClick={onBack}>← Volver al panel de la propuesta</Button>
        {t?.content && (
          <div className="flex flex-wrap gap-2">
            <div role="tablist" aria-label="Vista de la formación" className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
              {(['documento', 'revision'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
                  className={`min-h-9 rounded px-3 text-sm font-medium ${mode === m ? 'bg-accent-600 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}>
                  {m === 'documento' ? 'Documento' : 'Revisión'}
                </button>
              ))}
            </div>
            <a href={trainingDocumentUrl(trainingId, true)} download className="inline-flex min-h-10 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50" data-download-md>Descargar Markdown</a>
            <Button variant="secondary" onClick={() => window.print()}>Imprimir / PDF</Button>
          </div>
        )}
      </div>

      {training.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando formación…</p>}
      {training.status === 'error' && <Alert tone="error" title="No se pudo cargar la formación" actions={<Button variant="secondary" onClick={training.reload}>Reintentar</Button>}>{errorDetail(training.error)}</Alert>}
      {t && !t.content && <Alert tone="error" title="Esta generación falló y no tiene contenido">{t.error?.message}</Alert>}
      {t?.content && (
        <>
          {t.proposalReviewStatus !== 'approved' && (
            <Alert tone="info" title="La propuesta de origen ya no está aprobada">Esta formación se conserva para consulta, pero no puede aprobarse mientras su propuesta no esté aprobada.</Alert>
          )}
          {mode === 'revision' && (
            <div data-print-hidden>
              <ReviewPanel key={t.trainingId} proposal={{ ...t, proposalId: t.trainingId }} onDecided={training.reload} submit={submit} labels={LABELS} loadLog={loadLog} />
            </div>
          )}
          <TrainingDocument training={t} profile={profiles.data?.profiles.find((p) => p.audience === t.audience)} />
        </>
      )}
    </div>
  )
}
