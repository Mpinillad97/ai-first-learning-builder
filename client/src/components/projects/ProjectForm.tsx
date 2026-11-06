import { useRef, useState, type FormEvent } from 'react'
import { isUnreachable } from '../../services/api'
import { createProject, PROJECT_FIELD_LIMITS, type Project, type ProjectInput } from '../../services/projects.service'
import { Alert } from '../Alert'
import { Button } from '../Button'
import { TextAreaField, TextField } from '../FormField'

const EMPTY: ProjectInput = { name: '', product: '', audience: '', learningObjective: '', context: '' }
type Errors = Partial<Record<keyof ProjectInput, string>>

/** Same rules as the backend: name and product required, all fields within their length limits. */
function validate(input: ProjectInput): Errors {
  const errors: Errors = {}
  if (!input.name.trim()) errors.name = 'Escribe un nombre para el proyecto.'
  if (!input.product.trim()) errors.product = 'Indica el producto sobre el que trata el proyecto.'
  for (const field of Object.keys(PROJECT_FIELD_LIMITS) as (keyof ProjectInput)[]) {
    if (!errors[field] && input[field].trim().length > PROJECT_FIELD_LIMITS[field]) errors[field] = `Máximo ${PROJECT_FIELD_LIMITS[field]} caracteres.`
  }
  return errors
}

interface ProjectFormProps {
  onCreated: (project: Project) => void
  onCancel?: () => void
}

export function ProjectForm({ onCreated, onCancel }: ProjectFormProps) {
  const [values, setValues] = useState<ProjectInput>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const set = (field: keyof ProjectInput) => (event: { target: { value: string } }) => {
    const value = event.target.value
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: validate({ ...values, [field]: value })[field] }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    setApiError(null)
    const firstInvalid = (Object.keys(EMPTY) as (keyof ProjectInput)[]).find((f) => found[f])
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`#project-${firstInvalid}`)?.focus()
      return
    }
    setSubmitting(true)
    try {
      const project = await createProject({
        name: values.name.trim(),
        product: values.product.trim(),
        audience: values.audience.trim(),
        learningObjective: values.learningObjective.trim(),
        context: values.context.trim(),
      })
      setValues(EMPTY)
      onCreated(project)
    } catch (error) {
      setApiError(isUnreachable(error) ? 'No se pudo conectar con el servidor. Verifica que la API esté en ejecución.' : error instanceof Error ? error.message : 'Error desconocido.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="create-project-title" className="space-y-5 rounded-lg border border-zinc-200 bg-white p-4 sm:p-6">
      <div>
        <h2 id="create-project-title" className="text-base font-semibold text-zinc-900">Crear proyecto</h2>
        <p className="mt-1 text-sm text-zinc-600">Los campos marcados con * son obligatorios.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="project-name" label="Nombre del proyecto" required maxLength={PROJECT_FIELD_LIMITS.name} value={values.name} onChange={set('name')} error={errors.name} disabled={submitting} autoComplete="off" />
        <TextField id="project-product" label="Producto" required maxLength={PROJECT_FIELD_LIMITS.product} value={values.product} onChange={set('product')} error={errors.product} disabled={submitting} hint="Producto cuya documentación se usará." />
        <div className="sm:col-span-2">
          <TextField id="project-audience" label="Audiencia" maxLength={PROJECT_FIELD_LIMITS.audience} value={values.audience} onChange={set('audience')} error={errors.audience} disabled={submitting} hint="Quién realizará la experiencia de aprendizaje." />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField id="project-learningObjective" label="Objetivo de aprendizaje" maxLength={PROJECT_FIELD_LIMITS.learningObjective} value={values.learningObjective} onChange={set('learningObjective')} error={errors.learningObjective} disabled={submitting} />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField id="project-context" label="Contexto" maxLength={PROJECT_FIELD_LIMITS.context} value={values.context} onChange={set('context')} error={errors.context} disabled={submitting} hint="Información adicional útil para el equipo." />
        </div>
      </div>
      {apiError && <Alert tone="error" title="No se pudo crear el proyecto">{apiError}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Creando proyecto…' : 'Crear proyecto'}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}
