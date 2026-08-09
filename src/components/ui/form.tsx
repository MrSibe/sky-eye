import * as React from 'react'
import { cn } from '../../lib/utils'

export const controlClassName =
  'h-8 w-full rounded-sm border border-sky-hairline-strong bg-sky-control px-2 text-[13px] text-sky-ink outline-none transition-colors placeholder:text-sky-mute hover:border-sky-body focus:border-sky-primary disabled:cursor-not-allowed disabled:opacity-40'

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
      <label htmlFor={htmlFor} className="text-[11px] font-medium leading-[14px] text-sky-body">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-4 text-sky-mute">{hint}</p>}
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
