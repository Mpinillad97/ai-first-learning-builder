import { useId, useState, type ReactNode } from 'react'
import type { LearningProposal, ProposalAttribute, ProposalSourceReference } from '../../services/proposal.service'
import type { ReviewStatus } from '../../services/review.service'
import { REVIEW_STATUS } from './reviewLabels'
import { Alert } from '../Alert'
import { SourceReference } from '../analysis/SourceReference'
import { plural, shortId } from '../analysis/labels'
import { formatDate } from '../projects/format'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'

const KIND: Record<string, { label: string; tone: StatusTone }> = {
  fact: { label: 'Hecho confirmado', tone: 'success' },
  guidance: { label: 'Guía pedagógica', tone: 'neutral' },
  pending_validation: { label: 'Pendiente de validación', tone: 'warning' },
}
const ASSESSMENT: Record<string, string> = {
  multiple_choice: 'Opción múltiple', true_false: 'Verdadero o falso', open_question: 'Pregunta abierta', exercise: 'Ejercicio',
}
const WARNING: Record<string, string> = {
  contradiction: 'Contradicción', documentation_gap: 'Vacío de documentación', pending_validation: 'Pendiente de validación',
  analysis_warning: 'Análisis', proposal: 'Propuesta',
}

const ReviewFlag = () => <StatusIndicator tone="warning" label="Requiere revisión" />

/** Expandable verified sources for the claims an element relies on (resolved via GET /api/sources/:id). */
export function Evidence({ claimIds, references }: { claimIds: string[]; references: ProposalSourceReference[] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const refs = references.filter((r) => claimIds.includes(r.claimId))
  if (claimIds.length === 0) return null
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="inline-flex min-h-8 items-center rounded-md px-1.5 text-xs font-medium text-accent-700 hover:bg-accent-50" data-evidence-toggle>
        {open ? 'Ocultar evidencia' : `Ver evidencia (${claimIds.join(', ')})`}
      </button>
      {open && (
        <div id={panelId} className="mt-1.5 space-y-2" data-evidence>
          {refs.length === 0
            ? <p role="alert" className="text-xs font-medium text-red-700">No hay referencias de origen para estas afirmaciones.</p>
            : refs.map((r, i) => <SourceReference key={`${r.sourceId}-${r.startOffset}-${i}`} evidence={r} />)}
        </div>
      )}
    </div>
  )
}

function Attribute({ label, attribute, references }: { label: string; attribute: ProposalAttribute; references: ProposalSourceReference[] }) {
  return (
    <div className="min-w-0" data-attribute={label}>
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-0.5 space-y-1">
        <p className="text-sm break-words text-zinc-800">{attribute.value}</p>
        <StatusIndicator tone={attribute.status === 'supported' ? 'success' : 'warning'}
          label={attribute.status === 'supported' ? 'Respaldado por la documentación' : 'Pendiente de validación'} />
        <Evidence claimIds={attribute.claimIds} references={references} />
      </dd>
    </div>
  )
}

function Block({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <div className="space-y-2" id={id}>
      <h5 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h5>
      {children}
    </div>
  )
}

/** The persisted proposal as returned by GET /api/proposals/:id. Nothing is computed or invented by the UI. */
export function ProposalView({ proposal, reviewStatus }: { proposal: LearningProposal; reviewStatus?: ReviewStatus | 'unavailable' }) {
  const status = REVIEW_STATUS[reviewStatus ?? (proposal.status === 'draft' ? 'pending_review' : 'not_reviewable')]
  const { content } = proposal
  const refs = proposal.sourceReferences
  const reviewCount = content
    ? content.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.content.filter((c) => c.requiresReview).length, 0)
      + m.activities.filter((a) => a.requiresReview).length + m.assessments.filter((a) => a.requiresReview).length, 0)
    : 0

  return (
    <article aria-labelledby="proposal-title" className="min-w-0 space-y-8" data-proposal={proposal.proposalId}>
      <header className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Propuesta de aprendizaje</p>
            <h2 id="proposal-title" tabIndex={-1} className="mt-1 text-lg font-semibold break-words text-zinc-900 outline-none">
              {content ? content.title : 'Intento de generación fallido'}
            </h2>
          </div>
          <StatusIndicator tone={status.tone} label={status.label} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-zinc-500">Creada</dt><dd className="text-zinc-800"><time dateTime={proposal.createdAt}>{formatDate(proposal.createdAt)}</time></dd></div>
          <div><dt className="text-xs text-zinc-500">Propuesta</dt><dd className="font-mono text-xs text-zinc-700" title={proposal.proposalId}>{shortId(proposal.proposalId)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Modelo</dt><dd className="text-xs text-zinc-700">{proposal.model}</dd></div>
        </dl>
        {content && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-zinc-200 pt-3 text-sm text-zinc-700" aria-label="Resumen de la propuesta">
            {[plural(content.modules.length, 'módulo', 'módulos'),
              plural(content.modules.reduce((n, m) => n + m.lessons.length, 0), 'lección', 'lecciones'),
              plural(content.modules.reduce((n, m) => n + m.activities.length, 0), 'actividad', 'actividades'),
              plural(content.modules.reduce((n, m) => n + m.assessments.length, 0), 'evaluación', 'evaluaciones'),
              plural(reviewCount, 'elemento requiere revisión', 'elementos requieren revisión'),
              plural(proposal.warnings.length, 'advertencia', 'advertencias')].map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
      </header>

      {proposal.status === 'failed' && (
        <Alert tone="error" title="La propuesta no pudo generarse">
          {proposal.error?.message} No se generó contenido en este intento.
        </Alert>
      )}
      {proposal.validationErrors.length > 0 && (
        <section aria-labelledby="validation-title" className="space-y-2 rounded-lg border border-red-200 bg-white p-4" data-validation-errors>
          <h3 id="validation-title" className="text-sm font-semibold text-red-800">Errores de validación ({proposal.validationErrors.length})</h3>
          <p className="text-xs text-zinc-600">El contenido generado no superó la validación contra el análisis, por lo que no se guardó como propuesta.</p>
          <ul className="list-disc space-y-1 pl-5 text-xs break-words text-red-800">{proposal.validationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </section>
      )}

      {content && (
        <>
          <section aria-labelledby="overview-title" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
            <h3 id="overview-title" className="text-sm font-semibold text-zinc-900">Objetivo y contexto</h3>
            <div>
              <p className="text-xs font-medium text-zinc-500">Objetivo de aprendizaje</p>
              <p className="mt-0.5 text-sm break-words text-zinc-800">{content.learningObjective}</p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Attribute label="Audiencia" attribute={content.audience} references={refs} />
              <Attribute label="Requisitos previos" attribute={content.prerequisites} references={refs} />
              <Attribute label="Duración estimada" attribute={content.estimatedDuration} references={refs} />
            </dl>
          </section>

          <section aria-labelledby="warnings-title" className="space-y-3">
            <h3 id="warnings-title" className="text-sm font-semibold text-zinc-900">Advertencias y temas sin resolver ({proposal.warnings.length})</h3>
            {proposal.warnings.length === 0 ? <p className="text-sm text-zinc-500">Sin advertencias.</p> : (
              <ul className="divide-y divide-amber-200 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/40" aria-label="Advertencias">
                {proposal.warnings.map((w) => (
                  <li key={w.warningId} className="space-y-1 px-4 py-3" data-warning={w.type}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-xs font-medium text-amber-800">{WARNING[w.type] ?? w.type}</span>
                      <ReviewFlag />
                    </div>
                    <p className="text-sm break-words text-zinc-800">{w.message}</p>
                    {[...w.relatedClaimIds, ...w.relatedContradictionIds, ...w.relatedGapIds].length > 0 && (
                      <p className="text-xs text-zinc-500">Relacionado: {[...w.relatedClaimIds, ...w.relatedContradictionIds, ...w.relatedGapIds].join(', ')}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="modules-title" className="space-y-4">
            <h3 id="modules-title" className="text-sm font-semibold text-zinc-900">Módulos ({content.modules.length})</h3>
            <ol className="space-y-4">
              {content.modules.map((m) => (
                <li key={m.moduleId} className="space-y-5 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6" data-module={m.moduleId}>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500">Módulo {m.order}</p>
                    <h4 className="text-base font-semibold break-words text-zinc-900">{m.title}</h4>
                    <p className="text-sm break-words text-zinc-700">{m.learningObjective}</p>
                    <dl><Attribute label="Duración sugerida" attribute={m.suggestedDuration} references={refs} /></dl>
                  </div>

                  <Block title="Lecciones">
                    <ol className="space-y-3">
                      {m.lessons.map((l) => (
                        <li key={l.lessonId} className="rounded-md border border-zinc-200 p-3" data-lesson={l.lessonId}>
                          <p className="text-sm font-medium text-zinc-900">{l.order}. {l.title}</p>
                          <ul className="mt-2 space-y-3">
                            {l.content.map((c, i) => (
                              <li key={i} className="min-w-0" data-content-kind={c.kind} data-review={c.requiresReview}>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <StatusIndicator tone={KIND[c.kind]?.tone ?? 'neutral'} label={KIND[c.kind]?.label ?? c.kind} />
                                  {c.requiresReview && <ReviewFlag />}
                                </div>
                                <p className="mt-1 text-sm break-words text-zinc-800">{c.text}</p>
                                <Evidence claimIds={c.claimIds} references={refs} />
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  </Block>

                  <Block title="Actividades">
                    {m.activities.length === 0 ? <p className="text-sm text-zinc-500">Sin actividades.</p> : (
                      <ul className="space-y-3">
                        {m.activities.map((a) => (
                          <li key={a.activityId} className="rounded-md border border-zinc-200 p-3" data-activity={a.activityId} data-review={a.requiresReview}>
                            <div className="flex flex-wrap items-center gap-x-3"><p className="text-sm font-medium text-zinc-900">{a.title}</p>{a.requiresReview && <ReviewFlag />}</div>
                            <p className="mt-1 text-sm break-words text-zinc-700">{a.instructions}</p>
                            <Evidence claimIds={a.claimIds} references={refs} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Block>

                  <Block title="Evaluación">
                    {m.assessments.length === 0 ? <p className="text-sm text-zinc-500">Sin evaluaciones.</p> : (
                      <ul className="space-y-3">
                        {m.assessments.map((a) => (
                          <li key={a.assessmentId} className="rounded-md border border-zinc-200 p-3" data-assessment={a.assessmentId} data-review={a.requiresReview}>
                            <div className="flex flex-wrap items-center gap-x-3"><span className="text-xs font-medium text-zinc-500">{ASSESSMENT[a.type] ?? a.type}</span>{a.requiresReview && <ReviewFlag />}</div>
                            <p className="mt-1 text-sm font-medium break-words text-zinc-900">{a.question}</p>
                            {a.options.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-sm text-zinc-700">
                                {a.options.map((o) => (
                                  <li key={o} className={o === a.correctAnswer ? 'font-medium text-emerald-800' : ''}>
                                    {o === a.correctAnswer ? '✓ ' : '· '}{o}{o === a.correctAnswer && <span className="sr-only"> (respuesta correcta)</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {a.options.length === 0 && <p className="mt-1 text-sm break-words text-zinc-700"><span className="text-xs text-zinc-500">Respuesta esperada: </span>{a.correctAnswer}</p>}
                            <Evidence claimIds={a.claimIds} references={refs} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Block>

                  {m.evidence.length > 0 && (
                    <details className="rounded-md border border-zinc-200">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700">Fuentes del módulo ({m.evidence.length})</summary>
                      <div className="space-y-2 border-t border-zinc-200 p-3">
                        {m.evidence.map((r, i) => <SourceReference key={`${r.sourceId}-${r.startOffset}-${i}`} evidence={r} />)}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="refs-title" className="space-y-2">
            <h3 id="refs-title" className="text-sm font-semibold text-zinc-900">Referencias de origen ({refs.length})</h3>
            <details className="rounded-lg border border-zinc-200 bg-white" data-all-references>
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">Mostrar todas las citas verificadas que respaldan la propuesta</summary>
              <div className="space-y-2 border-t border-zinc-200 p-3">
                {refs.map((r, i) => <div key={`${r.sourceId}-${r.startOffset}-${i}`}><p className="mb-1 text-xs text-zinc-500">{r.claimId}</p><SourceReference evidence={r} /></div>)}
              </div>
            </details>
          </section>
        </>
      )}

      {proposal.rejectedItems.length > 0 && (
        <section aria-labelledby="rejected-items-title" className="space-y-2">
          <h3 id="rejected-items-title" className="text-sm font-semibold text-zinc-900">Elementos descartados ({proposal.rejectedItems.length})</h3>
          <p className="text-xs text-zinc-500">Contenido generado por la IA que no estaba respaldado por afirmaciones confirmadas. No forma parte de la propuesta.</p>
          <details className="rounded-lg border border-zinc-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">Mostrar elementos descartados y sus motivos</summary>
            <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
              {proposal.rejectedItems.map((r, i) => (
                <li key={i} className="space-y-1 px-4 py-3" data-rejected-item>
                  <p className="text-xs text-zinc-500">{KIND[r.kind]?.label ?? r.kind} · <span className="font-mono">{r.location}</span></p>
                  <p className="text-sm break-words text-zinc-800">{r.text}</p>
                  <ul className="list-disc pl-5 text-xs break-words text-red-800">{r.reasons.map((x, j) => <li key={j}>{x}</li>)}</ul>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </article>
  )
}
