import type { ReactNode } from 'react'
import type { Analysis, Claim, Evidence } from '../../services/analysis.service'
import type { DocumentRecord } from '../../services/projects.service'
import { Alert } from '../Alert'
import { formatDate } from '../projects/format'
import { StatusIndicator } from '../StatusIndicator'
import { CLAIM_STATUS, GAP_CATEGORY, plural, REJECTION_CATEGORY, SEVERITY, shortId } from './labels'
import { SourceReference } from './SourceReference'

function ResultSection({ id, title, count, description, children }: { id: string; title: string; count?: number; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3">
      <div>
        <h3 id={id} className="text-sm font-semibold text-zinc-900">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal text-zinc-500">({count})</span>}
        </h3>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-zinc-500">{children}</p>

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <div className="space-y-2">
      {evidence.map((ev, i) => <SourceReference key={`${ev.sourceId}-${ev.startOffset}-${i}`} evidence={ev} />)}
    </div>
  )
}

function ClaimItem({ claim }: { claim: Claim }) {
  const status = CLAIM_STATUS[claim.status]
  return (
    <li className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4" data-claim={claim.claimId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusIndicator tone={status?.tone ?? 'neutral'} label={status?.label ?? claim.status} />
        <span className="text-xs text-zinc-400">{claim.claimId}</span>
      </div>
      <p className="text-sm break-words text-zinc-900">{claim.text}</p>
      <EvidenceList evidence={claim.evidence} />
    </li>
  )
}

/** The persisted analysis as returned by GET /api/analyses/:id. Nothing here is computed or invented by the UI. */
export function AnalysisResult({ analysis, document, currentExtractionId }: { analysis: Analysis; document: DocumentRecord; currentExtractionId: string | null }) {
  const isV2 = analysis.schemaVersion === 2
  const confirmed = analysis.claims.filter((c) => c.status === 'confirmed').length
  const pending = analysis.claims.length - confirmed
  const claimText = new Map(analysis.claims.map((c) => [c.claimId, c.text]))
  const historical = currentExtractionId !== null && analysis.extractionId !== currentExtractionId

  return (
    <article aria-labelledby="analysis-title" className="min-w-0 space-y-8" data-analysis={analysis.analysisId}>
      <header className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="analysis-title" tabIndex={-1} className="text-base font-semibold text-zinc-900 outline-none">Resultado del análisis</h2>
          <StatusIndicator tone={analysis.status === 'completed' ? 'success' : 'danger'} label={analysis.status === 'completed' ? 'Completado' : 'Fallido'} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs text-zinc-500">Documento</dt><dd className="break-words text-zinc-800">{document.originalFilename}</dd></div>
          <div><dt className="text-xs text-zinc-500">Creado</dt><dd className="text-zinc-800"><time dateTime={analysis.createdAt}>{formatDate(analysis.createdAt)}</time></dd></div>
          <div><dt className="text-xs text-zinc-500">Análisis</dt><dd className="font-mono text-xs text-zinc-700" title={analysis.analysisId}>{shortId(analysis.analysisId)}</dd></div>
          <div>
            <dt className="text-xs text-zinc-500">Versión del documento analizada</dt>
            <dd className="text-xs text-zinc-700"><span className="font-mono" title={analysis.extractionId}>{shortId(analysis.extractionId)}</span>{historical ? ' · anterior a la versión actual' : currentExtractionId ? ' · versión actual' : ''}</dd>
          </div>
          <div><dt className="text-xs text-zinc-500">Modelo</dt><dd className="text-xs text-zinc-700">{analysis.model}</dd></div>
        </dl>
        {analysis.status === 'completed' && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-zinc-200 pt-3 text-sm text-zinc-700" aria-label="Resumen de resultados">
            {[
              plural(confirmed, 'confirmada', 'confirmadas'),
              plural(pending, 'pendiente de validación', 'pendientes de validación'),
              ...(isV2 ? [plural(analysis.contradictions?.length ?? 0, 'contradicción', 'contradicciones'), plural(analysis.documentationGaps?.length ?? 0, 'vacío de documentación', 'vacíos de documentación')] : []),
              plural(analysis.rejectedClaims.length, 'afirmación rechazada', 'afirmaciones rechazadas'),
            ].map((text) => <li key={text}>{text}</li>)}
          </ul>
        )}
      </header>

      {analysis.status === 'failed' && (
        <Alert tone="error" title="El análisis no pudo completarse">
          {analysis.error?.message} No se generaron resultados en este intento.
        </Alert>
      )}
      {historical && <Alert tone="info" title="Análisis de una versión anterior">El documento se procesó de nuevo después de este análisis. Las referencias siguen apuntando a la versión analizada.</Alert>}
      {analysis.status === 'completed' && !isV2 && (
        <Alert tone="info" title="Análisis en formato anterior">Este análisis se generó antes de la detección de contradicciones y vacíos de documentación.</Alert>
      )}

      {analysis.status === 'completed' && (
        <>
          <ResultSection id="claims-title" title="Afirmaciones" count={analysis.claims.length} description="Cada afirmación incluye la cita verificada en la documentación.">
            {analysis.claims.length === 0 ? <Empty>No se extrajeron afirmaciones verificadas.</Empty> : (
              <ul className="space-y-3" aria-labelledby="claims-title">{analysis.claims.map((c) => <ClaimItem key={c.claimId} claim={c} />)}</ul>
            )}
          </ResultSection>

          {isV2 && (
            <ResultSection id="contradictions-title" title="Contradicciones" count={analysis.contradictions?.length ?? 0} description="Se conservan ambos lados del conflicto. Nunca se resuelven automáticamente.">
              {(analysis.contradictions ?? []).length === 0 ? <Empty>No se detectaron contradicciones.</Empty> : (
                <ul className="space-y-3">
                  {analysis.contradictions!.map((c) => (
                    <li key={c.contradictionId} className="space-y-2 rounded-lg border border-red-200 bg-white p-4" data-contradiction={c.contradictionId}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StatusIndicator tone={SEVERITY[c.severity]?.tone ?? 'neutral'} label={SEVERITY[c.severity]?.label ?? c.severity} />
                        <StatusIndicator tone="warning" label="Pendiente de revisión humana" />
                      </div>
                      <p className="text-sm break-words text-zinc-900">{c.description}</p>
                      {c.claimIds.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500">Afirmaciones relacionadas</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-700">
                            {c.claimIds.map((id) => <li key={id} className="break-words"><span className="text-xs text-zinc-400">{id}</span> {claimText.get(id) ?? ''}</li>)}
                          </ul>
                        </div>
                      )}
                      <EvidenceList evidence={c.evidence} />
                    </li>
                  ))}
                </ul>
              )}
            </ResultSection>
          )}

          {isV2 && (
            <ResultSection id="gaps-title" title="Vacíos de documentación" count={analysis.documentationGaps?.length ?? 0} description="Información relevante que la documentación no establece. No significa que la funcionalidad no exista.">
              {(analysis.documentationGaps ?? []).length === 0 ? <Empty>No se identificaron vacíos de documentación.</Empty> : (
                <ul className="space-y-3">
                  {analysis.documentationGaps!.map((g) => (
                    <li key={g.gapId} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4" data-gap={g.gapId}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StatusIndicator tone="neutral" label="No documentado" />
                        <span className="text-xs text-zinc-500">{GAP_CATEGORY[g.category] ?? g.category} · {g.topic}</span>
                      </div>
                      <p className="text-sm break-words text-zinc-900">{g.description}</p>
                      <p className="text-sm break-words text-zinc-600"><span className="font-medium text-zinc-700">Relevancia: </span>{g.relevance}</p>
                      {g.relatedEvidence.length > 0 && <EvidenceList evidence={g.relatedEvidence} />}
                    </li>
                  ))}
                </ul>
              )}
            </ResultSection>
          )}

          <ResultSection id="rejected-title" title="Afirmaciones no aceptadas" count={analysis.rejectedClaims.length} description="Propuestas por la IA pero rechazadas al verificar la evidencia. No forman parte de los resultados.">
            {analysis.rejectedClaims.length === 0 ? <Empty>Ninguna afirmación fue rechazada.</Empty> : (
              <details className="rounded-lg border border-zinc-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">Mostrar {analysis.rejectedClaims.length} afirmaciones rechazadas y sus motivos</summary>
                <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
                  {analysis.rejectedClaims.map((r, i) => (
                    <li key={i} className="space-y-1 px-4 py-3" data-rejected-claim>
                      <p className="text-sm break-words text-zinc-800">{r.text || '(sin texto)'}</p>
                      {r.categories && r.categories.length > 0 && (
                        <p className="text-xs text-zinc-500">{r.categories.map((c) => REJECTION_CATEGORY[c] ?? c).join(' · ')}</p>
                      )}
                      <ul className="list-disc pl-5 text-xs break-words text-red-800">{r.reasons.map((reason, j) => <li key={j}>{reason}</li>)}</ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </ResultSection>

          {isV2 && ((analysis.rejectedContradictions?.length ?? 0) > 0 || (analysis.rejectedGaps?.length ?? 0) > 0) && (
            <details className="rounded-lg border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                Contradicciones y vacíos no aceptados ({(analysis.rejectedContradictions?.length ?? 0) + (analysis.rejectedGaps?.length ?? 0)})
              </summary>
              <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
                {[...(analysis.rejectedContradictions ?? []).map((r) => ({ label: 'Contradicción', text: r.description, reasons: r.reasons })),
                  ...(analysis.rejectedGaps ?? []).map((r) => ({ label: 'Vacío', text: r.description ?? r.topic, reasons: r.reasons }))].map((r, i) => (
                  <li key={i} className="space-y-1 px-4 py-3">
                    <p className="text-sm break-words text-zinc-800"><span className="text-xs text-zinc-500">{r.label}: </span>{r.text}</p>
                    <ul className="list-disc pl-5 text-xs break-words text-red-800">{r.reasons.map((reason, j) => <li key={j}>{reason}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {analysis.warnings.length > 0 && (
            <ResultSection id="warnings-title" title="Advertencias del análisis" count={analysis.warnings.length}>
              <ul className="list-disc space-y-1 pl-5 text-sm break-words text-zinc-600">{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </ResultSection>
          )}
        </>
      )}
    </article>
  )
}
