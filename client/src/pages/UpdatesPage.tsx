import { Alert } from '../components/Alert'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ArrowRightIcon, RefreshIcon } from '../components/icons'
import { PageLayout } from '../components/PageLayout'
import { DocumentPicker, ProjectSelect } from '../components/selection/ProjectDocumentPicker'
import { UpdatesWorkspace } from '../components/updates/UpdatesWorkspace'
import { useApiResource } from '../hooks/useApiResource'
import { useProjectDocuments } from '../hooks/useProjectDocuments'
import { useRememberedView } from '../hooks/useRememberedView'
import { SECTIONS } from '../navigation'
import { setSearchParams, useSearchParam } from '../router'
import { errorDetail } from '../services/api'
import { listProjects } from '../services/projects.service'

const loadProjects = (signal: AbortSignal) => listProjects(signal)

export function UpdatesPage() {
  useRememberedView('updates:lastView', 'proyecto')
  const projectParam = useSearchParam('proyecto')
  const documentParam = useSearchParam('documento')

  const projects = useApiResource('projects', loadProjects)
  const list = projects.data ?? []
  const project = list.find((p) => p.id === projectParam) ?? (projectParam ? undefined : list[0])
  const documents = useProjectDocuments(project?.id ?? null)
  const docs = documents.data ?? []
  const document = docs.find((d) => d.id === documentParam)

  const clearView = { desde: null, hasta: null, propuesta: null, impacto: null, actualizacion: null }
  const chooseProject = (id: string) => setSearchParams({ proyecto: id, documento: null, ...clearView })
  const chooseDocument = (id: string) => setSearchParams({ proyecto: project!.id, documento: id, ...clearView })

  return (
    <PageLayout section={SECTIONS.updates}>
      <Alert tone="info" title="Versiones y comparación">
        Sube nuevas versiones de un documento, compara su texto extraído, analiza con IA su impacto en una propuesta de aprendizaje y genera una actualización del contenido. Ningún cambio se aplica sin tu aprobación, y las versiones anteriores de la propuesta se conservan.
      </Alert>

      {projects.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando proyectos…</p>}
      {projects.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar los proyectos" actions={<Button variant="secondary" onClick={projects.reload}>Reintentar</Button>}>{errorDetail(projects.error)}</Alert>
      )}
      {projects.status === 'ready' && list.length === 0 && (
        <EmptyState icon={RefreshIcon} title="No hay proyectos" description="Las actualizaciones se gestionan sobre los documentos de un proyecto."
          actions={<ButtonLink to={SECTIONS.newProject.path}>Ir a Nuevo proyecto <ArrowRightIcon /></ButtonLink>} />
      )}

      {projects.status === 'ready' && list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <ProjectSelect id="updates-project" projects={list} selectedId={project?.id ?? null} onChange={chooseProject} />
            {!project && projectParam && <Alert tone="error" title="Proyecto no encontrado">Selecciona un proyecto de la lista.</Alert>}
            {project && <DocumentPicker project={project} documents={documents} selectedId={document?.id ?? null} onSelect={chooseDocument} listLabel="Documentos del proyecto para actualizaciones" />}
          </div>
          <div className="min-w-0">
            {document ? (
              <UpdatesWorkspace key={document.id} project={project!} document={document} />
            ) : (
              project && documents.status === 'ready' && docs.length > 0 && (
                documentParam
                  ? <Alert tone="error" title="Documento no encontrado en este proyecto">Selecciona un documento de la lista.</Alert>
                  : <EmptyState icon={RefreshIcon} title="Selecciona un documento" description="Elige un documento para ver sus versiones, subir una nueva y comparar cambios." />
              )
            )}
          </div>
        </div>
      )}
    </PageLayout>
  )
}
