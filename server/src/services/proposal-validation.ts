import type { ClaimStatus } from '../types/analysis.types.js';
import {
  ASSESSMENT_TYPES,
  CONTENT_KINDS,
  type Activity,
  type Assessment,
  type AssessmentType,
  type ContentItem,
  type ContentKind,
  type Lesson,
  type ProposalAttribute,
  type RejectedItem,
} from '../types/proposal.types.js';
import { riskyCapabilities, unsupportedContent } from './claim-validation.js';

/** Pure validation of a generated proposal against its source analysis. No I/O. */

/** Wording for support-check reasons: proposal text is checked against the quotations of its cited claims. */
const CITED = { subject: 'text', evidence: 'the cited claims' };

export const LIMITS = {
  modules: 12,
  lessonsPerModule: 20,
  contentPerLesson: 30,
  activitiesPerModule: 20,
  assessmentsPerModule: 20,
  warnings: 100,
  idsPerItem: 20,
  shortText: 300,
  longText: 4_000,
} as const;

export interface ClaimContext {
  claimId: string;
  status: ClaimStatus;
  /** Verified quotations behind the claim. */
  quotes: string[];
}

export interface ValidationContext {
  claims: Map<string, ClaimContext>;
  contradictionIds: Set<string>;
  gapIds: Set<string>;
  /** Claims involved in a contradiction or related to a documentation gap: content using them needs review. */
  claimsUnderReview: Set<string>;
}

export interface ValidatedModule {
  title: string;
  learningObjective: string;
  suggestedDuration: ProposalAttribute;
  lessons: Omit<Lesson, 'lessonId' | 'order'>[];
  activities: Omit<Activity, 'activityId'>[];
  assessments: Omit<Assessment, 'assessmentId'>[];
}

export interface ValidatedProposal {
  title: string;
  learningObjective: string;
  audience: ProposalAttribute;
  prerequisites: ProposalAttribute;
  estimatedDuration: ProposalAttribute;
  modules: ValidatedModule[];
  warnings: { message: string; relatedClaimIds: string[]; relatedContradictionIds: string[]; relatedGapIds: string[] }[];
}

export interface ProposalValidation {
  /** Present only when there are no critical errors. */
  proposal: ValidatedProposal | null;
  /** Critical problems: the attempt is not a valid proposal. */
  errors: string[];
  /** Items removed from the proposal, with reasons. */
  rejectedItems: RejectedItem[];
  /** Non-critical adjustments the reviewer should know about. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Structural readers (collect errors with JSON paths)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

class Reader {
  readonly errors: string[] = [];

  object(value: unknown, path: string, keys: readonly string[]): Obj | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.errors.push(`${path} must be an object`);
      return null;
    }
    const o = value as Obj;
    for (const key of keys) if (!(key in o)) this.errors.push(`${path}.${key} is required`);
    for (const key of Object.keys(o)) if (!keys.includes(key)) this.errors.push(`${path}.${key} is not an allowed field`);
    return o;
  }

  text(value: unknown, path: string, max: number): string {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s) this.errors.push(`${path} must be a non-empty string`);
    else if (s.length > max) this.errors.push(`${path} exceeds ${max} characters`);
    return s;
  }

  bool(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.errors.push(`${path} must be a boolean`);
    return value === true;
  }

  array(value: unknown, path: string, min: number, max: number): unknown[] {
    if (!Array.isArray(value)) {
      this.errors.push(`${path} must be an array`);
      return [];
    }
    if (value.length < min) this.errors.push(`${path} needs at least ${min} item(s)`);
    if (value.length > max) this.errors.push(`${path} has more than ${max} items`);
    return value.slice(0, max);
  }

  ids(value: unknown, path: string): string[] {
    const items = this.array(value, path, 0, LIMITS.idsPerItem);
    if (!items.every((id) => typeof id === 'string')) this.errors.push(`${path} must contain only strings`);
    return [...new Set(items.filter((id): id is string => typeof id === 'string'))];
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) this.errors.push(`${path} must be one of: ${allowed.join(', ')}`);
    return value as T;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateProposal(data: unknown, ctx: ValidationContext): ProposalValidation {
  const r = new Reader();
  const rejectedItems: RejectedItem[] = [];
  const notes: string[] = [];
  const fail = (): ProposalValidation => ({ proposal: null, errors: r.errors, rejectedItems, notes });

  const quotesOf = (ids: string[]) => ids.flatMap((id) => ctx.claims.get(id)?.quotes ?? []);
  const statusOf = (id: string) => ctx.claims.get(id)?.status;
  const checkClaimRefs = (ids: string[], path: string) => {
    for (const id of ids) if (!ctx.claims.has(id)) r.errors.push(`${path} references unknown claim "${id}"`);
  };
  const needsReview = (ids: string[]) => ids.some((id) => ctx.claimsUnderReview.has(id));
  const noRisk = (text: string, path: string) => {
    const risks = riskyCapabilities(text);
    if (risks.length > 0) r.errors.push(`${path} asserts ${risks.join(', ')}, which a proposal may not state`);
  };

  const readAttribute = (value: unknown, path: string): ProposalAttribute => {
    const o = r.object(value, path, ['value', 'status', 'claimIds']);
    if (!o) return { value: '', status: 'pending_validation', claimIds: [] };
    const attr: ProposalAttribute = {
      value: r.text(o.value, `${path}.value`, LIMITS.shortText),
      status: r.oneOf(o.status, `${path}.status`, ['supported', 'pending_validation'] as const),
      claimIds: r.ids(o.claimIds, `${path}.claimIds`),
    };
    checkClaimRefs(attr.claimIds, `${path}.claimIds`);
    noRisk(attr.value, `${path}.value`);
    if (attr.status === 'supported') {
      const confirmed = attr.claimIds.length > 0 && attr.claimIds.every((id) => statusOf(id) === 'confirmed');
      const issues = confirmed ? unsupportedContent(attr.value, quotesOf(attr.claimIds), CITED) : [];
      if (!confirmed || issues.length > 0) {
        attr.status = 'pending_validation';
        notes.push(`${path}: marked "supported" without confirmed claims establishing it; changed to pending_validation.`);
      }
    }
    return attr;
  };

  // -- top level -----------------------------------------------------------------
  const top = r.object(data, 'proposal', ['title', 'learningObjective', 'audience', 'prerequisites', 'estimatedDuration', 'modules', 'warnings']);
  if (!top) return fail();
  const title = r.text(top.title, 'title', LIMITS.shortText);
  const learningObjective = r.text(top.learningObjective, 'learningObjective', LIMITS.longText);
  noRisk(title, 'title');
  noRisk(learningObjective, 'learningObjective');
  const audience = readAttribute(top.audience, 'audience');
  const prerequisites = readAttribute(top.prerequisites, 'prerequisites');
  const estimatedDuration = readAttribute(top.estimatedDuration, 'estimatedDuration');

  // -- modules ---------------------------------------------------------------------
  const modules: ValidatedModule[] = [];
  for (const [m, rawModule] of r.array(top.modules, 'modules', 1, LIMITS.modules).entries()) {
    const mp = `modules[${m}]`;
    const mo = r.object(rawModule, mp, ['title', 'learningObjective', 'suggestedDuration', 'lessons', 'activities', 'assessments']);
    if (!mo) continue;
    const moduleTitle = r.text(mo.title, `${mp}.title`, LIMITS.shortText);
    const moduleObjective = r.text(mo.learningObjective, `${mp}.learningObjective`, LIMITS.longText);
    noRisk(moduleTitle, `${mp}.title`);
    noRisk(moduleObjective, `${mp}.learningObjective`);
    const suggestedDuration = readAttribute(mo.suggestedDuration, `${mp}.suggestedDuration`);

    const lessons: ValidatedModule['lessons'] = [];
    for (const [l, rawLesson] of r.array(mo.lessons, `${mp}.lessons`, 1, LIMITS.lessonsPerModule).entries()) {
      const lp = `${mp}.lessons[${l}]`;
      const lo = r.object(rawLesson, lp, ['title', 'content']);
      if (!lo) continue;
      const lessonTitle = r.text(lo.title, `${lp}.title`, LIMITS.shortText);
      noRisk(lessonTitle, `${lp}.title`);
      const content: ContentItem[] = [];
      for (const [c, rawItem] of r.array(lo.content, `${lp}.content`, 1, LIMITS.contentPerLesson).entries()) {
        const cp = `${lp}.content[${c}]`;
        const co = r.object(rawItem, cp, ['kind', 'text', 'claimIds', 'requiresReview']);
        if (!co) continue;
        const item: ContentItem = {
          kind: r.oneOf<ContentKind>(co.kind, `${cp}.kind`, CONTENT_KINDS),
          text: r.text(co.text, `${cp}.text`, LIMITS.longText),
          claimIds: r.ids(co.claimIds, `${cp}.claimIds`),
          requiresReview: r.bool(co.requiresReview, `${cp}.requiresReview`),
        };
        checkClaimRefs(item.claimIds, `${cp}.claimIds`);
        const reasons = contentItemIssues(item, statusOf, quotesOf);
        if (reasons.length > 0) {
          rejectedItems.push({ location: cp, kind: item.kind, text: item.text, reasons });
          continue;
        }
        if (item.kind === 'pending_validation' || needsReview(item.claimIds)) item.requiresReview = true;
        content.push(item);
      }
      if (content.length === 0) {
        rejectedItems.push({ location: lp, kind: 'lesson', text: lessonTitle, reasons: ['no valid content remained after validation'] });
        continue;
      }
      lessons.push({ title: lessonTitle, content });
    }

    const activities: ValidatedModule['activities'] = [];
    for (const [a, rawActivity] of r.array(mo.activities, `${mp}.activities`, 0, LIMITS.activitiesPerModule).entries()) {
      const ap = `${mp}.activities[${a}]`;
      const ao = r.object(rawActivity, ap, ['title', 'instructions', 'claimIds', 'requiresReview']);
      if (!ao) continue;
      const activity = {
        title: r.text(ao.title, `${ap}.title`, LIMITS.shortText),
        instructions: r.text(ao.instructions, `${ap}.instructions`, LIMITS.longText),
        claimIds: r.ids(ao.claimIds, `${ap}.claimIds`),
        requiresReview: r.bool(ao.requiresReview, `${ap}.requiresReview`),
      };
      checkClaimRefs(activity.claimIds, `${ap}.claimIds`);
      const reasons = confirmedOnlyIssues(activity.claimIds, statusOf, 'activity');
      if (reasons.length === 0) reasons.push(...unsupportedContent(`${activity.title}\n${activity.instructions}`, quotesOf(activity.claimIds), CITED).map((i) => i.reason));
      if (reasons.length > 0) {
        rejectedItems.push({ location: ap, kind: 'activity', text: activity.title, reasons });
        continue;
      }
      if (needsReview(activity.claimIds)) activity.requiresReview = true;
      activities.push(activity);
    }

    const assessments: ValidatedModule['assessments'] = [];
    for (const [q, rawAssessment] of r.array(mo.assessments, `${mp}.assessments`, 0, LIMITS.assessmentsPerModule).entries()) {
      const qp = `${mp}.assessments[${q}]`;
      const qo = r.object(rawAssessment, qp, ['type', 'question', 'options', 'correctAnswer', 'claimIds', 'requiresReview']);
      if (!qo) continue;
      const options = r.array(qo.options, `${qp}.options`, 0, 10);
      const assessment = {
        type: r.oneOf<AssessmentType>(qo.type, `${qp}.type`, ASSESSMENT_TYPES),
        question: r.text(qo.question, `${qp}.question`, LIMITS.longText),
        options: options.filter((o): o is string => typeof o === 'string').map((o) => o.trim()),
        correctAnswer: r.text(qo.correctAnswer, `${qp}.correctAnswer`, LIMITS.longText),
        claimIds: r.ids(qo.claimIds, `${qp}.claimIds`),
        requiresReview: r.bool(qo.requiresReview, `${qp}.requiresReview`),
      };
      if (assessment.options.length !== options.length) r.errors.push(`${qp}.options must contain only strings`);
      checkClaimRefs(assessment.claimIds, `${qp}.claimIds`);
      const reasons = [...confirmedOnlyIssues(assessment.claimIds, statusOf, 'assessment'), ...optionIssues(assessment)];
      if (reasons.length === 0) {
        reasons.push(...unsupportedContent(`${assessment.question}\n${assessment.correctAnswer}`, quotesOf(assessment.claimIds), CITED).map((i) => i.reason));
      }
      if (reasons.length > 0) {
        rejectedItems.push({ location: qp, kind: 'assessment', text: assessment.question, reasons });
        continue;
      }
      if (needsReview(assessment.claimIds)) assessment.requiresReview = true;
      assessments.push(assessment);
    }

    if (lessons.length === 0) r.errors.push(`${mp} has no valid lessons after validation`);
    modules.push({ title: moduleTitle, learningObjective: moduleObjective, suggestedDuration, lessons, activities, assessments });
  }

  // -- warnings --------------------------------------------------------------------------
  const warnings: ValidatedProposal['warnings'] = [];
  for (const [w, rawWarning] of r.array(top.warnings, 'warnings', 0, LIMITS.warnings).entries()) {
    const wp = `warnings[${w}]`;
    const wo = r.object(rawWarning, wp, ['message', 'relatedClaimIds', 'relatedContradictionIds', 'relatedGapIds']);
    if (!wo) continue;
    const warning = {
      message: r.text(wo.message, `${wp}.message`, LIMITS.longText),
      relatedClaimIds: r.ids(wo.relatedClaimIds, `${wp}.relatedClaimIds`),
      relatedContradictionIds: r.ids(wo.relatedContradictionIds, `${wp}.relatedContradictionIds`),
      relatedGapIds: r.ids(wo.relatedGapIds, `${wp}.relatedGapIds`),
    };
    checkClaimRefs(warning.relatedClaimIds, `${wp}.relatedClaimIds`);
    for (const id of warning.relatedContradictionIds) if (!ctx.contradictionIds.has(id)) r.errors.push(`${wp} references unknown contradiction "${id}"`);
    for (const id of warning.relatedGapIds) if (!ctx.gapIds.has(id)) r.errors.push(`${wp} references unknown documentation gap "${id}"`);
    warnings.push(warning);
  }

  const facts = modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.content)).filter((item) => item.kind === 'fact');
  if (r.errors.length === 0 && facts.length === 0) r.errors.push('the proposal contains no factual content supported by confirmed claims');
  if (r.errors.length > 0) return fail();

  return {
    proposal: { title, learningObjective, audience, prerequisites, estimatedDuration, modules, warnings },
    errors: [],
    rejectedItems,
    notes,
  };
}

/** Item-level evidence rules for lesson content. */
export function contentItemIssues(
  item: ContentItem,
  statusOf: (id: string) => ClaimStatus | undefined,
  quotesOf: (ids: string[]) => string[],
): string[] {
  const reasons: string[] = [];
  const pending = item.claimIds.filter((id) => statusOf(id) === 'pending_validation');
  if (item.kind === 'fact') {
    if (item.claimIds.length === 0) reasons.push('a factual statement must reference at least one confirmed claim');
    for (const id of pending) reasons.push(`a factual statement cannot rely on pending-validation claim ${id}`);
  } else if (item.kind === 'pending_validation') {
    if (pending.length === 0) reasons.push('a pending_validation item must reference at least one pending-validation claim');
  } else if (item.kind === 'guidance') {
    for (const id of pending) reasons.push(`guidance cannot rely on pending-validation claim ${id}`);
    const risks = riskyCapabilities(item.text);
    if (risks.length > 0) reasons.push(`guidance asserts ${risks.join(', ')}; product behavior must be a fact backed by confirmed claims`);
    return reasons;
  }
  if (reasons.length === 0 && item.claimIds.every((id) => statusOf(id) !== undefined)) {
    reasons.push(...unsupportedContent(item.text, quotesOf(item.claimIds), CITED).map((i) => i.reason));
  }
  return reasons;
}

function confirmedOnlyIssues(claimIds: string[], statusOf: (id: string) => ClaimStatus | undefined, kind: string): string[] {
  if (claimIds.length === 0) return [`an ${kind} must reference at least one confirmed claim`];
  return claimIds
    .filter((id) => statusOf(id) === 'pending_validation')
    .map((id) => `an ${kind} cannot rely on pending-validation claim ${id}`);
}

function optionIssues(a: { type: AssessmentType; options: string[]; correctAnswer: string }): string[] {
  if (a.type === 'open_question' || a.type === 'exercise') {
    return a.options.length === 0 ? [] : [`${a.type} must not have answer options`];
  }
  const reasons: string[] = [];
  if (a.type === 'true_false' && a.options.length !== 2) reasons.push('true_false needs exactly two options');
  if (a.type === 'multiple_choice' && a.options.length < 2) reasons.push('multiple_choice needs at least 2 options');
  if (new Set(a.options).size !== a.options.length) reasons.push('answer options must be unique');
  if (!a.options.includes(a.correctAnswer)) reasons.push('correctAnswer must be one of the options');
  return reasons;
}
