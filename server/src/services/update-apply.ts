import { HttpError } from '../middleware/error.middleware.js';
import type { ImpactEvidence, ImpactLevel, ImpactResult, LearningElementType } from '../types/impact.types.js';
import {
  ASSESSMENT_TYPES,
  CONTENT_KINDS,
  type Activity,
  type Assessment,
  type AssessmentType,
  type ContentItem,
  type ContentKind,
  type LearningProposal,
  type Lesson,
  type Module,
  type ProposalAttribute,
  type SourceReference,
} from '../types/proposal.types.js';
import type { ComparedUnit, DocumentChange, DocumentComparison } from '../types/version.types.js';
import {
  UPDATE_OPERATIONS,
  type ElementContent,
  type LearningUpdate,
  type OperationReviewNote,
  type UpdateOperation,
  type UpdateOperationType,
  type UpdateWarning,
  type UpdateWarningCode,
} from '../types/update.types.js';
import { riskyCapabilities, unsupportedContent } from './claim-validation.js';
import { catalogue, evidenceFor, type Element } from './impact.service.js';
import { LIMITS } from './proposal-validation.js';

/**
 * E5.3 core: carries the source proposal's evidence over to the new document version, validates the model's
 * operations and applies them to a copy of the proposal. Nothing here writes to storage.
 */

type Content = NonNullable<LearningProposal['content']>;
const RANK: Record<Exclude<ImpactLevel, 'no_impact'>, number> = { high: 3, medium: 2, low: 1 };

// ---------------------------------------------------------------------------------------------------------------
// Evidence carried over to the new version
// ---------------------------------------------------------------------------------------------------------------

function uniqueIndex(text: string, quote: string): number {
  const i = text.indexOf(quote);
  return i >= 0 && text.indexOf(quote, i + 1) === -1 ? i : -1;
}

/**
 * Re-anchors each source reference of the proposal (previous version) to the new version through the E5.1
 * comparison: the quote must still occur (at the same offsets, or exactly once) in the corresponding new unit.
 * Claims left without any reference are "stale": their evidence is not in the new version.
 */
export function remapReferences(parent: LearningProposal, comparison: DocumentComparison): { references: SourceReference[]; available: Set<string>; stale: Set<string> } {
  const byPrevious = new Map<string, DocumentChange>(comparison.changes.filter((c) => c.from).map((c) => [c.from!.sourceId, c]));
  const references: SourceReference[] = [];
  for (const ref of parent.sourceReferences) {
    const change = byPrevious.get(ref.sourceId);
    if (!change?.to) continue;
    const text = change.to.text;
    const start = text.slice(ref.startOffset, ref.endOffset) === ref.quote ? ref.startOffset : uniqueIndex(text, ref.quote);
    if (start < 0) continue;
    references.push({ ...ref, sourceId: change.to.sourceId, locator: change.to.locator, startOffset: start, endOffset: start + ref.quote.length });
  }
  const available = new Set(references.map((r) => r.claimId));
  const stale = new Set(parent.sourceReferences.map((r) => r.claimId).filter((id) => !available.has(id)));
  return { references, available, stale };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of the model output
// ---------------------------------------------------------------------------------------------------------------

export interface ValidationContext {
  parent: LearningProposal & { content: Content };
  comparison: DocumentComparison;
  /** Actionable impact results by changeId. */
  actionable: Map<string, ImpactResult>;
  /** All impact results (for keptForReview change ids). */
  resultIds: Set<string>;
  changeById: Map<string, DocumentChange>;
  elements: Map<string, Element>;
  unresolvedClaims: Set<string>;
  /** Claims whose evidence was carried over to the new version, with their quotes there. */
  claimQuotes: Map<string, string[]>;
  pendingClaims: Set<string>;
}

interface ValidItem { kind: ContentKind; text: string; claimIds: string[]; newSourceIds: string[] }
export interface ValidOperation {
  index: number;
  operation: UpdateOperationType;
  elementType: LearningElementType;
  target: Element | null;
  parentModuleId: string | null;
  changeIds: string[];
  sourceIds: string[];
  justification: string;
  module: { title: string; learningObjective: string } | null;
  lesson: { title: string; content: ValidItem[] } | null;
  activity: { title: string; instructions: string; claimIds: string[]; newSourceIds: string[] } | null;
  assessment: { type: AssessmentType; question: string; options: string[]; correctAnswer: string; claimIds: string[]; newSourceIds: string[] } | null;
}

export interface OutputValidation {
  operations: ValidOperation[];
  rejected: LearningUpdate['rejectedOperations'];
  keptForReview: { elementId: string; reason: string; changeIds: string[] }[];
  warnings: string[];
  structuralErrors: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null);

export function validateOutput(data: unknown, ctx: ValidationContext): OutputValidation {
  const result: OutputValidation = { operations: [], rejected: [], keptForReview: [], warnings: [], structuralErrors: [] };
  if (!isObj(data)) return { ...result, structuralErrors: ['output must be an object'] };
  if (!Array.isArray(data.operations)) result.structuralErrors.push('"operations" must be an array');
  if (!Array.isArray(data.keptForReview)) result.structuralErrors.push('"keptForReview" must be an array');
  if (!strings(data.warnings) && !(Array.isArray(data.warnings) && data.warnings.length === 0)) result.structuralErrors.push('"warnings" must be an array of strings');
  if (result.structuralErrors.length > 0) return result;

  // Elements already targeted by an accepted operation, and modules removed.
  const targeted = new Set<string>();
  const removedModules = new Set<string>();
  const moduleIds = new Set(ctx.parent.content.modules.map((m) => m.moduleId));
  (data.operations as unknown[]).forEach((raw, index) => {
    const reasons: string[] = [];
    const op = validateOperation(raw, ctx, reasons, { targeted, removedModules, moduleIds });
    const r = isObj(raw) ? raw : {};
    if (!op || reasons.length > 0) {
      result.rejected.push({ index, operation: typeof r.operation === 'string' ? r.operation : null, elementId: typeof r.targetElementId === 'string' && r.targetElementId ? r.targetElementId : null, reasons });
      return;
    }
    op.index = index;
    if (op.target) targeted.add(op.target.elementId);
    if (op.operation === 'remove' && op.elementType === 'module') removedModules.add(op.target!.elementId);
    result.operations.push(op);
  });

  for (const raw of data.keptForReview as unknown[]) {
    const k = isObj(raw) ? raw : {};
    const changeIds = strings(k.changeIds) ?? [];
    if (typeof k.elementId === 'string' && ctx.elements.has(k.elementId) && !targeted.has(k.elementId)
      && typeof k.reason === 'string' && k.reason.trim() && changeIds.every((id) => ctx.resultIds.has(id))) {
      result.keptForReview.push({ elementId: k.elementId, reason: k.reason.trim().slice(0, LIMITS.longText), changeIds });
    }
  }
  result.warnings = (strings(data.warnings) ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 20).map((w) => w.slice(0, 1_000));
  return result;
}

function validateOperation(
  raw: unknown,
  ctx: ValidationContext,
  reasons: string[],
  state: { targeted: Set<string>; removedModules: Set<string>; moduleIds: Set<string> },
): ValidOperation | null {
  if (!isObj(raw)) {
    reasons.push('operation must be an object');
    return null;
  }
  const operation = raw.operation as UpdateOperationType;
  const elementType = raw.elementType as LearningElementType;
  if (!UPDATE_OPERATIONS.includes(operation)) reasons.push('invalid operation');
  if (!['module', 'lesson', 'activity', 'assessment'].includes(elementType)) reasons.push('invalid elementType');
  const justification = typeof raw.justification === 'string' ? raw.justification.trim() : '';
  if (!justification) reasons.push('justification is required');
  else if (justification.length > LIMITS.longText) reasons.push('justification is too long');

  // Changes and sources: only actionable changes, only their passages.
  const changeIds = strings(raw.changeIds) ?? [];
  if (changeIds.length === 0) reasons.push('changeIds must list at least one change');
  for (const id of changeIds) if (!ctx.actionable.has(id)) reasons.push(`change "${id}" is not an actionable change of this impact analysis`);
  const allowed = new Map<string, ComparedUnit>();
  for (const id of changeIds) {
    const c = ctx.changeById.get(id);
    if (c?.from) allowed.set(c.from.sourceId, c.from);
    if (c?.to) allowed.set(c.to.sourceId, c.to);
  }
  const sourceIds = strings(raw.sourceIds) ?? [];
  if (sourceIds.length === 0) reasons.push('sourceIds must list at least one passage');
  for (const s of sourceIds) if (!allowed.has(s)) reasons.push(`reference "${s}" is not a passage of the cited changes`);
  if (reasons.length > 0) return null;

  // Target / parent.
  const affected = new Set(changeIds.flatMap((id) => ctx.actionable.get(id)!.affectedElements.map((e) => e.elementId)));
  let target: Element | null = null;
  let parentModuleId: string | null = null;
  const targetId = typeof raw.targetElementId === 'string' ? raw.targetElementId : '';
  if (operation === 'add') {
    if (targetId) reasons.push('"add" must not have a targetElementId');
    const parent = typeof raw.parentModuleId === 'string' ? raw.parentModuleId : '';
    if (elementType === 'module') {
      if (parent) reasons.push('a new module has no parentModuleId');
    } else if (!state.moduleIds.has(parent)) reasons.push(`unknown parent module "${parent}"`);
    else if (state.removedModules.has(parent)) reasons.push(`parent module "${parent}" is removed by another operation`);
    else parentModuleId = parent;
  } else {
    target = ctx.elements.get(targetId) ?? null;
    if (!target) reasons.push(`unknown learning element "${targetId}"`);
    else if (target.elementType !== elementType) reasons.push(`"${targetId}" is a ${target.elementType}, not a ${elementType}`);
    else {
      const relatedModule = elementType === 'module' && [...affected].some((id) => ctx.elements.get(id)?.moduleId === targetId);
      if (!affected.has(targetId) && !relatedModule) reasons.push(`"${targetId}" is not affected by the cited changes`);
      if (state.targeted.has(targetId)) reasons.push(`"${targetId}" is already changed by another operation`);
      if (state.removedModules.has(target.moduleId)) reasons.push(`the module of "${targetId}" is removed by another operation`);
      if (operation === 'remove' && elementType === 'module' && [...state.targeted].some((id) => ctx.elements.get(id)?.moduleId === targetId)) {
        reasons.push(`module "${targetId}" contains elements changed by other operations`);
      }
    }
  }

  // Payload: exactly the element type's payload (plus a first lesson for a new module); nothing for "remove".
  const expected = new Set<string>(operation === 'remove' ? [] : [elementType, ...(operation === 'add' && elementType === 'module' ? ['lesson'] : [])]);
  for (const key of ['module', 'lesson', 'activity', 'assessment']) {
    const present = raw[key] !== null && raw[key] !== undefined;
    if (expected.has(key) && !present) reasons.push(`"${key}" content is required`);
    if (!expected.has(key) && present) reasons.push(`"${key}" must be null for this operation`);
  }
  if (reasons.length > 0) return null;

  const op: ValidOperation = { index: 0, operation, elementType, target, parentModuleId, changeIds, sourceIds, justification, module: null, lesson: null, activity: null, assessment: null };
  const newSide = (ids: string[]) => ids.filter((s) => allowed.get(s)?.version === ctx.comparison.to.version);
  const text = (v: unknown, path: string, max: number) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) reasons.push(`${path} is required`);
    else if (s.length > max) reasons.push(`${path} is too long`);
    return s;
  };
  /** Claims and passages behind product statements: claims must still have evidence and be confirmed; passages must belong to this operation. */
  const support = (claimIdsRaw: unknown, sourceIdsRaw: unknown, path: string, statement: string, factual: boolean) => {
    const claimIds = strings(claimIdsRaw) ?? [];
    const itemSources = strings(sourceIdsRaw) ?? [];
    if (!strings(claimIdsRaw) || !strings(sourceIdsRaw)) reasons.push(`${path}: claimIds and sourceIds must be arrays of ids`);
    for (const s of itemSources) if (!sourceIds.includes(s)) reasons.push(`${path}: reference "${s}" is not listed in the operation's sourceIds`);
    for (const id of claimIds) {
      if (!ctx.claimQuotes.has(id)) reasons.push(`${path}: claim "${id}" has no evidence in the new version`);
      else if (factual && (ctx.unresolvedClaims.has(id) || ctx.pendingClaims.has(id))) reasons.push(`${path}: claim "${id}" is pending validation or contradicted and cannot support a fact`);
    }
    const newSources = newSide(itemSources);
    if (factual) {
      const quotes = [...claimIds.flatMap((id) => ctx.claimQuotes.get(id) ?? []), ...newSources.map((s) => allowed.get(s)!.text)];
      if (quotes.length === 0) reasons.push(`${path}: a product statement needs a confirmed claim or a passage of the new version`);
      else for (const issue of unsupportedContent(statement, quotes, { subject: 'text', evidence: 'its cited sources' })) reasons.push(`${path}: ${issue.reason}`);
    } else if (riskyCapabilities(statement).length > 0) {
      reasons.push(`${path}: states ${riskyCapabilities(statement).join(', ')} without support`);
    }
    return { claimIds, newSourceIds: newSources };
  };

  if (raw.module !== null && raw.module !== undefined) {
    const m = isObj(raw.module) ? raw.module : {};
    op.module = { title: text(m.title, 'module.title', LIMITS.shortText), learningObjective: text(m.learningObjective, 'module.learningObjective', LIMITS.longText) };
    for (const s of [op.module.title, op.module.learningObjective]) if (riskyCapabilities(s).length > 0) reasons.push(`module: states ${riskyCapabilities(s).join(', ')} without support`);
  }
  if (raw.lesson !== null && raw.lesson !== undefined) {
    const l = isObj(raw.lesson) ? raw.lesson : {};
    const items = Array.isArray(l.content) ? l.content : [];
    if (items.length === 0) reasons.push('lesson.content needs at least one item');
    if (items.length > LIMITS.contentPerLesson) reasons.push('lesson.content has too many items');
    op.lesson = {
      title: text(l.title, 'lesson.title', LIMITS.shortText),
      content: items.slice(0, LIMITS.contentPerLesson).map((rawItem, i) => {
        const it = isObj(rawItem) ? rawItem : {};
        const path = `lesson.content[${i}]`;
        const kind = it.kind as ContentKind;
        if (!CONTENT_KINDS.includes(kind)) reasons.push(`${path}.kind is invalid`);
        const t = text(it.text, `${path}.text`, LIMITS.longText);
        const s = support(it.claimIds, it.sourceIds, path, t, kind === 'fact');
        return { kind, text: t, ...s };
      }),
    };
  }
  if (raw.activity !== null && raw.activity !== undefined) {
    const a = isObj(raw.activity) ? raw.activity : {};
    const title = text(a.title, 'activity.title', LIMITS.shortText);
    const instructions = text(a.instructions, 'activity.instructions', LIMITS.longText);
    op.activity = { title, instructions, ...support(a.claimIds, a.sourceIds, 'activity', `${title}\n${instructions}`, true) };
  }
  if (raw.assessment !== null && raw.assessment !== undefined) {
    const a = isObj(raw.assessment) ? raw.assessment : {};
    const type = a.type as AssessmentType;
    if (!ASSESSMENT_TYPES.includes(type)) reasons.push('assessment.type is invalid');
    const question = text(a.question, 'assessment.question', LIMITS.longText);
    const correctAnswer = text(a.correctAnswer, 'assessment.correctAnswer', LIMITS.longText);
    const options = strings(a.options) ?? [];
    if (type === 'multiple_choice' || type === 'true_false') {
      if (options.length < 2 || !options.includes(correctAnswer)) reasons.push('assessment.options must contain the correctAnswer and at least one alternative');
    } else if (options.length > 0) reasons.push('open questions and exercises must have empty options');
    op.assessment = { type, question, options, correctAnswer, ...support(a.claimIds, a.sourceIds, 'assessment', `${question}\n${correctAnswer}`, true) };
  }
  return reasons.length > 0 ? null : op;
}

// ---------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------

export function snapshot(element: Module | Lesson | Activity | Assessment, type: LearningElementType): ElementContent {
  switch (type) {
    case 'module': { const m = element as Module; return { elementType: 'module', title: m.title, learningObjective: m.learningObjective }; }
    case 'lesson': { const l = element as Lesson; return { elementType: 'lesson', title: l.title, content: l.content.map((c) => ({ kind: c.kind, text: c.text, requiresReview: c.requiresReview })) }; }
    case 'activity': { const a = element as Activity; return { elementType: 'activity', title: a.title, instructions: a.instructions }; }
    default: { const a = element as Assessment; return { elementType: 'assessment', type: a.type, question: a.question, options: a.options, correctAnswer: a.correctAnswer }; }
  }
}

function find(content: Content, id: string, type: LearningElementType): { module: Module; element: Module | Lesson | Activity | Assessment } | null {
  for (const m of content.modules) {
    if (type === 'module' && m.moduleId === id) return { module: m, element: m };
    const e = type === 'lesson' ? m.lessons.find((x) => x.lessonId === id) : type === 'activity' ? m.activities.find((x) => x.activityId === id) : type === 'assessment' ? m.assessments.find((x) => x.assessmentId === id) : undefined;
    if (e) return { module: m, element: e };
  }
  return null;
}

export interface ApplyInput {
  ctx: ValidationContext;
  operations: ValidOperation[];
  keptForReview: OutputValidation['keptForReview'];
  impactResults: ImpactResult[];
  carriedReferences: SourceReference[];
  staleClaims: Set<string>;
  proposalVersion: number;
}

export interface ApplyOutput {
  content: Content;
  sourceReferences: SourceReference[];
  operations: UpdateOperation[];
  keptForReview: LearningUpdate['keptForReview'];
  unchangedElementIds: string[];
  warnings: UpdateWarning[];
}

/** Applies validated operations to a copy of the source proposal. The source proposal object is never modified. */
export async function applyOperations(input: ApplyInput): Promise<ApplyOutput> {
  const { ctx, proposalVersion } = input;
  const content = structuredClone(ctx.parent.content);
  const warnings: UpdateWarning[] = [];
  const warn = (code: UpdateWarningCode, message: string, elementIds: string[] = []) => warnings.push({ source: 'backend', code, message, elementIds });

  // New ids carry the proposal version, so an id is never reused with another meaning across versions.
  const counters = { mod: 0, les: 0, act: 0, asm: 0 };
  const newId = (prefix: keyof typeof counters) => `${prefix}_v${proposalVersion}_${++counters[prefix]}`;

  // Passages of the new version cited by new content become references of the new proposal version.
  const synthetic = new Map<string, SourceReference>();
  const newUnits = new Map([...ctx.changeById.values()].filter((c) => c.to).map((c) => [c.to!.sourceId, c.to!]));
  const claimFor = (sourceId: string): string => {
    const existing = synthetic.get(sourceId);
    if (existing) return existing.claimId;
    const unit = newUnits.get(sourceId)!;
    const ref = { claimId: `src_v${proposalVersion}_${synthetic.size + 1}`, sourceId, locator: unit.locator, quote: unit.text, startOffset: 0, endOffset: unit.text.length };
    synthetic.set(sourceId, ref);
    return ref.claimId;
  };
  const unresolved = (claimIds: string[]) => claimIds.some((id) => ctx.unresolvedClaims.has(id) || ctx.pendingClaims.has(id));
  const item = (i: ValidItem): ContentItem => ({
    kind: i.kind,
    text: i.text,
    claimIds: [...i.claimIds, ...i.newSourceIds.map(claimFor)],
    requiresReview: i.kind === 'pending_validation' || unresolved(i.claimIds),
  });

  const applied: { op: ValidOperation; elementId: string; moduleId: string; previous: ElementContent | null }[] = [];
  for (const op of input.operations) {
    if (op.operation === 'remove') {
      const found = find(content, op.target!.elementId, op.elementType)!;
      const previous = snapshot(found.element, op.elementType);
      const m = found.module;
      if (op.elementType === 'module') content.modules = content.modules.filter((x) => x !== m);
      else if (op.elementType === 'lesson') m.lessons = m.lessons.filter((x) => x !== found.element);
      else if (op.elementType === 'activity') m.activities = m.activities.filter((x) => x !== found.element);
      else m.assessments = m.assessments.filter((x) => x !== found.element);
      applied.push({ op, elementId: op.target!.elementId, moduleId: m.moduleId, previous });
      continue;
    }
    if (op.operation === 'modify') {
      const found = find(content, op.target!.elementId, op.elementType)!;
      const previous = snapshot(found.element, op.elementType);
      if (op.elementType === 'module') Object.assign(found.element, op.module);
      else if (op.elementType === 'lesson') Object.assign(found.element, { title: op.lesson!.title, content: op.lesson!.content.map(item) });
      else if (op.elementType === 'activity') {
        const a = op.activity!;
        Object.assign(found.element, { title: a.title, instructions: a.instructions, claimIds: [...a.claimIds, ...a.newSourceIds.map(claimFor)], requiresReview: unresolved(a.claimIds) });
      } else {
        const a = op.assessment!;
        Object.assign(found.element, { type: a.type, question: a.question, options: a.options, correctAnswer: a.correctAnswer, claimIds: [...a.claimIds, ...a.newSourceIds.map(claimFor)], requiresReview: unresolved(a.claimIds) });
      }
      applied.push({ op, elementId: op.target!.elementId, moduleId: found.module.moduleId, previous });
      continue;
    }
    // add
    const lessonOf = (l: NonNullable<ValidOperation['lesson']>): Lesson => ({ lessonId: newId('les'), order: 0, title: l.title, content: l.content.map(item) });
    if (op.elementType === 'module') {
      const moduleId = newId('mod');
      content.modules.push({
        moduleId, order: 0, title: op.module!.title, learningObjective: op.module!.learningObjective,
        suggestedDuration: { value: 'Por validar', status: 'pending_validation', claimIds: [] },
        lessons: [lessonOf(op.lesson!)], activities: [], assessments: [], claimIds: [], evidence: [],
      });
      applied.push({ op, elementId: moduleId, moduleId, previous: null });
      continue;
    }
    const m = content.modules.find((x) => x.moduleId === op.parentModuleId)!;
    let elementId: string;
    if (op.elementType === 'lesson') { const l = lessonOf(op.lesson!); m.lessons.push(l); elementId = l.lessonId; }
    else if (op.elementType === 'activity') {
      const a = op.activity!;
      elementId = newId('act');
      m.activities.push({ activityId: elementId, title: a.title, instructions: a.instructions, claimIds: [...a.claimIds, ...a.newSourceIds.map(claimFor)], requiresReview: unresolved(a.claimIds) });
    } else {
      const a = op.assessment!;
      elementId = newId('asm');
      m.assessments.push({ assessmentId: elementId, type: a.type, question: a.question, options: a.options, correctAnswer: a.correctAnswer, claimIds: [...a.claimIds, ...a.newSourceIds.map(claimFor)], requiresReview: unresolved(a.claimIds) });
    }
    applied.push({ op, elementId, moduleId: m.moduleId, previous: null });
  }

  // Flag kept elements (model's keptForReview, elements of uncertain impact results, elements citing stale claims).
  const touched = new Set(applied.map((a) => a.elementId));
  const flag = (id: string, type: LearningElementType) => {
    const f = find(content, id, type);
    if (!f) return false;
    if (type === 'lesson') for (const c of (f.element as Lesson).content) c.requiresReview = true;
    else if (type === 'activity' || type === 'assessment') (f.element as Activity | Assessment).requiresReview = true;
    return true;
  };
  const kept = input.keptForReview.flatMap((k) => {
    const e = ctx.elements.get(k.elementId)!;
    return flag(e.elementId, e.elementType) ? [{ elementId: e.elementId, elementType: e.elementType, moduleId: e.moduleId, title: e.title, reason: k.reason, changeIds: k.changeIds }] : [];
  });
  if (kept.length > 0) warn('kept_for_review', `${kept.length} element(s) were kept unchanged and flagged for review by the model.`, kept.map((k) => k.elementId));
  const uncertainIds = [...new Set(input.impactResults.filter((r) => r.origin === 'ai' && r.certainty === 'uncertain').flatMap((r) => r.affectedElements.map((e) => e.elementId)))]
    .filter((id) => !touched.has(id) && flag(id, ctx.elements.get(id)!.elementType));
  if (uncertainIds.length > 0) warn('flagged_uncertain', 'Elements related to uncertain impact results were kept unchanged and flagged for review.', uncertainIds);
  const staleIds = [...ctx.elements.values()]
    .filter((e) => e.elementType !== 'module' && !touched.has(e.elementId) && e.claimIds.some((id) => input.staleClaims.has(id)))
    .filter((e) => flag(e.elementId, e.elementType)).map((e) => e.elementId);
  if (staleIds.length > 0) warn('stale_evidence', 'Some unchanged elements cite documentation that is no longer in the new version; they were flagged for review.', staleIds);

  // Attributes whose supporting claims lost their evidence are downgraded to pending validation (never upgraded).
  const downgraded: string[] = [];
  const attribute = (a: ProposalAttribute, label: string): ProposalAttribute => {
    const claimIds = a.claimIds.filter((id) => !input.staleClaims.has(id));
    if (a.status === 'supported' && claimIds.length === 0) {
      downgraded.push(label);
      return { ...a, status: 'pending_validation', claimIds };
    }
    return { ...a, claimIds };
  };
  content.audience = attribute(content.audience, 'audience');
  content.prerequisites = attribute(content.prerequisites, 'prerequisites');
  content.estimatedDuration = attribute(content.estimatedDuration, 'estimatedDuration');

  // Recompute order, module claims and evidence (references of the new version only).
  const references = [...input.carriedReferences, ...synthetic.values()];
  const refsOf = (ids: string[]) => references.filter((r) => ids.includes(r.claimId));
  content.modules.forEach((m, i) => {
    m.order = i + 1;
    m.suggestedDuration = attribute(m.suggestedDuration, `${m.moduleId}.suggestedDuration`);
    m.lessons.forEach((l, j) => { l.order = j + 1; });
    m.claimIds = [...new Set([...m.suggestedDuration.claimIds, ...m.lessons.flatMap((l) => l.content.flatMap((c) => c.claimIds)), ...m.activities.flatMap((a) => a.claimIds), ...m.assessments.flatMap((a) => a.claimIds)])];
    m.evidence = refsOf(m.claimIds);
    if (m.lessons.length === 0) warn('empty_module', `Module ${m.moduleId} has no lessons after the update.`, [m.moduleId]);
  });
  if (downgraded.length > 0) warn('downgraded_attribute', `Attributes without evidence in the new version were changed to pending validation: ${downgraded.join(', ')}.`);
  const used = new Set([
    ...content.audience.claimIds, ...content.prerequisites.claimIds, ...content.estimatedDuration.claimIds,
    ...content.modules.flatMap((m) => m.claimIds),
  ]);

  const operations: UpdateOperation[] = [];
  for (const [i, a] of applied.entries()) {
    const after = a.op.operation === 'remove' ? null : find(content, a.elementId, a.op.elementType);
    const proposed = after ? snapshot(after.element, a.op.elementType) : null;
    const notes = new Set<OperationReviewNote>();
    if (proposed?.elementType === 'lesson' && proposed.content.some((c) => c.kind === 'pending_validation')) notes.add('pending_validation_content');
    const claimIds = a.op.target?.claimIds ?? [];
    if (unresolved(claimIds) || (after && 'claimIds' in after.element && unresolved((after.element as Activity).claimIds))) notes.add('unresolved_issue');
    const levels = a.op.changeIds.map((id) => ctx.actionable.get(id)!.impact as Exclude<ImpactLevel, 'no_impact'>);
    const references: ImpactEvidence[] = await evidenceFor(a.op.sourceIds, ctx.comparison);
    operations.push({
      operationId: `op_${i + 1}`,
      operation: a.op.operation,
      elementType: a.op.elementType,
      elementId: a.elementId,
      moduleId: a.moduleId,
      previous: a.previous,
      proposed,
      justification: a.op.justification,
      changeIds: a.op.changeIds,
      impactLevel: levels.reduce((x, y) => (RANK[y] > RANK[x] ? y : x)),
      references,
      requiresReview: true, // every operation is a proposal for human review
      reviewNotes: [...notes],
    });
  }

  const removedIds = new Set(applied.filter((a) => a.op.operation === 'remove').flatMap((a) =>
    a.op.elementType === 'module' ? [...ctx.elements.values()].filter((e) => e.moduleId === a.elementId).map((e) => e.elementId) : [a.elementId]));
  const unchangedElementIds = catalogue(ctx.parent).map((e) => e.elementId).filter((id) => !touched.has(id) && !removedIds.has(id));
  if (input.operations.length === 0) throw new HttpError(500, 'No operation to apply.');
  return { content, sourceReferences: references.filter((r) => used.has(r.claimId)), operations, keptForReview: kept, unchangedElementIds, warnings };
}
