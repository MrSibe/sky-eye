import * as React from 'react'
import { cn } from '../../lib/utils'

export const controlClassName =
  'h-8 w-full rounded-sm border border-sky-hairline-strong bg-sky-control px-2 text-body-sm text-sky-ink outline-none transition-colors placeholder:text-sky-mute hover:border-sky-body focus:border-sky-primary disabled:cursor-not-allowed disabled:opacity-40'

interface FieldProps {
  label: string
  htmlFor?: string
  hint?: string
  className?: string
  children: React.ReactNode
}

export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-label text-sky-body">
        {label}
      </label>
      {children}
      {hint && <p className="text-label text-sky-mute">{hint}</p>}
    </div>
  )
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlClassName, className)} {...props} />
))
Input.displayName = 'Input'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(controlClassName, className)} {...props} />
))
Select.displayName = 'Select'
