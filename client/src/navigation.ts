import type { ComponentType } from 'react'
import { CheckCircleIcon, FileSearchIcon, FolderPlusIcon, RefreshIcon, SparklesIcon, type IconProps } from './components/icons'

export interface SectionDefinition {
  path: string
  /** Sidebar label and page title. */
  label: string
  description: string
  icon: ComponentType<IconProps>
}

/** The five primary sections, in workflow order. */
export const SECTIONS = {
  newProject: {
    path: '/nuevo-proyecto',
    label: 'Nuevo proyecto',
    description: 'Crea un proyecto de aprendizaje a partir de la documentación autorizada de un producto.',
    icon: FolderPlusIcon,
  },
  analysis: {
    path: '/analisis-documental',
    label: 'Análisis documental',
    description: 'Extrae afirmaciones verificables de la documentación, con referencias exactas a la fuente original.',
    icon: FileSearchIcon,
  },
  generator: {
    path: '/generador-de-aprendizaje',
    label: 'Generador de aprendizaje',
    description: 'Genera con IA una propuesta de experiencia de aprendizaje basada únicamente en información confirmada.',
    icon: SparklesIcon,
  },
  review: {
    path: '/revision-y-aprobacion',
    label: 'Revisión y aprobación',
    description: 'Revisa, corrige y aprueba las propuestas generadas. Ninguna propuesta se publica sin aprobación humana.',
    icon: CheckCircleIcon,
  },
  updates: {
    path: '/actualizaciones',
    label: 'Actualizaciones',
    description: 'Detecta nuevas versiones de la documentación y analiza su impacto en el contenido existente.',
    icon: RefreshIcon,
  },
} as const satisfies Record<string, SectionDefinition>

export const NAVIGATION: SectionDefinition[] = Object.values(SECTIONS)

export const DEFAULT_PATH = SECTIONS.newProject.path

export const PRODUCT_NAME = 'AI-First Learning Builder'
