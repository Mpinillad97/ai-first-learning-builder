import { DocumentWorkspace } from '../components/analysis/DocumentWorkspace'
import { Alert } from '../components/Alert'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ArrowRightIcon, FileSearchIcon } from '../components/icons'
import { PageLayout } from '../components/PageLayout'
import { DocumentPicker, ProjectSelect } from '../components/selection/ProjectDocumentPicker'
import { useProjectDocuments } from '../hooks/useProjectDocuments'
import { useApiResource } from '../hooks/useApiResource'
import { useRememberedView } from '../hooks/useRememberedView'
import { SECTIONS } from '../navigation'
import { setSearchParams, useSearchParam } from '../router'
import { errorDetail } from '../services/api'
import { listProjects } from '../services/projects.service'

const loadProjects = (signal: AbortSignal) => listProjects(signal)

export function DocumentAnalysisPage() {
  useRememberedView('analysis:lastView', 'proyecto')
  const projectParam = useSearchParam('proyecto')
  const documentParam = useSearchParam('documento')
  const analysisParam = useSearchParam('analisis')

  const projects = useApiResource('projects', loadProjects)
  const list = projects.data ?? []
  const project = list.find((p) => p.id === projectParam) ?? (projectParam ? undefined : list[0])

  const documents = useProjectDocuments(project?.id ?? null)
  const docs = documents.data ?? []
  const document = docs.find((d) => d.id === documentParam)

  const chooseProject = (id: string) => setSearchParams({ proyecto: id, documento: null, analisis: null })
  const chooseDocument = (id: string) => setSearchParams({ proyecto: project!.id, documento: id, analisis: null })

  return (
    <PageLayout section={SECTIONS.analysis}>
      {projects.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando proyectos…</p>}
      {projects.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar los proyectos" actions={<Button variant="secondary" onClick={projects.reload}>Reintentar</Button>}>{errorDetail(projects.error)}</Alert>
      )}
      {projects.status === 'ready' && list.length === 0 && (
        <EmptyState icon={FileSearchIcon} title="No hay proyectos" description="Crea un proyecto y sube su documentación para poder analizarla."
          actions={<ButtonLink to={SECTIONS.newProject.path}>Ir a Nuevo proyecto <ArrowRightIcon /></ButtonLink>} />
      )}

      {projects.status === 'ready' && list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <ProjectSelect id="analysis-project" projects={list} selectedId={project?.id ?? null} onChange={chooseProject} />
            {!project && projectParam && <Alert tone="error" title="Proyecto no encontrado">Selecciona un proyecto de la lista.</Alert>}
            {project && <DocumentPicker project={project} documents={documents} selectedId={document?.id ?? null} onSelect={chooseDocument} listLabel="Documentos para analizar" />}
          </div>

          <div className="min-w-0">
            {document ? (
              <DocumentWorkspace key={document.id} document={document} selectedAnalysisId={analysisParam} onDocumentChanged={documents.reload} />
            ) : (
              project && documents.status === 'ready' && docs.length > 0 && (
                documentParam
                  ? <Alert tone="error" title="Documento no encontrado en este proyecto">Selecciona un documento de la lista.</Alert>
                  : <EmptyState icon={FileSearchIcon} title="Selecciona un documento" description="Elige un documento del proyecto para procesarlo, analizarlo con IA y revisar sus resultados." />
              )
            )}
          </div>
        </div>
      )}
    </PageLayout>
  )
}
