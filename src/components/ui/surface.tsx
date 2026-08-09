import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 select-none items-center gap-2 border-b border-sky-hairline bg-sky-canvas-soft px-3',
        className,
      )}
      {...props}
    />
  )
}

interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  actions?: ReactNode
}

export function Panel({ title, actions, className, children, ...props }: PanelProps) {
  return (
    <section className={cn('flex min-h-0 flex-col bg-sky-canvas', className)} {...props}>
      {(title || actions) && (
        <header className="flex min-h-8 items-center justify-between gap-3 border-b border-sky-hairline bg-sky-canvas-soft px-3 py-2">
          <div className="min-w-0 text-xs font-medium text-sky-body">{title}</div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
