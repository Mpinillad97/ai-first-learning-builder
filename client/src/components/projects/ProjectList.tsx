import type { Project } from '../../services/projects.service'
import { formatDate } from './format'

interface ProjectListProps {
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Selectable list of real projects; the selected one is marked visually and with aria-pressed. */
export function ProjectList({ projects, selectedId, onSelect }: ProjectListProps) {
  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="Proyectos">
      {projects.map((project) => {
        const selected = project.id === selectedId
        return (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => onSelect(project.id)}
              aria-pressed={selected}
              className={`relative flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors ${selected ? 'bg-accent-50' : 'hover:bg-zinc-50'}`}
            >
              {selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-600" aria-hidden="true" />}
              <span className="w-full truncate text-sm font-medium text-zinc-900">{project.name}</span>
              <span className="w-full truncate text-xs text-zinc-600">
                {project.product} · {project.documentIds.length === 1 ? '1 documento' : `${project.documentIds.length} documentos`}
              </span>
              <span className="text-xs text-zinc-500">Creado {formatDate(project.createdAt)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
