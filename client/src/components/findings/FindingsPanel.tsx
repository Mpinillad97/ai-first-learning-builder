import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { ApiError, errorDetail } from '../../services/api'
import { listFindings, recordFindingDecision, type Finding, type FindingStatus } from '../../services/findings.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { CLAIM_STATUS, locatorLabel, plural, SEVERITY } from '../analysis/labels'
import { SourceReference } from '../analysis/SourceReference'
import { formatDate } from '../projects/format'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'

const TYPE: Record<Finding['type'], string> = {
  contradiction: 'Contradicción',
  documentation_gap: 'Información no documentada',
  pending_validation: 'Pendiente de validación',
  analysis_warning: 'Advertencia',
  proposal_warning: 'Requiere revisión',
}
const FINDING_STATUS: Record<FindingStatus, { label: string; tone: StatusTone }> = {
  unresolved: { label: 'No resuelto', tone: 'danger' },
  pending_validation: { label: 'Pendiente de validación', tone: 'warning' },
  resolved_with_evidence: { label: 'Resuelto con evidencia', tone: 'success' },
}
const ELEMENT: Record<string, string> = { lesson: 'Lección', activity: 'Actividad', assessment: 'Evaluación', product_knowledge: 'Conocimiento de producto' }
const TEXT_MAX = 2000
type Filter = 'open' | 'resolved' | 'all'

/**
 * E5.5: findings of an analysis (and of the selected proposal) with human decisions. The AI never decides here;
 * decisions are recorded as human decisions and never change documents, proposals or trainings.
 */
export function FindingsPanel({ analysisId, proposalId, onBack, onChanged }: { analysisId: string; proposalId: string | null; onBack?: () => void; onChanged?: () => void }) {
  const load = useCallback((signal: AbortSignal) => listFindings(analysisId, proposalId, signal), [analysisId, proposalId])
  const findings = useApiResource(`${analysisId}:${proposalId}`, load)
  const [filter, setFilter] = useState<Filter>('open')
  const data = findings.data
  const visible = (data?.findings ?? []).filter((f) => filter === 'all' || (filter === 'open' ? f.status !== 'resolved_with_evidence' : f.status === 'resolved_with_evidence'))

  return (
    <section aria-labelledby="findings-title" className="space-y-4" data-findings-panel>
      {onBack && <Button variant="secondary" onClick={onBack}>← Volver al panel de la propuesta</Button>}
      <div>
        <h2 id="findings-title" className="text-base font-semibold text-zinc-900">Hallazgos del análisis y de la propuesta</h2>
        <p className="text-sm text-zinc-600">
          Registra cómo se gestiona cada hallazgo. La IA no decide qué fuente es correcta: una decisión registrada es una decisión humana y no se convierte en un hecho confirmado sin evidencia documental.
          Las decisiones no modifican documentos, propuestas ni formaciones; para incorporar un cambio, genera una nueva propuesta o actualización y apruébala.
        </p>
      </div>
      {findings.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando hallazgos…</p>}
      {findings.status === 'error' && <Alert tone="error" title="No se pudieron cargar los hallazgos" actions={<Button variant="secondary" onClick={findings.reload}>Reintentar</Button>}>{errorDetail(findings.error)}</Alert>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2" data-findings-counts>
            <StatusIndicator tone="danger" label={`${data.counts.unresolved} no resueltos`} />
            <StatusIndicator tone="warning" label={`${data.counts.pending_validation} pendientes de validación`} />
            <StatusIndicator tone="success" label={`${data.counts.resolved_with_evidence} resueltos con evidencia`} />
            <div role="tablist" aria-label="Filtrar hallazgos" className="ml-auto inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
              {([['open', `Abiertos (${data.counts.open})`], ['resolved', `Resueltos (${data.counts.resolved_with_evidence})`], ['all', `Todos (${data.counts.total})`]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={`min-h-9 rounded px-3 text-sm font-medium ${filter === k ? 'bg-accent-600 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}>{label}</button>
              ))}
            </div>
          </div>
          {visible.length === 0 && <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-600">No hay hallazgos en esta vista.</p>}
          <ul className="space-y-3" aria-label="Hallazgos">
            {visible.map((f) => <li key={f.findingId}><FindingCard finding={f} analysisId={analysisId} onDecided={() => { findings.reload(); onChanged?.() }} /></li>)}
          </ul>
        </>
      )}
    </section>
  )
}

function FindingCard({ finding: f, analysisId, onDecided }: { finding: Finding; analysisId: string; onDecided: () => void }) {
  const [open, setOpen] = useState(false)
  const st = FINDING_STATUS[f.status]
  const bodyId = useId()
  return (
    <article className="rounded-lg border border-zinc-200 bg-white" data-finding={f.findingId} data-finding-status={f.status} data-finding-type={f.type}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0">
          <span className="block text-xs font-medium text-accent-700">{TYPE[f.type]}{f.severity && ` · severidad ${SEVERITY[f.severity]?.label.toLowerCase() ?? f.severity}`}{f.affected.length > 0 && ` · ${plural(f.affected.length, 'elemento afectado', 'elementos afectados')}`}</span>
          <span className="block text-sm font-medium break-words text-zinc-900">{f.title}</span>
          <span className="block text-sm break-words text-zinc-600">{f.description}</span>
        </span>
        <StatusIndicator tone={st.tone} label={st.label} />
      </button>
      {open && (
        <div id={bodyId} className="space-y-4 border-t border-zinc-100 px-4 py-4">
          {f.claims.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase">Información involucrada</h4>
              <ul className="mt-1 space-y-1">
                {f.claims.map((c) => <li key={c.claimId} className="text-sm text-zinc-800"><span className="font-mono text-xs text-zinc-500">{c.claimId}</span> {c.text} <StatusIndicator tone={CLAIM_STATUS[c.status]?.tone ?? 'neutral'} label={CLAIM_STATUS[c.status]?.label ?? c.status} /></li>)}
              </ul>
            </div>
          )}
          {f.references.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase">Fuentes que originan el hallazgo</h4>
              <div className="mt-1 space-y-2">{f.references.map((r, i) => <SourceReference key={`${r.sourceId}-${i}`} evidence={r} />)}</div>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase">Contenido de aprendizaje que podría requerir revisión</h4>
            {f.affected.length === 0 ? <p className="mt-1 text-sm text-zinc-500">Ningún elemento de la propuesta o de sus formaciones usa esta información.</p> : (
              <ul className="mt-1 space-y-0.5" data-affected>
                {f.affected.map((a, i) => <li key={`${a.ownerId}-${a.elementId}-${i}`} className="text-sm text-zinc-700"><span className="font-medium">{a.ownerLabel}</span> · {a.moduleTitle} · {ELEMENT[a.elementType]}: {a.title}</li>)}
              </ul>
            )}
          </div>
          <DecisionForm finding={f} analysisId={analysisId} onDecided={onDecided} />
          <History finding={f} />
        </div>
      )}
    </article>
  )
}

function DecisionForm({ finding: f, analysisId, onDecided }: { finding: Finding; analysisId: string; onDecided: () => void }) {
  const [status, setStatus] = useState<FindingStatus>(f.status === 'unresolved' ? 'pending_validation' : f.status)
  const [explanation, setExplanation] = useState('')
  const [question, setQuestion] = useState('')
  const [evidenceChoice, setEvidenceChoice] = useState(f.references.length ? '0' : 'other')
  const [sourceId, setSourceId] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; title: string; detail?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  const id = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy.current) return
    const chosen = evidenceChoice === 'other' ? { sourceId: sourceId.trim(), quote: quote.trim() } : { sourceId: f.references[Number(evidenceChoice)]!.sourceId, quote: (quote.trim() || f.references[Number(evidenceChoice)]!.quote) }
    if (status === 'resolved_with_evidence' && (!explanation.trim() || !chosen.sourceId || chosen.quote.length < 3)) { setError('Una resolución requiere una explicación y una referencia verificable (fuente y texto citado).'); return }
    if (status === 'pending_validation' && !question.trim()) { setError('Indica qué información falta o qué pregunta debe resolverse.'); return }
    setError(null)
    busy.current = true
    setSubmitting(true)
    try {
      await recordFindingDecision(analysisId, f.findingId, {
        status,
        ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
        ...(status === 'pending_validation' ? { question: question.trim() } : {}),
        ...(status === 'resolved_with_evidence' ? { evidence: chosen } : {}),
        basedOnDecisionId: f.latestDecision?.decisionId ?? null,
      })
      setFeedback({ tone: 'success', title: 'Decisión registrada', detail: 'Quedó en el historial del hallazgo.' })
      setExplanation(''); setQuestion(''); setQuote('')
      onDecided()
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409
      setFeedback({ tone: 'error', title: conflict ? 'El hallazgo cambió mientras decidías' : 'No se pudo registrar la decisión', detail: conflict ? `${errorDetail(e)} Se recargó su estado.` : errorDetail(e) })
      if (conflict) onDecided()
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3" aria-label={`Registrar decisión sobre ${f.title}`} data-finding-form>
      <fieldset>
        <legend className="text-sm font-medium text-zinc-900">Registrar decisión</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm text-zinc-800">
              <input type="radio" name={`${id}-status`} value={s} checked={status === s} onChange={() => { setStatus(s); setError(null) }} disabled={submitting} />
              {FINDING_STATUS[s].label}
            </label>
          ))}
        </div>
      </fieldset>
      {status === 'pending_validation' && (
        <div>
          <label htmlFor={`${id}-q`} className="text-sm font-medium text-zinc-900">Información que falta o pregunta para Producto <span className="text-red-600">*</span></label>
          <textarea id={`${id}-q`} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={TEXT_MAX} rows={2} disabled={submitting} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-e`} className="text-sm font-medium text-zinc-900">
          {status === 'resolved_with_evidence' ? <>Cómo se resolvió <span className="text-red-600">*</span></> : <>Explicación <span className="font-normal text-zinc-500">(opcional)</span></>}
        </label>
        <textarea id={`${id}-e`} value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={TEXT_MAX} rows={2} disabled={submitting} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
      </div>
      {status === 'resolved_with_evidence' && (
        <div className="space-y-2">
          <label htmlFor={`${id}-src`} className="text-sm font-medium text-zinc-900">Fuente autorizada que respalda la resolución <span className="text-red-600">*</span></label>
          <select id={`${id}-src`} value={evidenceChoice} onChange={(e) => setEvidenceChoice(e.target.value)} disabled={submitting} className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
            {f.references.map((r, i) => <option key={i} value={String(i)}>{locatorLabel(r.locator)} — «{r.quote.slice(0, 80)}{r.quote.length > 80 ? '…' : ''}»</option>)}
            <option value="other">Otra fuente (indicar id de fuente y texto)</option>
          </select>
          {evidenceChoice === 'other' && (
            <input aria-label="Id de la fuente" placeholder="documentId:ext_…:paragraph:N" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={submitting} className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
          )}
          <textarea aria-label="Texto citado" placeholder={evidenceChoice === 'other' ? 'Texto exacto citado de la fuente' : 'Texto exacto citado (opcional: por defecto, el pasaje completo)'} value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} disabled={submitting}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
          <p className="text-xs text-zinc-500">El servidor verifica que el texto aparezca literalmente en la fuente.</p>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
      {feedback && <Alert tone={feedback.tone} title={feedback.title}>{feedback.detail}</Alert>}
      <Button type="submit" disabled={submitting} aria-busy={submitting}>{submitting ? 'Registrando…' : 'Registrar decisión'}</Button>
    </form>
  )
}

function History({ finding: f }: { finding: Finding }) {
  if (f.decisions.length === 0) return <p className="text-xs text-zinc-500">Sin decisiones registradas: el hallazgo sigue abierto.</p>
  return (
    <div>
      <h4 className="text-xs font-semibold text-zinc-500 uppercase">Historial de decisiones</h4>
      <ol className="mt-1 divide-y divide-zinc-100 rounded-md border border-zinc-200" aria-label="Historial de decisiones">
        {f.decisions.map((d) => (
          <li key={d.decisionId} className="space-y-1 px-3 py-2 text-sm" data-decision={d.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusIndicator tone={FINDING_STATUS[d.status].tone} label={FINDING_STATUS[d.status].label} />
              <time dateTime={d.decidedAt} className="text-xs text-zinc-500">{formatDate(d.decidedAt)}</time>
            </div>
            <p className="text-xs text-zinc-500">Decisión humana registrada</p>
            {d.question && <p className="text-zinc-800"><span className="text-xs text-zinc-500">Pregunta / falta: </span>{d.question}</p>}
            {d.explanation && <p className="text-zinc-800"><span className="text-xs text-zinc-500">Explicación: </span>{d.explanation}</p>}
            {d.evidence && <p className="text-zinc-700"><span className="text-xs text-zinc-500">Evidencia documental ({locatorLabel(d.evidence.locator)}): </span>«{d.evidence.quote}»</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}
