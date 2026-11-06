import type { AnalysisSummary } from '../../services/analysis.service'
import { plural, shortId } from '../analysis/labels'
import { formatDate } from '../projects/format'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'

interface AnalysisListProps {
  analyses: AnalysisSummary[]
  selectedId: string | null
  onSelect: (analysisId: string) => void
  /** Status badge per analysis (e.g. eligibility in the generator, completion in review). */
  badge: (analysis: AnalysisSummary) => { tone: StatusTone; label: string }
}

/** A document's persisted analyses as a selectable list (shared by the generator and the review section). */
export function AnalysisList({ analyses, selectedId, onSelect, badge }: AnalysisListProps) {
  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200" aria-label="Análisis del documento">
      {analyses.map((a) => {
        const selected = a.analysisId === selectedId
        const b = badge(a)
        return (
          <li key={a.analysisId}>
            <button type="button" onClick={() => onSelect(a.analysisId)} aria-pressed={selected}
              className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm ${selected ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}>
              <span className="text-zinc-800"><time dateTime={a.createdAt}>{formatDate(a.createdAt)}</time>
                <span className="ml-2 font-mono text-[11px] text-zinc-400" title={a.analysisId}>{shortId(a.analysisId)}</span>
                {a.status === 'completed' && <span className="ml-2 text-xs text-zinc-500">{plural(a.counts.confirmed, 'confirmada', 'confirmadas')} · {plural(a.counts.pendingValidation, 'pendiente', 'pendientes')}</span>}
              </span>
              <StatusIndicator tone={b.tone} label={b.label} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
