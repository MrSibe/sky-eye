import { useEffect, useRef, useState } from 'react'
import { Crosshair, ScanSearch } from 'lucide-react'
import type { TargetMeasurement } from '../lib/tauri'
import { validateTrackletDesignation } from '../lib/mpcDesignation'
import { Button } from './ui/button'

interface Props {
  measurement: TargetMeasurement
  pixels?: Float32Array
  width: number
  height: number
  busy: boolean
  onConfirm: (designation: string) => void
  onCancel: () => void
}

function TargetCutout({
  measurement,
  pixels,
  width,
  height,
}: Pick<Props, 'measurement' | 'pixels' | 'width' | 'height'>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pixels || width <= 0 || height <= 0) return
    const context = canvas.getContext('2d')
    if (!context) return
    const size = 64
    const startX = Math.round(measurement.x) - size / 2
    const startY = Math.round(measurement.y) - size / 2
    const samples: number[] = []
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const imageX = startX + x
        const imageY = startY + y
        if (imageX >= 0 && imageY >= 0 && imageX < width && imageY < height) {
          const value = pixels[imageY * width + imageX]
          if (Number.isFinite(value)) samples.push(value)
        }
      }
    samples.sort((a, b) => a - b)
    const low = samples[Math.floor(samples.length * 0.05)] ?? 0
    const high = samples[Math.floor(samples.length * 0.995)] ?? low + 1
    const span = Math.max(high - low, Number.EPSILON)
    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const imageX = startX + x
        const imageY = startY + y
        const raw =
          imageX >= 0 && imageY >= 0 && imageX < width && imageY < height
            ? pixels[imageY * width + imageX]
            : low
        const value = Number.isFinite(raw)
          ? Math.max(0, Math.min(255, Math.round(((raw - low) / span) * 255)))
          : 0
        const offset = (y * size + x) * 4
        image.data[offset] = value
        image.data[offset + 1] = value
        image.data[offset + 2] = value
        image.data[offset + 3] = 255
      }
    context.putImageData(image, 0, 0)
  }, [height, measurement, pixels, width])

  return (
    <div className="relative aspect-square overflow-hidden rounded-md border border-sky-hairline-strong bg-black">
      <canvas
        ref={canvasRef}
        width={64}
        height={64}
        className="h-full w-full [image-rendering:pixelated]"
        aria-label="可疑目标局部放大图"
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-accent-yellow"
        style={{
          width: `${Math.min(50, Math.max(6, (measurement.aperture_radius_px / 32) * 100))}%`,
        }}
      />
      <span className="absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-1 font-mono text-[9px] text-white/75">
        64 × 64 px
      </span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-sky-hairline py-1.5 last:border-0">
      <span className="text-[9px] uppercase tracking-[0.12em] text-sky-mute">{label}</span>
      <span className="font-mono text-[11px] text-sky-ink">{value}</span>
    </div>
  )
}

export function SuspiciousTargetDialog({
  measurement,
  pixels,
  width,
  height,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [designation, setDesignation] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const error = designation.length > 0 ? validateTrackletDesignation(designation) : null
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const validationError = validateTrackletDesignation(designation)
    if (!validationError && !busy) onConfirm(designation.trim())
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[130] grid place-items-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspicious-target-title"
    >
      <section className="max-h-[calc(100vh-64px)] w-[min(720px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-sky-hairline bg-sky-canvas-soft">
        <header className="flex items-center gap-3 border-b border-sky-hairline px-5 py-3.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-sky-hairline bg-sky-canvas text-sky-body">
            <ScanSearch size={17} />
          </div>
          <div>
            <h2 id="suspicious-target-title" className="text-[13px] font-medium text-sky-ink">
              可疑目标确认
            </h2>
            <p className="mt-0.5 text-[9px] text-sky-mute">
              第 {measurement.frame_index + 1} 帧 · 检查定位和测量质量，命名后直接加入队列
            </p>
          </div>
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.15fr)_minmax(240px,.85fr)]">
          <TargetCutout measurement={measurement} pixels={pixels} width={width} height={height} />
          <div className="flex min-w-0 flex-col gap-3">
            <section className="rounded-md border border-sky-hairline bg-sky-canvas px-3 py-2">
              <div className="mb-1 flex items-center gap-2 border-b border-sky-hairline pb-2 text-[10px] font-medium text-sky-body">
                <Crosshair size={12} className="text-sky-body" />
                测量结果
              </div>
              <Metric
                label="X / Y"
                value={`${measurement.x.toFixed(2)} / ${measurement.y.toFixed(2)}`}
              />
              <Metric label="SNR" value={measurement.snr?.toFixed(2) ?? '—'} />
              <Metric label="Flux" value={measurement.flux.toFixed(0)} />
              <Metric
                label="FWHM"
                value={measurement.fwhm_px == null ? '—' : `${measurement.fwhm_px.toFixed(2)} px`}
              />
              <Metric label="Ellipticity" value={measurement.ellipticity?.toFixed(3) ?? '—'} />
            </section>
            <section className="rounded-md border border-sky-hairline bg-sky-canvas px-3 py-2">
              <Metric label="RA" value={measurement.ra_deg?.toFixed(7) ?? '不可用'} />
              <Metric label="Dec" value={measurement.dec_deg?.toFixed(7) ?? '不可用'} />
              <Metric
                label="UTC midpoint"
                value={measurement.midpoint_utc?.replace('T', ' ') ?? '不可用'}
              />
            </section>
            {measurement.flags.length > 0 && (
              <div className="rounded-md border border-sky-accent-yellow/30 bg-sky-accent-yellow/5 px-3 py-2 text-[9px] leading-4 text-sky-accent-yellow">
                质量标志：{measurement.flags.join(', ')}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-sky-hairline px-5 py-4">
          <label
            htmlFor="suspicious-target-designation"
            className="mb-1.5 block text-[10px] font-medium text-sky-body"
          >
            观测者临时名称 / trkSub
          </label>
          <input
            ref={inputRef}
            id="suspicious-target-designation"
            value={designation}
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDesignation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape' && !busy) onCancel()
            }}
            aria-invalid={Boolean(error)}
            aria-describedby="suspicious-target-help"
            placeholder="例如 SKY001"
            className={`h-10 w-full rounded-md border bg-sky-canvas px-3 font-mono text-[13px] tracking-[0.08em] text-sky-ink outline-none transition-colors placeholder:tracking-normal placeholder:text-sky-mute ${error ? 'border-sky-error focus:border-sky-error' : 'border-sky-hairline-strong focus:border-sky-accent-yellow'}`}
          />
          <div
            id="suspicious-target-help"
            className={`mt-2 min-h-4 text-[9px] leading-4 ${error ? 'text-sky-error' : 'text-sky-mute'}`}
          >
            {error ??
              '1–7 个 ASCII 字母或数字；不同目标使用不同名称，同一目标的多帧观测使用相同名称。'}
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-sky-hairline bg-sky-canvas-soft px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            取消本次标记
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={busy || Boolean(validateTrackletDesignation(designation))}
          >
            {busy ? '正在加入…' : '加入可疑目标队列'}
          </Button>
        </footer>
      </section>
    </div>
  )
}
