import { LoaderCircle } from 'lucide-react'

interface OperationDialogProps {
  title: string
  message: string
}

export function OperationDialog({ title, message }: OperationDialogProps) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[100] grid place-items-center bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operation-dialog-title"
      aria-describedby="operation-dialog-message"
    >
      <div className="flex w-[min(360px,calc(100vw-32px))] items-center gap-4 rounded-lg border border-sky-hairline-strong bg-sky-overlay px-5 py-4 shadow-2xl">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-control text-sky-primary">
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="operation-dialog-title" className="text-[13px] font-medium text-sky-ink">
            {title}
          </h2>
          <p
            id="operation-dialog-message"
            className="mt-1 truncate text-[11px] leading-4 text-sky-body"
          >
            {message}
          </p>
        </div>
      </div>
    </div>
  )
}
