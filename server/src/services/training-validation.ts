import type { ContentItem, ContentKind, RejectedItem } from '../types/proposal.types.js';
import { CONTENT_KINDS } from '../types/proposal.types.js';
import type { CompetencyProfile, ExcludedCompetency, SelectedCompetency } from '../types/training.types.js';
import { riskyCapabilities } from './claim-validation.js';
import { contentItemIssues, LIMITS, validateProposal, type ValidatedProposal, type ValidationContext } from './proposal-validation.js';

/**
 * Pure validation of a generated audience training (E5.5). The learning structure (modules, lessons, activities,
 * assessments, durations, warnings) is checked by the E3.3 proposal validator with the same evidence rules; this
 * module adds the audience-specific parts: competencies from the profile, learning outcomes and product knowledge.
 */

export interface ValidatedTraining extends Omit<ValidatedProposal, 'audience'> {
  competencies: SelectedCompetency[];
  excludedCompetencies: ExcludedCompetency[];
  learningOutcomes: string[];
  productKnowledge: ContentItem[];
}

export interface TrainingValidation {
  training: ValidatedTraining | null;
  errors: string[];
  rejectedItems: RejectedItem[];
  notes: string[];
}

const KEYS = ['title', 'learningObjective', 'competencies', 'excludedCompetencies', 'learningOutcomes', 'productKnowledge', 'prerequisites', 'estimatedDuration', 'modules', 'warnings'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const ids = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])].slice(0, LIMITS.idsPerItem) : null);

export function validateTraining(data: unknown, ctx: ValidationContext, profile: CompetencyProfile): TrainingValidation {
  const errors: string[] = [];
  const rejectedItems: RejectedItem[] = [];
  const notes: string[] = [];
  const fail = (): TrainingValidation => ({ training: null, errors, rejectedItems, notes });
  if (!isObject(data)) return { ...fail(), errors: ['training must be an object'] };
  for (const key of KEYS) if (!(key in data)) errors.push(`training.${key} is required`);
  for (const key of Object.keys(data)) if (!KEYS.includes(key)) errors.push(`training.${key} is not an allowed field`);
  if (errors.length > 0) return fail();

  // -- shared learning structure (E3.3 rules) -------------------------------------------------------------------------
  const structure = validateProposal({
    title: data.title, learningObjective: data.learningObjective, prerequisites: data.prerequisites, estimatedDuration: data.estimatedDuration,
    modules: data.modules, warnings: data.warnings,
    audience: { value: profile.label, status: 'pending_validation', claimIds: [] }, // fixed by the backend, not generated
  }, ctx);
  errors.push(...structure.errors);
  rejectedItems.push(...structure.rejectedItems);
  notes.push(...structure.notes);

  const statusOf = (id: string) => ctx.claims.get(id)?.status;
  const quotesOf = (list: string[]) => list.flatMap((id) => ctx.claims.get(id)?.quotes ?? []);
  const unknownClaims = (list: string[], path: string) => { for (const id of list) if (!ctx.claims.has(id)) errors.push(`${path} references unknown claim "${id}"`); };

  // -- competencies ----------------------------------------------------------------------------------------------------
  const profileIds = new Map(profile.competencies.map((c) => [c.competencyId, c]));
  const competencies: SelectedCompetency[] = [];
  const rawCompetencies = Array.isArray(data.competencies) ? data.competencies : (errors.push('competencies must be an array'), []);
  for (const [i, raw] of rawCompetencies.slice(0, profile.competencies.length * 2).entries()) {
    const path = `competencies[${i}]`;
    if (!isObject(raw)) { errors.push(`${path} must be an object`); continue; }
    const competency = typeof raw.competencyId === 'string' ? profileIds.get(raw.competencyId) : undefined;
    const rationale = text(raw.rationale, LIMITS.longText);
    const claimIds = ids(raw.claimIds);
    if (!claimIds) { errors.push(`${path}.claimIds must be an array of ids`); continue; }
    unknownClaims(claimIds, `${path}.claimIds`);
    const reasons: string[] = [];
    if (!competency) reasons.push(`"${String(raw.competencyId)}" is not a competency of the ${profile.label} profile`);
    else if (competencies.some((c) => c.competencyId === competency.competencyId)) reasons.push('duplicate competency');
    if (!rationale) reasons.push('a selected competency needs a rationale');
    if (claimIds.length === 0) reasons.push('a selected competency must reference the claims that make it relevant');
    if (rationale) {
      const risks = riskyCapabilities(rationale).filter((r) => !riskyCapabilities(quotesOf(claimIds).join('\n')).includes(r));
      if (risks.length > 0) reasons.push(`rationale asserts ${risks.join(', ')}, which is not stated by the cited claims`);
    }
    if (reasons.length > 0) { rejectedItems.push({ location: path, kind: 'competency', text: rationale ?? String(raw.competencyId), reasons }); continue; }
    competencies.push({ competencyId: competency!.competencyId, name: competency!.name, rationale: rationale!, claimIds });
  }
  if (competencies.length === 0) errors.push('the training selects no valid competency of the profile');

  const excludedCompetencies: ExcludedCompetency[] = [];
  for (const raw of Array.isArray(data.excludedCompetencies) ? data.excludedCompetencies : []) {
    if (!isObject(raw) || typeof raw.competencyId !== 'string' || !profileIds.has(raw.competencyId)) continue;
    if (competencies.some((c) => c.competencyId === raw.competencyId) || excludedCompetencies.some((c) => c.competencyId === raw.competencyId)) continue;
    excludedCompetencies.push({ competencyId: raw.competencyId, reason: text(raw.reason, LIMITS.longText) ?? 'Sin justificación.' });
  }
  const unaccounted = profile.competencies.filter((c) => !competencies.some((s) => s.competencyId === c.competencyId) && !excludedCompetencies.some((e) => e.competencyId === c.competencyId));
  for (const c of unaccounted) excludedCompetencies.push({ competencyId: c.competencyId, reason: 'No seleccionada por la IA (sin justificación explícita).' });
  if (unaccounted.length > 0) notes.push(`${unaccounted.length} profile competency(ies) were neither selected nor excluded by the model; recorded as excluded.`);

  // -- learning outcomes -------------------------------------------------------------------------------------------------
  const learningOutcomes: string[] = [];
  for (const [i, raw] of (Array.isArray(data.learningOutcomes) ? data.learningOutcomes : []).slice(0, 20).entries()) {
    const t = text(raw, LIMITS.longText);
    const risks = t ? riskyCapabilities(t) : [];
    if (!t || risks.length > 0) { rejectedItems.push({ location: `learningOutcomes[${i}]`, kind: 'learning_outcome', text: String(raw), reasons: [t ? `asserts ${risks.join(', ')}` : 'must be a non-empty text'] }); continue; }
    learningOutcomes.push(t);
  }
  if (learningOutcomes.length === 0) errors.push('the training has no valid learning outcome');

  // -- product knowledge (lesson-content rules) -----------------------------------------------------------------------------
  const productKnowledge: ContentItem[] = [];
  for (const [i, raw] of (Array.isArray(data.productKnowledge) ? data.productKnowledge : []).slice(0, LIMITS.contentPerLesson).entries()) {
    const path = `productKnowledge[${i}]`;
    if (!isObject(raw)) { errors.push(`${path} must be an object`); continue; }
    const claimIds = ids(raw.claimIds);
    const t = text(raw.text, LIMITS.longText);
    if (!claimIds || !t || !CONTENT_KINDS.includes(raw.kind as ContentKind)) { errors.push(`${path} must have a kind, a text and claimIds`); continue; }
    unknownClaims(claimIds, `${path}.claimIds`);
    const item: ContentItem = { kind: raw.kind as ContentKind, text: t, claimIds, requiresReview: raw.requiresReview === true };
    const reasons = contentItemIssues(item, statusOf, quotesOf);
    if (reasons.length > 0) { rejectedItems.push({ location: path, kind: item.kind, text: item.text, reasons }); continue; }
    if (item.kind === 'pending_validation' || claimIds.some((id) => ctx.claimsUnderReview.has(id))) item.requiresReview = true;
    productKnowledge.push(item);
  }

  if (errors.length > 0 || !structure.proposal) return fail();
  const { audience: _fixed, ...learning } = structure.proposal;
  return { training: { ...learning, competencies, excludedCompetencies, learningOutcomes, productKnowledge }, errors: [], rejectedItems, notes };
}
