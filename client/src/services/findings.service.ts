import { api } from './api'
import type { SourceLocator } from './analysis.service'
import type { Audience } from './trainings.service'

/** Client types mirroring server/src/types/finding.types.ts and finding.service.ts (E5.5). */

export type FindingType = 'contradiction' | 'documentation_gap' | 'pending_validation' | 'analysis_warning' | 'proposal_warning'
export type FindingStatus = 'unresolved' | 'pending_validation' | 'resolved_with_evidence'

export interface FindingDecision {
  decisionId: string
  analysisId: string
  findingId: string
  status: FindingStatus
  explanation: string | null
  question: string | null
  evidence: { sourceId: string; locator: SourceLocator; quote: string } | null
  previousDecisionId: string | null
  decidedAt: string
}

export interface FindingReference { claimId: string | null; sourceId: string; locator: SourceLocator; quote: string; startOffset: number; endOffset: number }

export interface AffectedElement {
  scope: 'proposal' | 'training'
  ownerId: string
  audience: Audience | null
  ownerLabel: string
  moduleTitle: string
  elementId: string
  elementType: 'lesson' | 'activity' | 'assessment' | 'product_knowledge'
  title: string
}

export interface Finding {
  findingId: string
  type: FindingType
  origin: 'analysis' | 'proposal'
  title: string
  description: string
  severity: string | null
  claims: { claimId: string; text: string; status: string }[]
  references: FindingReference[]
  status: FindingStatus
  latestDecision: FindingDecision | null
  decisions: FindingDecision[]
  affected: AffectedElement[]
}

export interface FindingsView {
  analysisId: string
  proposalId: string | null
  counts: Record<FindingStatus, number> & { total: number; open: number }
  findings: Finding[]
}

export interface FindingDecisionRequest {
  status: FindingStatus
  explanation?: string
  question?: string
  evidence?: { sourceId: string; quote: string }
  basedOnDecisionId: string | null
}

const enc = encodeURIComponent
export const listFindings = (analysisId: string, proposalId: string | null, signal?: AbortSignal) =>
  api.get<FindingsView>(`/analyses/${enc(analysisId)}/findings${proposalId ? `?proposalId=${enc(proposalId)}` : ''}`, { signal })
export const recordFindingDecision = (analysisId: string, findingId: string, request: FindingDecisionRequest) =>
  api.post<FindingDecision>(`/analyses/${enc(analysisId)}/findings/${enc(findingId)}/decisions`, request)
