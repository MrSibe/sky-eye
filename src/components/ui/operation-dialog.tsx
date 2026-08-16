import { LoaderCircle } from 'lucide-react'

interface OperationDialogProps {
  title: string
  message: string
}

export function OperationDialog({ title, message }: OperationDialogProps) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[100] grid place-items-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operation-dialog-title"
      aria-describedby="operation-dialog-message"
    >
      <div className="flex w-[min(360px,calc(100vw-32px))] items-center gap-4 rounded-lg border border-sky-hairline bg-sky-canvas-soft px-5 py-4">
        <LoaderCircle
          size={18}
          aria-hidden="true"
          className="shrink-0 animate-spin text-sky-primary"
        />
        <div className="min-w-0 flex-1">
          <h2 id="operation-dialog-title" className="text-body-sm font-medium text-sky-ink">
            {title}
          </h2>
          <p id="operation-dialog-message" className="mt-1 truncate text-label text-sky-body">
            {message}
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sky-hairline-strong">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-primary" />
          </div>
        </div>
      </div>
    </div>
  )
}
