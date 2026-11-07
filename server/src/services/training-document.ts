import { COMPETENCY_PROFILES } from '../config/competency-profiles.js';
import { documentRepository } from '../repositories/document.repository.js';
import type { ContentItem, ProposalAttribute } from '../types/proposal.types.js';
import type { SourceLocator } from '../types/source.types.js';
import { getTraining, type TrainingView } from './training.service.js';

/**
 * E5.5: a training as a readable, exportable Markdown deliverable (no extra dependency). Product facts keep
 * their reference numbers [n], resolved in the "Referencias documentales" section; pending-validation content and
 * unresolved warnings stay explicitly marked.
 */

const REVIEW_LABELS: Record<string, string> = {
  pending_review: 'Borrador · pendiente de revisión humana',
  approved: 'Aprobada por revisión humana',
  rejected: 'Rechazada en revisión humana',
  not_reviewable: 'No revisable (generación fallida)',
  unavailable: 'Estado de revisión no disponible',
};
const ASSESSMENT_LABELS: Record<string, string> = { multiple_choice: 'Opción múltiple', true_false: 'Verdadero / falso', open_question: 'Pregunta abierta', exercise: 'Ejercicio' };
const WARNING_LABELS: Record<string, string> = {
  contradiction: 'Contradicción', documentation_gap: 'Información no documentada', pending_validation: 'Pendiente de validación', analysis_warning: 'Advertencia del análisis', proposal: 'Requiere revisión',
};

const locatorLabel = (l: SourceLocator) => (l.type === 'pdf-page' ? `Página ${l.pageNumber}` : `Párrafo ${l.paragraphIndex + 1}`);
/** Keeps generated text from breaking the Markdown structure. */
const clean = (text: string) => text.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();

export function renderTrainingMarkdown(t: TrainingView, documentName: string | null): string {
  if (!t.content) return `# Formación ${t.audienceLabel}\n\nEsta generación falló y no tiene contenido.\n`;
  const c = t.content;
  const claimOrder = [...new Set(t.sourceReferences.map((r) => r.claimId))];
  const refs = (ids: string[]) => {
    const n = [...new Set(ids)].map((id) => claimOrder.indexOf(id) + 1).filter((i) => i > 0).sort((a, b) => a - b);
    return n.length ? ` [${n.join(', ')}]` : '';
  };
  const item = (i: ContentItem) => {
    const tag = i.kind === 'pending_validation' ? '**[Pendiente de validación]** ' : '';
    const review = i.requiresReview && i.kind !== 'pending_validation' ? ' _(requiere revisión)_' : '';
    return `- ${tag}${clean(i.text)}${i.kind === 'guidance' ? '' : refs(i.claimIds)}${review}`;
  };
  const attr = (a: ProposalAttribute) => `${clean(a.value)}${a.status === 'pending_validation' ? ' _(por validar)_' : refs(a.claimIds)}`;
  const profile = COMPETENCY_PROFILES[t.audience];
  const out: string[] = [];

  out.push(`# ${clean(c.title)}`, '');
  out.push(`| | |`, `|---|---|`);
  out.push(`| **Audiencia** | ${t.audienceLabel} |`);
  out.push(`| **Estado** | ${REVIEW_LABELS[t.reviewStatus] ?? t.reviewStatus} |`);
  out.push(`| **Versión de la formación** | ${t.lineage.trainingVersion} (propuesta versión ${t.lineage.proposalVersion}) |`);
  if (t.proposalTitle) out.push(`| **Propuesta de origen** | ${clean(t.proposalTitle)} |`);
  if (documentName) out.push(`| **Documentación fuente** | ${clean(documentName)} |`);
  out.push(`| **Duración estimada** | ${attr(c.estimatedDuration)} |`);
  out.push(`| **Prerrequisitos** | ${attr(c.prerequisites)} |`);
  out.push(`| **Generada** | ${t.createdAt.slice(0, 10)} con IA (${t.model}); requiere revisión humana |`, '');

  out.push('## 1. Objetivo general', '', clean(c.learningObjective), '');

  out.push('## 2. Competencias que se desarrollarán', '');
  for (const s of c.competencies) {
    const def = profile.competencies.find((p) => p.competencyId === s.competencyId);
    out.push(`- **${s.name}** — ${def?.description ?? ''} ${clean(s.rationale)}${refs(s.claimIds)}`);
  }
  if (c.excludedCompetencies.length) {
    out.push('', '_Competencias del perfil no incluidas para este producto:_', '');
    for (const e of c.excludedCompetencies) out.push(`- ${profile.competencies.find((p) => p.competencyId === e.competencyId)?.name ?? e.competencyId}: ${clean(e.reason)}`);
  }
  out.push('');

  out.push('## 3. Resultados de aprendizaje esperados', '', 'Al finalizar, la persona participante podrá:', '');
  c.learningOutcomes.forEach((o, i) => out.push(`${i + 1}. ${clean(o)}`));
  out.push('');

  if (c.productKnowledge.length) {
    out.push('## 4. Conocimientos de producto necesarios', '');
    c.productKnowledge.forEach((i) => out.push(item(i)));
    out.push('');
  }

  out.push('## 5. Estructura de módulos', '', '| # | Módulo | Objetivo | Duración sugerida | Lecciones | Actividades | Evaluaciones |', '|---|---|---|---|---|---|---|');
  for (const m of c.modules) out.push(`| ${m.order} | ${clean(m.title)} | ${clean(m.learningObjective)} | ${attr(m.suggestedDuration)} | ${m.lessons.length} | ${m.activities.length} | ${m.assessments.length} |`);
  out.push('');

  out.push('## 6. Lecciones y contenidos', '');
  for (const m of c.modules) {
    out.push(`### Módulo ${m.order}. ${clean(m.title)}`, '', `**Objetivo:** ${clean(m.learningObjective)}`, '');
    for (const l of m.lessons) {
      out.push(`#### Lección ${m.order}.${l.order}. ${clean(l.title)}`, '');
      l.content.forEach((i) => out.push(item(i)));
      out.push('');
    }
  }

  out.push('## 7. Actividades prácticas', '');
  for (const m of c.modules) for (const a of m.activities) {
    out.push(`**${clean(a.title)}** (Módulo ${m.order})${a.requiresReview ? ' _(requiere revisión)_' : ''}`, '', `${clean(a.instructions)}${refs(a.claimIds)}`, '');
  }
  if (!c.modules.some((m) => m.activities.length)) out.push('_Sin actividades._', '');

  out.push('## 8. Evaluaciones', '');
  let q = 0;
  for (const m of c.modules) for (const a of m.assessments) {
    out.push(`${++q}. **${clean(a.question)}** — ${ASSESSMENT_LABELS[a.type] ?? a.type}, Módulo ${m.order}${a.requiresReview ? ' _(requiere revisión)_' : ''}`);
    for (const o of a.options) out.push(`   - ${o === a.correctAnswer ? '✔ ' : ''}${clean(o)}`);
    out.push(`   - _Respuesta esperada:_ ${clean(a.correctAnswer)}${refs(a.claimIds)}`, '');
  }
  if (q === 0) out.push('_Sin evaluaciones._', '');

  out.push('## 9. Referencias documentales', '', 'Cada número corresponde a un pasaje verificado de la documentación autorizada.', '');
  claimOrder.forEach((id, i) => {
    for (const r of t.sourceReferences.filter((x) => x.claimId === id)) out.push(`${i + 1}. ${locatorLabel(r.locator)} — «${clean(r.quote)}» \`${r.sourceId}\``);
  });
  out.push('');

  out.push('## 10. Advertencias y elementos pendientes de validación', '');
  if (t.warnings.length === 0) out.push('_Sin advertencias._');
  for (const w of t.warnings) out.push(`- **${WARNING_LABELS[w.type] ?? w.type}:** ${clean(w.message)}`);
  out.push('', '---', '', '_Documento generado por AI-First Learning Builder a partir de documentación autorizada. Las afirmaciones de producto se limitan a las referencias citadas; los elementos marcados como pendientes requieren validación de Producto._', '');
  return out.join('\n');
}

export async function trainingDocument(trainingId: string): Promise<{ filename: string; markdown: string }> {
  const training = await getTraining(trainingId);
  const document = await documentRepository.findById(training.documentId);
  const slug = (training.content?.title ?? 'formacion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'formacion';
  return { filename: `${training.audience === 'sales' ? 'sales' : 'customer-experience'}-${slug}-v${training.lineage.trainingVersion}.md`, markdown: renderTrainingMarkdown(training, document?.originalFilename ?? null) };
}
