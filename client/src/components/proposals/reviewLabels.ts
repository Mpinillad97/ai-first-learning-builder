import type { StatusTone } from '../StatusIndicator'
import type { ReviewStatus } from '../../services/review.service'

/** Spanish labels for a proposal's effective review status. */
export const REVIEW_STATUS: Record<ReviewStatus | 'unavailable', { label: string; short: string; tone: StatusTone }> = {
  pending_review: { label: 'Borrador · requiere revisión humana', short: 'Pendiente de revisión', tone: 'info' },
  approved: { label: 'Aprobada por revisión humana', short: 'Aprobada', tone: 'success' },
  rejected: { label: 'Rechazada en revisión humana', short: 'Rechazada', tone: 'danger' },
  not_reviewable: { label: 'Fallido · no revisable', short: 'Fallida', tone: 'danger' },
  unavailable: { label: 'Estado de revisión no disponible', short: 'Estado no disponible', tone: 'warning' },
}
