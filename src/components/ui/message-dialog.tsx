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
      className="fixed inset-x-0 bottom-0 top-9 z-[110] grid place-items-center bg-black/50 px-4"
      role={isSuccess ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby="message-dialog-title"
      aria-describedby="message-dialog-message"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[min(380px,calc(100vw-32px))] rounded-lg border border-sky-hairline bg-sky-canvas-soft p-5">
        <div className="flex items-start gap-4">
          <Icon
            size={18}
            aria-hidden="true"
            className={
              isSuccess ? 'mt-0.5 shrink-0 text-sky-success' : 'mt-0.5 shrink-0 text-sky-error'
            }
          />
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
