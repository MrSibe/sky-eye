import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from './button'

interface MessageDialogProps {
  tone: 'success' | 'error'
  title: string
  message: string
  onClose: () => void
}

export function MessageDialog({ tone, title, message, onClose }: MessageDialogProps) {
  const isSuccess = tone === 'success'
  const Icon = isSuccess ? CheckCircle2 : AlertCircle

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[110] grid place-items-center bg-black/55 px-4 backdrop-blur-[2px]"
      role={isSuccess ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby="message-dialog-title"
      aria-describedby="message-dialog-message"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[min(380px,calc(100vw-32px))] rounded-lg border border-sky-hairline-strong bg-sky-overlay p-5 shadow-2xl">
        <div className="flex items-start gap-4">
          <div
            className={
              isSuccess
                ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-success/10 text-sky-success'
                : 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-error/10 text-sky-error'
            }
          >
            <Icon size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="message-dialog-title" className="text-[13px] font-medium text-sky-ink">
              {title}
            </h2>
            <p id="message-dialog-message" className="mt-1 text-[11px] leading-5 text-sky-body">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" size="sm" autoFocus onClick={onClose}>
            确定
          </Button>
        </div>
      </div>
    </div>
  )
}
