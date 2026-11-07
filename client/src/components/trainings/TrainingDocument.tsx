import type { ReactNode } from 'react'
import type { ContentItem, ProposalAttribute, ProposalSourceReference } from '../../services/proposal.service'
import type { CompetencyProfile, TrainingView } from '../../services/trainings.service'
import { locatorLabel, plural } from '../analysis/labels'
import { SourceReference } from '../analysis/SourceReference'
import { formatDate } from '../projects/format'
import { REVIEW_STATUS } from '../proposals/reviewLabels'
import { StatusIndicator } from '../StatusIndicator'
import { WARNING_LABELS } from './trainingLabels'

const ASSESSMENT: Record<string, string> = { multiple_choice: 'Opción múltiple', true_false: 'Verdadero o falso', open_question: 'Pregunta abierta', exercise: 'Ejercicio' }

/** Reference numbers [n] of the claims behind a statement, matching section 10. */
function Refs({ ids, order }: { ids: string[]; order: string[] }) {
  const n = [...new Set(ids)].map((id) => order.indexOf(id) + 1).filter((i) => i > 0).sort((a, b) => a - b)
  if (n.length === 0) return null
  return <sup className="ml-0.5 text-[0.7rem] font-medium text-accent-700" title="Referencias documentales">[{n.join(', ')}]</sup>
}

function Item({ item, order }: { item: ContentItem; order: string[] }) {
  return (
    <li className="text-sm leading-6 text-zinc-800" data-doc-item={item.kind}>
      {item.kind === 'pending_validation' && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Pendiente de validación</span>}
      {item.text}
      {item.kind !== 'guidance' && <Refs ids={item.claimIds} order={order} />}
      {item.requiresReview && item.kind !== 'pending_validation' && <span className="ml-1.5 text-xs text-amber-700">(requiere revisión)</span>}
    </li>
  )
}

const attr = (a: ProposalAttribute) => `${a.value}${a.status === 'pending_validation' ? ' (por validar)' : ''}`

function Section({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="space-y-3 break-inside-avoid-page" data-doc-section={n}>
      <h3 id={id} className="border-b border-zinc-200 pb-1 text-base font-semibold text-zinc-900">{n}. {title}</h3>
      {children}
    </section>
  )
}

/**
 * E5.5: a training as a readable deliverable (11 parts: name, audience, objective, competencies, outcomes, modules,
 * lessons, activities, assessments, references, warnings). Same content as the exported Markdown.
 */
export function TrainingDocument({ training: t, profile }: { training: TrainingView; profile: CompetencyProfile | undefined }) {
  if (!t.content) return null
  const c = t.content
  const order = [...new Set(t.sourceReferences.map((r) => r.claimId))]
  const refsByClaim = (id: string): ProposalSourceReference[] => t.sourceReferences.filter((r) => r.claimId === id)
  const st = REVIEW_STATUS[t.reviewStatus]
  const activities = c.modules.flatMap((m) => m.activities.map((a) => ({ ...a, module: m })))
  const assessments = c.modules.flatMap((m) => m.assessments.map((a) => ({ ...a, module: m })))

  return (
    <article className="space-y-8 rounded-lg border border-zinc-200 bg-white p-5 sm:p-8 print:border-0 print:p-0" aria-labelledby="doc-title" data-training-document={t.audience}>
      <header className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Formación · {t.audienceLabel}</p>
        <h2 id="doc-title" className="text-xl font-semibold break-words text-zinc-900">{c.title}</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-zinc-500">Audiencia</dt><dd className="text-zinc-800">{t.audienceLabel}</dd></div>
          <div><dt className="text-xs text-zinc-500">Estado</dt><dd><StatusIndicator tone={st.tone} label={st.label} /></dd></div>
          <div><dt className="text-xs text-zinc-500">Versión</dt><dd className="text-zinc-800">Formación v{t.lineage.trainingVersion} · propuesta v{t.lineage.proposalVersion}</dd></div>
          {t.proposalTitle && <div><dt className="text-xs text-zinc-500">Propuesta de origen</dt><dd className="break-words text-zinc-800">{t.proposalTitle}</dd></div>}
          <div><dt className="text-xs text-zinc-500">Duración estimada</dt><dd className="text-zinc-800">{attr(c.estimatedDuration)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Prerrequisitos</dt><dd className="text-zinc-800">{attr(c.prerequisites)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-zinc-500">Generación</dt><dd className="text-zinc-800">{formatDate(t.createdAt)} · IA ({t.model}) · requiere revisión humana</dd></div>
        </dl>
      </header>

      <Section n={1} title="Objetivo general"><p className="text-sm leading-6 text-zinc-800">{c.learningObjective}</p></Section>

      <Section n={2} title="Competencias que se desarrollarán">
        <ul className="space-y-2" data-doc-competencies>
          {c.competencies.map((s) => (
            <li key={s.competencyId} className="text-sm leading-6 text-zinc-800">
              <span className="font-medium text-zinc-900">{s.name}</span>
              {profile && <span className="text-zinc-600"> — {profile.competencies.find((p) => p.competencyId === s.competencyId)?.description}</span>}
              <span className="block text-zinc-700">{s.rationale}<Refs ids={s.claimIds} order={order} /></span>
            </li>
          ))}
        </ul>
        {c.excludedCompetencies.length > 0 && (
          <details className="rounded-md bg-zinc-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-zinc-700">{plural(c.excludedCompetencies.length, 'competencia del perfil no incluida', 'competencias del perfil no incluidas')} para este producto</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600">
              {c.excludedCompetencies.map((e) => <li key={e.competencyId}>{profile?.competencies.find((p) => p.competencyId === e.competencyId)?.name ?? e.competencyId}: {e.reason}</li>)}
            </ul>
          </details>
        )}
      </Section>

      <Section n={3} title="Resultados de aprendizaje esperados">
        <p className="text-sm text-zinc-600">Al finalizar, la persona participante podrá:</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-800">{c.learningOutcomes.map((o, i) => <li key={i}>{o}</li>)}</ol>
      </Section>

      <Section n={4} title="Conocimientos de producto necesarios">
        {c.productKnowledge.length === 0 ? <p className="text-sm text-zinc-500">Sin conocimientos adicionales.</p>
          : <ul className="list-disc space-y-1 pl-5">{c.productKnowledge.map((i, k) => <Item key={k} item={i} order={order} />)}</ul>}
      </Section>

      <Section n={5} title="Estructura de módulos">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm" data-doc-modules>
            <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">#</th><th className="py-1 pr-3">Módulo</th><th className="py-1 pr-3">Duración</th><th className="py-1 pr-3">Lecciones</th><th className="py-1 pr-3">Actividades</th><th className="py-1">Evaluaciones</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {c.modules.map((m) => (
                <tr key={m.moduleId}><td className="py-1.5 pr-3 text-zinc-500">{m.order}</td><td className="py-1.5 pr-3"><span className="font-medium text-zinc-900">{m.title}</span><span className="block text-xs text-zinc-600">{m.learningObjective}</span></td>
                  <td className="py-1.5 pr-3 text-zinc-700">{attr(m.suggestedDuration)}</td><td className="py-1.5 pr-3">{m.lessons.length}</td><td className="py-1.5 pr-3">{m.activities.length}</td><td className="py-1.5">{m.assessments.length}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={6} title="Lecciones y contenidos">
        {c.modules.map((m) => (
          <div key={m.moduleId} className="space-y-3" data-doc-module>
            <h4 className="text-sm font-semibold text-zinc-900">Módulo {m.order}. {m.title}</h4>
            {m.lessons.map((l) => (
              <div key={l.lessonId} className="space-y-1 pl-3">
                <h5 className="text-sm font-medium text-zinc-800">Lección {m.order}.{l.order}. {l.title}</h5>
                <ul className="list-disc space-y-1 pl-5">{l.content.map((i, k) => <Item key={k} item={i} order={order} />)}</ul>
              </div>
            ))}
          </div>
        ))}
      </Section>

      <Section n={7} title="Actividades prácticas">
        {activities.length === 0 ? <p className="text-sm text-zinc-500">Sin actividades.</p> : (
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.activityId} className="text-sm leading-6" data-doc-activity>
                <p className="font-medium text-zinc-900">{a.title} <span className="font-normal text-zinc-500">· Módulo {a.module.order}</span>{a.requiresReview && <span className="ml-1.5 text-xs text-amber-700">(requiere revisión)</span>}</p>
                <p className="text-zinc-800">{a.instructions}<Refs ids={a.claimIds} order={order} /></p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section n={8} title="Evaluaciones">
        {assessments.length === 0 ? <p className="text-sm text-zinc-500">Sin evaluaciones.</p> : (
          <ol className="list-decimal space-y-3 pl-5">
            {assessments.map((a) => (
              <li key={a.assessmentId} className="text-sm leading-6" data-doc-assessment>
                <p className="font-medium text-zinc-900">{a.question} <span className="font-normal text-zinc-500">· {ASSESSMENT[a.type]} · Módulo {a.module.order}</span></p>
                {a.options.length > 0 && <ul className="list-disc pl-5 text-zinc-700">{a.options.map((o) => <li key={o}>{o}{o === a.correctAnswer && <span className="ml-1 text-emerald-700">✔</span>}</li>)}</ul>}
                <p className="text-zinc-700"><span className="text-xs text-zinc-500">Respuesta esperada: </span>{a.correctAnswer}<Refs ids={a.claimIds} order={order} /></p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section n={9} title="Referencias documentales">
        <p className="text-sm text-zinc-600">Cada número corresponde a un pasaje verificado de la documentación autorizada.</p>
        <ol className="space-y-2" data-doc-references>
          {order.map((id, i) => (
            <li key={id} className="text-sm">
              <span className="font-medium text-zinc-900">[{i + 1}]</span>{' '}
              {refsByClaim(id).map((r, k) => (
                <span key={k} className="block print:hidden"><SourceReference evidence={r} /></span>
              ))}
              {refsByClaim(id).map((r, k) => <span key={`p${k}`} className="hidden print:block">{locatorLabel(r.locator)} — «{r.quote}»</span>)}
            </li>
          ))}
        </ol>
      </Section>

      <Section n={10} title="Advertencias y elementos pendientes de validación" id="warnings-title">
        {t.warnings.length === 0 ? <p className="text-sm text-zinc-500">Sin advertencias.</p> : (
          <ul className="space-y-1.5" data-doc-warnings>
            {t.warnings.map((w) => <li key={w.warningId} className="text-sm leading-6 text-zinc-800"><span className="font-medium text-amber-800">{WARNING_LABELS[w.type]}:</span> {w.message}</li>)}
          </ul>
        )}
        {t.rejectedItems.length > 0 && <p className="text-xs text-zinc-500">{plural(t.rejectedItems.length, 'elemento generado fue descartado', 'elementos generados fueron descartados')} por la validación (sin respaldo suficiente).</p>}
      </Section>
    </article>
  )
}
