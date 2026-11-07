import { useCallback, useState } from 'react'
import { useApiResource } from '../../hooks/useApiResource'
import { setSearchParams, useSearchParam } from '../../router'
import { errorDetail } from '../../services/api'
import type { Project } from '../../services/projects.service'
import { compareVersions, type ChangeType, type ComparedUnit, type DocumentChange, type DocumentVersion } from '../../services/versions.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import { locatorLabel } from '../analysis/labels'
import { FileSearchIcon } from '../icons'
import { formatLabel } from '../projects/format'
import { StatusIndicator, type StatusTone } from '../StatusIndicator'
import { ChangeSource } from './ChangeSource'
import { ImpactAnalysisPanel } from './ImpactAnalysisPanel'

const CHANGE: Record<ChangeType, { label: string; tone: StatusTone; plural: string }> = {
  added: { label: 'Añadido', tone: 'success', plural: 'Añadidos' },
  removed: { label: 'Eliminado', tone: 'danger', plural: 'Eliminados' },
  modified: { label: 'Modificado', tone: 'warning', plural: 'Modificados' },
  unchanged: { label: 'Sin cambios', tone: 'neutral', plural: 'Sin cambios' },
}
const ORDER: ChangeType[] = ['added', 'removed', 'modified', 'unchanged']

const parseVersion = (raw: string | null): number | null => (raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : null)

/**
 * Deterministic comparison of two processed versions (computed by the backend from the persisted extractions;
 * nothing is simulated). The selected pair is kept in the URL (?desde=&hasta=).
 */
export function VersionComparison({ project, documentId, versions }: { project: Project; documentId: string; versions: DocumentVersion[] }) {
  const processed = versions.filter((v) => v.status === 'processed')
  const fromParam = parseVersion(useSearchParam('desde'))
  const toParam = parseVersion(useSearchParam('hasta'))
  const isProcessed = (n: number | null) => n !== null && processed.some((v) => v.version === n)
  const urlValid = isProcessed(fromParam) && isProcessed(toParam)
  const to = urlValid ? toParam! : processed.at(-1)?.version ?? null
  const from = urlValid ? fromParam! : processed.at(-2)?.version ?? null
  const fromV = versions.find((v) => v.version === from)
  const toV = versions.find((v) => v.version === to)
  const sameFormat = fromV && toV && fromV.document.extension === toV.document.extension
  const ready = from !== null && to !== null && from !== to && sameFormat

  const load = useCallback((signal: AbortSignal) => compareVersions(project.id, documentId, from!, to!, signal), [project.id, documentId, from, to])
  const comparison = useApiResource(ready ? `${documentId}:${from}:${to}:${fromV!.document.updatedAt}:${toV!.document.updatedAt}` : null, load)
  const choose = (field: 'desde' | 'hasta', value: string) =>
    setSearchParams({ desde: String(field === 'desde' ? value : from), hasta: String(field === 'hasta' ? value : to), propuesta: null, impacto: null, actualizacion: null })

  const unprocessed = versions.filter((v) => v.status !== 'processed')
  return (
    <section aria-labelledby="comparison-title" className="space-y-4" data-comparison>
      <div>
        <h2 id="comparison-title" className="text-base font-semibold text-zinc-900">Comparación de versiones</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Comparación determinista del texto extraído ({versions[0]?.document.extension === '.pdf' ? 'página por página' : 'párrafo por párrafo'}). No se usa IA.
        </p>
      </div>

      {processed.length < 2 ? (
        <EmptyState
          icon={FileSearchIcon}
          title={versions.length < 2 ? 'Solo hay una versión' : 'Se necesitan dos versiones procesadas'}
          description={versions.length < 2
            ? 'Sube una nueva versión del documento para compararla con la actual.'
            : `Solo se pueden comparar versiones con texto extraído. Pendientes o con error: ${unprocessed.map((v) => `versión ${v.version}`).join(', ')}.`}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <VersionSelect id="compare-from" label="Versión anterior" value={from} versions={processed} onChange={(v) => choose('desde', v)} />
            <VersionSelect id="compare-to" label="Versión nueva" value={to} versions={processed} onChange={(v) => choose('hasta', v)} />
          </div>
          {unprocessed.length > 0 && (
            <p className="text-xs text-zinc-500">
              No disponibles para comparar (sin texto extraído): {unprocessed.map((v) => `versión ${v.version}`).join(', ')}.
            </p>
          )}
          {from === to && <Alert tone="error" title="Elige dos versiones distintas">La versión anterior y la nueva son la misma.</Alert>}
          {from !== to && !sameFormat && fromV && toV && (
            <Alert tone="error" title="Comparación no disponible">
              La versión {fromV.version} es {formatLabel(fromV.document.extension)} y la versión {toV.version} es {formatLabel(toV.document.extension)}. Sus páginas y párrafos no pueden compararse entre sí.
            </Alert>
          )}
          {comparison.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Comparando versiones…</p>}
          {comparison.status === 'error' && (
            <Alert tone="error" title="Comparación no disponible" actions={<Button variant="secondary" onClick={comparison.reload}>Reintentar</Button>}>
              {errorDetail(comparison.error)}
            </Alert>
          )}
          {comparison.status === 'ready' && comparison.data && <ComparisonResult key={`${from}:${to}`} changes={comparison.data.changes} summary={comparison.data.summary}
            emptyFrom={comparison.data.from.emptyUnitCount} emptyTo={comparison.data.to.emptyUnitCount} />}
          {comparison.status === 'ready' && comparison.data && comparison.data.changes.some((c) => c.type !== 'unchanged') && (
            from! < to!
              ? <ImpactAnalysisPanel key={`impact:${from}:${to}`} project={project} documentId={documentId} from={from!} to={to!} />
              : <p className="text-sm text-zinc-500">Para analizar el impacto en el contenido de aprendizaje, elige como versión anterior una versión más antigua que la nueva.</p>
          )}
        </>
      )}
    </section>
  )
}

function VersionSelect({ id, label, value, versions, onChange }: { id: string; label: string; value: number | null; versions: DocumentVersion[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-zinc-900">{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="mt-1 block min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm">
        {versions.map((v) => (
          <option key={v.version} value={v.version}>Versión {v.version}{v.isCurrent ? ' (actual)' : ''} · {v.originalFilename}</option>
        ))}
      </select>
    </div>
  )
}

function ComparisonResult({ changes, summary, emptyFrom, emptyTo }: { changes: DocumentChange[]; summary: Record<ChangeType, number>; emptyFrom: number; emptyTo: number }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const differences = changes.length - summary.unchanged
  const visible = showUnchanged ? changes : changes.filter((c) => c.type !== 'unchanged')
  return (
    <div className="space-y-4" data-comparison-result>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Resumen de la comparación">
        {ORDER.map((type) => (
          <div key={type} className="rounded-md border border-zinc-200 bg-white px-3 py-2" data-summary={type}>
            <dt><StatusIndicator tone={CHANGE[type].tone} label={CHANGE[type].plural} /></dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-900">{summary[type]}</dd>
          </div>
        ))}
      </dl>
      {(emptyFrom > 0 || emptyTo > 0) && (
        <p className="text-xs text-zinc-500">
          Páginas sin texto extraíble (no comparadas): {emptyFrom} en la versión anterior y {emptyTo} en la nueva.
        </p>
      )}
      {differences === 0 && <Alert tone="success" title="No se detectaron diferencias">El texto extraído de ambas versiones coincide (sin contar diferencias de espacios).</Alert>}
      {summary.unchanged > 0 && (
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="size-4" />
          Mostrar contenido sin cambios ({summary.unchanged})
        </label>
      )}
      {visible.length > 0 && (
        <ol className="space-y-3" aria-label="Cambios detectados">
          {visible.map((c) => <ChangeCard key={c.changeId} change={c} />)}
        </ol>
      )}
    </div>
  )
}

function ChangeCard({ change }: { change: DocumentChange }) {
  const meta = CHANGE[change.type]
  return (
    <li className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4" data-change={change.type} data-change-id={change.changeId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusIndicator tone={meta.tone} label={meta.label} />
        {change.type === 'modified' && change.similarity !== undefined && (
          <span className="text-xs text-zinc-500">{Math.round(change.similarity * 100)} % de palabras en común</span>
        )}
      </div>
      <div className={`grid gap-3 ${change.from && change.to ? 'md:grid-cols-2' : ''}`}>
        {change.from && <UnitSide unit={change.from} side="from" diff={change.diff} />}
        {change.to && <UnitSide unit={change.to} side="to" diff={change.diff} />}
      </div>
    </li>
  )
}

function UnitSide({ unit, side, diff }: { unit: ComparedUnit; side: 'from' | 'to'; diff?: DocumentChange['diff'] }) {
  const hidden = side === 'from' ? 'added' : 'removed'
  return (
    <div className="min-w-0 space-y-2" data-side={side}>
      <p className="text-xs font-medium text-zinc-500">Versión {unit.version} · {locatorLabel(unit.locator)}</p>
      <p className="max-h-60 overflow-y-auto text-sm leading-6 break-words whitespace-pre-line text-zinc-800" data-unit-text>
        {diff
          ? diff.filter((s) => s.type !== hidden).map((s, i) =>
              s.type === 'equal' ? <span key={i}>{s.text}</span>
                : s.type === 'removed' ? <del key={i} className="rounded-sm bg-red-100 text-red-900">{s.text}</del>
                  : <ins key={i} className="rounded-sm bg-emerald-100 text-emerald-900 no-underline">{s.text}</ins>)
          : unit.text}
      </p>
      <ChangeSource unit={unit} />
    </div>
  )
}
