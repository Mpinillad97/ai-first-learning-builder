import type { StatusTone } from '../StatusIndicator'
import type { AudienceTrainingState } from '../../services/trainings.service'

export const WARNING_LABELS: Record<string, string> = {
  contradiction: 'Contradicción',
  documentation_gap: 'Información no documentada',
  pending_validation: 'Pendiente de validación',
  analysis_warning: 'Advertencia del análisis',
  proposal: 'Requiere revisión',
}

export const GENERATION_STATE: Record<AudienceTrainingState['state'], { label: string; tone: StatusTone }> = {
  not_generated: { label: 'Sin generar', tone: 'neutral' },
  generating: { label: 'Generando…', tone: 'info' },
  generated: { label: 'Generada', tone: 'success' },
  failed: { label: 'Generación fallida', tone: 'danger' },
}

export const AUDIENCE_DESCRIPTION: Record<string, string> = {
  sales: 'Descubrir necesidades, comunicar valor documentado y evitar promesas no respaldadas.',
  customer_experience: 'Explicar el funcionamiento, aclarar expectativas, resolver dudas y escalar.',
}
