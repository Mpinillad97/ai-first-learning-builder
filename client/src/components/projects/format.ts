import type { StatusTone } from '../StatusIndicator'
import { UPLOAD_RULES, type DocumentStatus } from '../../services/projects.service'

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

export const formatDate = (iso: string): string => dateFormat.format(new Date(iso))

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Client-side upload checks mirroring the backend rules (the backend still validates everything). */
export function checkFile(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!file.name.includes('.') || !(UPLOAD_RULES.extensions as readonly string[]).includes(extension)) return 'Solo se aceptan archivos PDF o DOCX.'
  if (file.size === 0) return 'El archivo está vacío.'
  if (file.size > UPLOAD_RULES.maxBytes) return `El archivo pesa ${formatBytes(file.size)}; el máximo es 15 MB.`
  return null
}

export const formatLabel =(extension: string): string => extension.replace(/^\./, '').toUpperCase()

export const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; tone: StatusTone }> = {
  uploaded: { label: 'Cargado, sin procesar', tone: 'neutral' },
  processing: { label: 'Procesando', tone: 'info' },
  processed: { label: 'Procesado', tone: 'success' },
  failed: { label: 'Error al procesar', tone: 'danger' },
}
