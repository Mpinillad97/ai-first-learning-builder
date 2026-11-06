import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

interface FieldProps {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  maxLength: number
  value: string
}

const control =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-500'

function describedBy(id: string, hint?: string, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
}

function FieldFrame({ id, label, required, hint, error, maxLength, value, children }: FieldProps & { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-zinc-900">
          {label}
          {required ? <span className="text-red-600"> *</span> : <span className="font-normal text-zinc-500"> (opcional)</span>}
        </label>
        <span className="shrink-0 text-xs text-zinc-400 tabular-nums" aria-hidden="true">{value.length}/{maxLength}</span>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </div>
  )
}

export function TextField({ id, label, required, hint, error, maxLength, value, ...props }: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'maxLength'>) {
  return (
    <FieldFrame {...{ id, label, required, hint, error, maxLength, value }}>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} min-h-9 ${error ? 'border-red-400' : 'border-zinc-300'}`}
        {...props}
      />
    </FieldFrame>
  )
}

export function TextAreaField({ id, label, required, hint, error, maxLength, value, ...props }: FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'value' | 'maxLength'>) {
  return (
    <FieldFrame {...{ id, label, required, hint, error, maxLength, value }}>
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} resize-y ${error ? 'border-red-400' : 'border-zinc-300'}`}
        {...props}
      />
    </FieldFrame>
  )
}
