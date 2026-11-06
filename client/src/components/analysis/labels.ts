import type { StatusTone } from '../StatusIndicator'
import type { SourceLocator } from '../../services/analysis.service'

export const CLAIM_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  confirmed: { label: 'Confirmada', tone: 'success' },
  pending_validation: { label: 'Pendiente de validación', tone: 'warning' },
}

export const SEVERITY: Record<string, { label: string; tone: StatusTone }> = {
  high: { label: 'Severidad alta', tone: 'danger' },
  medium: { label: 'Severidad media', tone: 'warning' },
  low: { label: 'Severidad baja', tone: 'neutral' },
}

export const GAP_CATEGORY: Record<string, string> = {
  limitations: 'Limitaciones',
  integrations: 'Integraciones',
  preconditions: 'Requisitos previos',
  user_responsibilities: 'Responsabilidades del usuario',
  error_handling: 'Manejo de errores',
  expected_outcomes: 'Resultados esperados',
  other: 'Otro',
}

export const REJECTION_CATEGORY: Record<string, string> = {
  malformed: 'Estructura inválida',
  missing_evidence: 'Sin evidencia',
  invalid_reference: 'Referencia inválida',
  unverified_quote: 'Cita no verificable',
  unsupported_detail: 'Detalle no respaldado',
  overreach: 'Excede lo documentado',
}

/** "Página 3" or "Párrafo 6" (DOCX positions are 0-based in the data; shown 1-based to people). */
export function locatorLabel(locator: SourceLocator): string {
  return locator.type === 'pdf-page' ? `Página ${locator.pageNumber}` : `Párrafo ${locator.paragraphIndex + 1}`
}

export const shortId = (id: string): string => id.replace(/^ext_/, '').slice(0, 8)

/** "1 contradicción" / "2 contradicciones". */
export const plural = (count: number, singular: string, pluralForm: string): string => `${count} ${count === 1 ? singular : pluralForm}`
