import type { StatusTone } from '../StatusIndicator'
import type { DocumentStatus } from '../../services/projects.service'

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

export const formatDate = (iso: string): string => dateFormat.format(new Date(iso))

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const formatLabel = (extension: string): string => extension.replace(/^\./, '').toUpperCase()

export const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; tone: StatusTone }> = {
  uploaded: { label: 'Cargado, sin procesar', tone: 'neutral' },
  processing: { label: 'Procesando', tone: 'info' },
  processed: { label: 'Procesado', tone: 'success' },
  failed: { label: 'Error al procesar', tone: 'danger' },
}
