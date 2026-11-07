import { Alert } from '../components/Alert'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ArrowRightIcon, SparklesIcon } from '../components/icons'
import { PageLayout } from '../components/PageLayout'
import { GeneratorWorkspace } from '../components/proposals/GeneratorWorkspace'
import { DocumentPicker, ProjectSelect } from '../components/selection/ProjectDocumentPicker'
import { useApiResource } from '../hooks/useApiResource'
import { useProjectDocuments } from '../hooks/useProjectDocuments'
import { useRememberedView } from '../hooks/useRememberedView'
import { SECTIONS } from '../navigation'
import { setSearchParams, useSearchParam } from '../router'
import { errorDetail } from '../services/api'
import { listProjects } from '../services/projects.service'

const loadProjects = (signal: AbortSignal) => listProjects(signal)

export function LearningGeneratorPage() {
  useRememberedView('generator:lastView', 'proyecto')
  const projectParam = useSearchParam('proyecto')
  const documentParam = useSearchParam('documento')
  const analysisParam = useSearchParam('analisis')
  const proposalParam = useSearchParam('propuesta')

  const projects = useApiResource('projects', loadProjects)
  const list = projects.data ?? []
  const project = list.find((p) => p.id === projectParam) ?? (projectParam ? undefined : list[0])
  const documents = useProjectDocuments(project?.id ?? null)
  const docs = documents.data ?? []
  const document = docs.find((d) => d.id === documentParam)

  const chooseProject = (id: string) => setSearchParams({ proyecto: id, documento: null, analisis: null, propuesta: null })
  const chooseDocument = (id: string) => setSearchParams({ proyecto: project!.id, documento: id, analisis: null, propuesta: null })

  return (
    <PageLayout section={SECTIONS.generator}>
      {projects.status === 'loading' && <p role="status" className="text-sm text-zinc-500">Cargando proyectos…</p>}
      {projects.status === 'error' && (
        <Alert tone="error" title="No se pudieron cargar los proyectos" actions={<Button variant="secondary" onClick={projects.reload}>Reintentar</Button>}>{errorDetail(projects.error)}</Alert>
      )}
      {projects.status === 'ready' && list.length === 0 && (
        <EmptyState icon={SparklesIcon} title="No hay proyectos" description="Las propuestas se generan a partir del análisis de la documentación de un proyecto."
          actions={<ButtonLink to={SECTIONS.newProject.path}>Ir a Nuevo proyecto <ArrowRightIcon /></ButtonLink>} />
      )}

      {projects.status === 'ready' && list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4" data-print-hidden>
            <ProjectSelect id="generator-project" projects={list} selectedId={project?.id ?? null} onChange={chooseProject} />
            {!project && projectParam && <Alert tone="error" title="Proyecto no encontrado">Selecciona un proyecto de la lista.</Alert>}
            {project && <DocumentPicker project={project} documents={documents} selectedId={document?.id ?? null} onSelect={chooseDocument} listLabel="Documentos del proyecto para generar" />}
          </div>
          <div className="min-w-0">
            {document && project ? (
              <GeneratorWorkspace key={document.id} document={document} projectId={project.id} analysisParam={analysisParam} proposalParam={proposalParam} />
            ) : (
              project && documents.status === 'ready' && docs.length > 0 && (
                documentParam
                  ? <Alert tone="error" title="Documento no encontrado en este proyecto">Selecciona un documento de la lista.</Alert>
                  : <EmptyState icon={SparklesIcon} title="Selecciona un documento" description="Elige un documento con un análisis completado para generar una propuesta de aprendizaje." />
              )
            )}
          </div>
        </div>
      )}
    </PageLayout>
  )
}
