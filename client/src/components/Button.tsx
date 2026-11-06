import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from './Link'

export type ButtonVariant = 'primary' | 'secondary'

const base =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none',
  secondary: 'border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:text-zinc-400 disabled:hover:bg-white',
}

function buttonClasses(variant: ButtonVariant): string {
  return `${base} ${variants[variant]}`
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`${buttonClasses(variant)} ${className}`} {...props} />
}

/** A navigation action styled as a button. */
export function ButtonLink({ to, variant = 'secondary', children }: { to: string; variant?: ButtonVariant; children: ReactNode }) {
  return (
    <Link to={to} className={buttonClasses(variant)}>
      {children}
    </Link>
  )
}
