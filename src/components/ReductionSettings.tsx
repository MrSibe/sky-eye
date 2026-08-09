import { useEffect, useState } from 'react'
import { CircleAlert, X } from 'lucide-react'
import type { SolveParams } from '../lib/tauri'
import type { FrameMeta } from '../types/phase2'
import { Button } from './ui/button'
import { Field, Input, Select } from './ui/form'

interface ReductionSettingsProps {
  frame: FrameMeta
  busy: boolean
  onClose: () => void
  onSubmit: (params: SolveParams) => void
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function ReductionSettings({ frame, busy, onClose, onSubmit }: ReductionSettingsProps) {
  const [ra, setRa] = useState('')
  const [dec, setDec] = useState('')
  const [scale, setScale] = useState('')
  const [rotation, setRotation] = useState('')
  const [radius, setRadius] = useState('')
  const [brightLimit, setBrightLimit] = useState('5')
  const [faintLimit, setFaintLimit] = useState('18')
  const [parity, setParity] = useState<'auto' | 'normal' | 'flipped'>('auto')

  useEffect(() => {
    setRa(frame.ra?.toString() ?? '')
    setDec(frame.dec?.toString() ?? '')
    setScale(frame.pixel_scale_arcsec?.toFixed(4) ?? '')
    setRotation(frame.rotation_deg?.toFixed(2) ?? '')
    setRadius('')
    setBrightLimit('5')
    setFaintLimit('18')
    setParity(frame.parity_flipped == null ? 'auto' : frame.parity_flipped ? 'flipped' : 'normal')
  }, [frame])

  const submit = () => {
    const params: SolveParams = {
      center_ra_deg: optionalNumber(ra),
      center_dec_deg: optionalNumber(dec),
      pixel_scale_arcsec: optionalNumber(scale),
      rotation_deg: optionalNumber(rotation),
      radius_deg: optionalNumber(radius),
      parity_flipped: parity === 'auto' ? undefined : parity === 'flipped',
      catalog_bright_limit_mag: optionalNumber(brightLimit),
      catalog_faint_limit_mag: optionalNumber(faintLimit),
    }
    onSubmit(params)
  }
  const magnitudeRangeValid =
    optionalNumber(brightLimit) == null ||
    optionalNumber(faintLimit) == null ||
    optionalNumber(brightLimit)! <= optionalNumber(faintLimit)!

  return (
    <section
      aria-labelledby="reduction-settings-title"
      className="absolute left-20 top-[43px] z-40 w-[390px] overflow-hidden rounded-lg border border-sky-hairline-strong bg-sky-overlay shadow-xl"
    >
      <header className="flex items-start justify-between border-b border-sky-hairline px-4 py-3">
        <div>
          <div
            id="reduction-settings-title"
            className="flex items-center gap-2 text-sm font-medium text-sky-ink"
          >
            <CircleAlert size={15} className="text-sky-warning" />
            归算需要人工初值
          </div>
          <p className="mt-1 text-[11px] leading-4 text-sky-body">
            自动归算未获得足够信息。补充必要初值后将继续归算。
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭归算参数">
          <X size={14} />
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 px-4 py-4">
        <Field label="中心 RA · deg">
          <Input
            className="font-mono"
            value={ra}
            onChange={(event) => setRa(event.target.value)}
            placeholder="例如 3.05999"
          />
        </Field>
        <Field label="中心 Dec · deg">
          <Input
            className="font-mono"
            value={dec}
            onChange={(event) => setDec(event.target.value)}
            placeholder="例如 -11.370018"
          />
        </Field>
        <Field label="像素比例 · arcsec/px">
          <Input
            className="font-mono"
            value={scale}
            onChange={(event) => setScale(event.target.value)}
            placeholder="建议填写"
          />
        </Field>
        <Field label="旋转角 · deg">
          <Input
            className="font-mono"
            value={rotation}
            onChange={(event) => setRotation(event.target.value)}
            placeholder="可选"
          />
        </Field>
        <Field label="查询半径 · deg">
          <Input
            className="font-mono"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            placeholder="按比例自动计算"
          />
        </Field>
        <Field label="镜像方向">
          <Select
            className="font-mono"
            value={parity}
            onChange={(event) => setParity(event.target.value as typeof parity)}
          >
            <option value="auto">自动尝试</option>
            <option value="normal">正常</option>
            <option value="flipped">镜像</option>
          </Select>
        </Field>
        <Field label="饱和截止 · G ≥">
          <Input
            className="font-mono"
            value={brightLimit}
            onChange={(event) => setBrightLimit(event.target.value)}
            placeholder="5.0"
            title="排除比该值更亮、可能已经饱和的 Gaia 星"
          />
        </Field>
        <Field label="暗星截止 · G ≤">
          <Input
            className="font-mono"
            value={faintLimit}
            onChange={(event) => setFaintLimit(event.target.value)}
            placeholder="18.0"
            title="排除图像中可能无法可靠检出的 Gaia 暗星"
          />
        </Field>
      </div>

      <footer className="flex items-center justify-between border-t border-sky-hairline bg-sky-canvas-soft px-4 py-3">
        <span className="max-w-[210px] truncate font-mono text-[10px] text-sky-mute">
          {frame.label}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={
            busy ||
            optionalNumber(ra) == null ||
            optionalNumber(dec) == null ||
            !magnitudeRangeValid
          }
        >
          {busy ? '归算中…' : '继续归算'}
        </Button>
      </footer>
    </section>
  )
}
