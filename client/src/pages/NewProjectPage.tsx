import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../components/Alert'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FolderPlusIcon } from '../components/icons'
import { PageLayout } from '../components/PageLayout'
import { ProjectForm } from '../components/projects/ProjectForm'
import { ProjectList } from '../components/projects/ProjectList'
import { ProjectPanel } from '../components/projects/ProjectPanel'
import { Section } from '../components/Section'
import { useApiResource } from '../hooks/useApiResource'
import { SECTIONS } from '../navigation'
import { setSearchParam, useSearchParam } from '../router'
import { isUnreachable } from '../services/api'
import { listProjects, type Project } from '../services/projects.service'

const loadProjects = (signal: AbortSignal) => listProjects(signal)

export function NewProjectPage() {
  const projects = useApiResource('projects', loadProjects)
  const selectedParam = useSearchParam('proyecto')
  const [formOpen, setFormOpen] = useState(false)
  const [created, setCreated] = useState<Project | null>(null)

  const list = projects.data ?? []
  // Selection lives in the URL (?proyecto=<id>) so it survives a refresh; defaults to the newest project.
  const selected = list.find((p) => p.id === selectedParam) ?? (selectedParam ? undefined : list[0])
  const unknownSelection = projects.status === 'ready' && selectedParam !== null && !selected

  const select = useCallback((id: string) => {
    setCreated(null)
    setSearchParam('proyecto', id)
  }, [])

  const openForm = () => setFormOpen(true)

  // Focus the first field once the opened form is committed to the DOM (deterministic, unlike a timer/frame).
  useEffect(() => {
    if (formOpen) document.getElementById('project-name')?.focus()
  }, [formOpen])

  const onCreated = (project: Project) => {
    setFormOpen(false)
    setCreated(project)
    setSearchParam('proyecto', project.id)
    projects.reload()
  }

  // After creating a project, move focus to it once the refreshed list includes it.
  useEffect(() => {
    if (created && selected?.id === created.id) document.getElementById('selected-project-title')?.focus()
  }, [created, selected?.id])

  const showForm = formOpen || (projects.status === 'ready' && list.length === 0)
  const headerAction = projects.status === 'ready' && list.length > 0 && !formOpen && (
    <Button onClick={openForm}>
      <FolderPlusIcon />
      Crear proyecto
    </Button>
  )

  return (
    <PageLayout section={SECTIONS.newProject} actions={headerAction}>
      {projects.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando proyectos…</p>}

      {projects.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar los proyectos" actions={<Button variant="secondary" onClick={projects.reload}>Reintentar</Button>}>
          {isUnreachable(projects.error) ? 'No se pudo conectar con el servidor. Verifica que la API esté en ejecución.' : projects.error instanceof Error ? projects.error.message : 'Error desconocido.'}
        </Alert>
      )}

      {projects.status === 'ready' && list.length === 0 && (
        <EmptyState icon={FolderPlusIcon} title="Aún no hay proyectos" description="Crea el primer proyecto con el formulario. Después podrás subir su documentación autorizada." />
      )}

      {showForm && <ProjectForm onCreated={onCreated} onCancel={list.length > 0 ? () => setFormOpen(false) : undefined} />}

      {created && <Alert tone="success" title={`Proyecto «${created.name}» creado`}>Ya puedes subir su documentación.</Alert>}

      {projects.status === 'ready' && list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Section title={`Proyectos (${list.length})`}>
            <ProjectList projects={list} selectedId={selected?.id ?? null} onSelect={select} />
          </Section>
          {selected ? (
            // Keyed so switching projects resets upload state (no message from another project is shown).
            <ProjectPanel key={selected.id} project={selected} onDocumentUploaded={projects.reload} />
          ) : (
            unknownSelection && (
              <Alert tone="error" title="Proyecto no encontrado">El proyecto indicado en la dirección no existe. Selecciona uno de la lista.</Alert>
            )
          )}
        </div>
      )}
    </PageLayout>
  )
}
