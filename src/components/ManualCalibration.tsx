import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FlipHorizontal2,
  RotateCcw,
  ScanSearch,
  X,
} from 'lucide-react'
import type { ManualCalibrationSeed } from '../lib/tauri'
import type { DetectedStar, GaiaSource } from '../types/phase2'
import { useFitsStore } from '../stores/fitsStore'
import { Button } from './ui/button'
import { Field, Input } from './ui/form'

export interface ManualCalibrationState {
  sources: GaiaSource[]
  seed: ManualCalibrationSeed
  imageCandidateLimit: number
}

interface OverlayProps {
  width: number
  height: number
  calibration: ManualCalibrationState
  onOffsetChange: (x: number, y: number) => void
}

interface PanelProps {
  calibration: ManualCalibrationState
  approximateMatches: number
  busy: boolean
  onChange: (seed: ManualCalibrationSeed) => void
  onApply: () => void
  onClose: () => void
}

interface SeedWcs {
  crpix1: number
  crpix2: number
  crval1: number
  crval2: number
  cd1_1: number
  cd1_2: number
  cd2_1: number
  cd2_2: number
}

function seedWcs(seed: ManualCalibrationSeed, width: number, height: number): SeedWcs {
  const scale = seed.pixel_scale_arcsec / 3600
  const angle = (seed.rotation_deg * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const matrix = seed.parity_flipped
    ? [scale * cosine, scale * sine, scale * sine, -scale * cosine]
    : [scale * cosine, -scale * sine, scale * sine, scale * cosine]
  return {
    crpix1: width / 2 + seed.offset_x_px,
    crpix2: height / 2 + seed.offset_y_px,
    crval1: seed.center_ra_deg,
    crval2: seed.center_dec_deg,
    cd1_1: matrix[0],
    cd1_2: matrix[1],
    cd2_1: matrix[2],
    cd2_2: matrix[3],
  }
}

function skyToPixel(wcs: SeedWcs, raDeg: number, decDeg: number): [number, number] {
  const ra = (raDeg * Math.PI) / 180
  const dec = (decDeg * Math.PI) / 180
  const ra0 = (wcs.crval1 * Math.PI) / 180
  const dec0 = (wcs.crval2 * Math.PI) / 180
  const deltaRa = ra - ra0
  const denominator =
    Math.sin(dec) * Math.sin(dec0) + Math.cos(dec) * Math.cos(dec0) * Math.cos(deltaRa)
  if (denominator <= 0) return [Number.NaN, Number.NaN]
  const xi = (((Math.cos(dec) * Math.sin(deltaRa)) / denominator) * 180) / Math.PI
  const eta =
    (((Math.sin(dec) * Math.cos(dec0) - Math.cos(dec) * Math.sin(dec0) * Math.cos(deltaRa)) /
      denominator) *
      180) /
    Math.PI
  const determinant = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1
  if (Math.abs(determinant) < 1e-15) return [Number.NaN, Number.NaN]
  return [
    wcs.crpix1 + (wcs.cd2_2 * xi - wcs.cd1_2 * eta) / determinant,
    wcs.crpix2 + (-wcs.cd2_1 * xi + wcs.cd1_1 * eta) / determinant,
  ]
}

export function countApproximateMatches(
  calibration: ManualCalibrationState,
  stars: DetectedStar[],
  width: number,
  height: number,
): number {
  const wcs = seedWcs(calibration.seed, width, height)
  const catalogSources = matchingCatalogSources(calibration)
  const imageSources = matchingImageSources(stars, calibration.imageCandidateLimit)
  const tolerancePx = Math.min(
    4 / calibration.seed.pixel_scale_arcsec,
    Math.max(0.8 / calibration.seed.pixel_scale_arcsec, 4),
  )
  const used = new Set<number>()
  let count = 0
  for (const source of catalogSources) {
    const [x, y] = skyToPixel(wcs, source.ra_deg, source.dec_deg)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height)
      continue
    let bestIndex = -1
    let bestDistance = tolerancePx
    imageSources.forEach((star, index) => {
      if (used.has(index)) return
      const distance = Math.hypot(star.x - x, star.y - y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    if (bestIndex >= 0) {
      used.add(bestIndex)
      count += 1
    }
  }
  return count
}

function matchingCatalogSources(calibration: ManualCalibrationState): GaiaSource[] {
  return calibration.sources
    .filter(
      (source) =>
        source.g_mag != null &&
        source.g_mag >= calibration.seed.catalog_bright_limit_mag &&
        source.g_mag <= calibration.seed.catalog_faint_limit_mag &&
        !source.duplicated_source &&
        (source.ruwe == null || source.ruwe <= 1.4) &&
        (source.astrometric_params_solved == null ||
          source.astrometric_params_solved === 31 ||
          source.astrometric_params_solved === 95),
    )
    .sort((left, right) => (left.g_mag ?? Infinity) - (right.g_mag ?? Infinity))
    .slice(0, 256)
}

function matchingImageSources(stars: DetectedStar[], limit: number): DetectedStar[] {
  return stars
    .filter(
      (star) =>
        Number.isFinite(star.x) &&
        Number.isFinite(star.y) &&
        Number.isFinite(star.flux) &&
        star.flux > 0 &&
        star.fwhm > 0.4 &&
        star.fwhm < 30 &&
        star.ellipticity < 0.65 &&
        !star.saturated,
    )
    .sort((left, right) => right.flux - left.flux)
    .slice(0, limit)
}

export function GaiaCalibrationOverlay({
  width,
  height,
  calibration,
  onOffsetChange,
}: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragOrigin = useRef<{
    clientX: number
    clientY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const zoom = useFitsStore((state) => state.zoom)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    const theme = getComputedStyle(document.documentElement)
    const ringColor = theme.getPropertyValue('--color-sky-accent-yellow').trim()
    const wcs = seedWcs(calibration.seed, width, height)
    const visibleSources = matchingCatalogSources(calibration)
    for (const source of visibleSources) {
      const [x, y] = skyToPixel(wcs, source.ra_deg, source.dec_deg)
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < -12 ||
        y < -12 ||
        x > width + 12 ||
        y > height + 12
      )
        continue
      // Gaia sources are unresolved point sources: the catalog has magnitudes,
      // not apparent disc radii. Like a star-chart overlay, encode catalog
      // brightness as ring size so the pattern is easier to recognize.
      const magnitudeSpan = Math.max(
        0.1,
        calibration.seed.catalog_faint_limit_mag - calibration.seed.catalog_bright_limit_mag,
      )
      const brightness = Math.max(
        0,
        Math.min(
          1,
          (calibration.seed.catalog_faint_limit_mag - (source.g_mag ?? 99)) / magnitudeSpan,
        ),
      )
      const radius = Math.max(3.5 + 6.5 * Math.sqrt(brightness), 4 / zoom)
      context.strokeStyle = ringColor
      context.lineWidth = 1.5 / zoom
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.stroke()
    }
  }, [calibration, height, width, zoom])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 cursor-crosshair touch-none"
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragOrigin.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          offsetX: calibration.seed.offset_x_px,
          offsetY: calibration.seed.offset_y_px,
        }
      }}
      onPointerMove={(event) => {
        event.stopPropagation()
        if (!dragOrigin.current) return
        onOffsetChange(
          dragOrigin.current.offsetX + (event.clientX - dragOrigin.current.clientX) / zoom,
          dragOrigin.current.offsetY + (event.clientY - dragOrigin.current.clientY) / zoom,
        )
      }}
      onPointerUp={() => {
        dragOrigin.current = null
      }}
      onPointerCancel={() => {
        dragOrigin.current = null
      }}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

export function ManualCalibrationPanel({
  calibration,
  approximateMatches,
  busy,
  onChange,
  onApply,
  onClose,
}: PanelProps) {
  const seed = calibration.seed
  const [nudgeStep, setNudgeStep] = useState(1)
  const update = (patch: Partial<ManualCalibrationSeed>) => onChange({ ...seed, ...patch })
  const visibleSourceCount = matchingCatalogSources(calibration).length
  return (
    <section className="absolute bottom-12 left-1/2 z-50 w-[920px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-hidden rounded-md border border-sky-hairline bg-sky-canvas-soft/95">
      <header className="flex items-center justify-between border-b border-sky-hairline bg-sky-canvas px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScanSearch size={15} className="text-sky-accent-yellow" />
          <span className="text-body-sm font-medium text-sky-ink">Gaia 人工参考星匹配</span>
          <span className="rounded-sm border border-sky-accent-yellow/40 bg-sky-accent-yellow/10 px-1.5 py-0.5 text-caption-mono text-sky-accent-yellow">
            {approximateMatches} 重合 · {visibleSourceCount}/{calibration.sources.length} Gaia
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭人工校准">
          <X size={14} />
        </Button>
      </header>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.35fr_auto] items-end gap-3 px-4 py-3">
        <Field label="比例 · arcsec/px">
          <Input
            type="number"
            step="0.01"
            value={seed.pixel_scale_arcsec.toFixed(2)}
            onChange={(event) => update({ pixel_scale_arcsec: Number(event.target.value) })}
            className="font-mono"
          />
        </Field>
        <Field label="饱和截止 · G ≥">
          <Input
            type="number"
            min="0"
            max="22"
            step="0.1"
            value={seed.catalog_bright_limit_mag}
            onChange={(event) => update({ catalog_bright_limit_mag: Number(event.target.value) })}
            className="font-mono"
            title="排除比该值更亮、可能在图像中饱和的参考星"
          />
        </Field>
        <Field label="暗星截止 · G ≤">
          <Input
            type="number"
            min="0"
            max="22"
            step="0.1"
            value={seed.catalog_faint_limit_mag}
            onChange={(event) => update({ catalog_faint_limit_mag: Number(event.target.value) })}
            className="font-mono"
            title="排除图像中无法可靠检出的暗参考星"
          />
        </Field>
        <Field label="旋转 · deg">
          <Input
            type="number"
            step="0.1"
            value={seed.rotation_deg}
            onChange={(event) => update({ rotation_deg: Number(event.target.value) })}
            className="font-mono"
          />
        </Field>
        <Field label="旋转微调">
          <input
            aria-label="旋转微调"
            type="range"
            min="-180"
            max="180"
            step="0.1"
            value={seed.rotation_deg}
            onChange={(event) => update({ rotation_deg: Number(event.target.value) })}
            className="mb-2 h-1 w-full accent-sky-accent-yellow"
          />
        </Field>
        <div className="flex gap-1">
          <Button
            variant={seed.parity_flipped ? 'primary' : 'ghost'}
            size="icon"
            onClick={() => update({ parity_flipped: !seed.parity_flipped })}
            title="水平镜像"
          >
            <FlipHorizontal2 size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => update({ offset_x_px: 0, offset_y_px: 0, rotation_deg: 0 })}
            title="重置位置和旋转"
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-sky-hairline/70 px-4 py-2">
        <span className="text-label uppercase tracking-[0.14em] text-sky-mute">位置微调</span>
        <div className="grid grid-cols-3 grid-rows-2 gap-1">
          <span />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => update({ offset_y_px: seed.offset_y_px - nudgeStep })}
            title="向上微调"
          >
            <ArrowUp size={13} />
          </Button>
          <span />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => update({ offset_x_px: seed.offset_x_px - nudgeStep })}
            title="向左微调"
          >
            <ArrowLeft size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => update({ offset_y_px: seed.offset_y_px + nudgeStep })}
            title="向下微调"
          >
            <ArrowDown size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => update({ offset_x_px: seed.offset_x_px + nudgeStep })}
            title="向右微调"
          >
            <ArrowRight size={13} />
          </Button>
        </div>
        <div className="ml-1 flex overflow-hidden rounded border border-sky-hairline">
          {[1, 5, 20].map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setNudgeStep(step)}
              className={`h-7 min-w-9 border-r border-sky-hairline px-2 text-caption-mono last:border-r-0 ${nudgeStep === step ? 'bg-sky-accent-yellow/15 text-sky-accent-yellow' : 'bg-sky-canvas-soft text-sky-body hover:text-sky-ink'}`}
            >
              {step}px
            </button>
          ))}
        </div>
        <span className="text-caption-mono text-sky-body">
          Δx {seed.offset_x_px.toFixed(1)} · Δy {seed.offset_y_px.toFixed(1)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ rotation_deg: seed.rotation_deg - 0.1 })}
          >
            −0.1°
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ rotation_deg: seed.rotation_deg + 0.1 })}
          >
            +0.1°
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ pixel_scale_arcsec: seed.pixel_scale_arcsec * 0.999 })}
          >
            −0.1%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ pixel_scale_arcsec: seed.pixel_scale_arcsec * 1.001 })}
          >
            +0.1%
          </Button>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t border-sky-hairline bg-sky-canvas-soft px-4 py-2.5">
        <p className="text-label text-sky-body">
          黄圈大小表示 Gaia G 星等的相对亮度，并非恒星真实半径；拖动或微调黄圈覆盖绿色星点。
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={onApply}
          disabled={
            busy ||
            approximateMatches < 4 ||
            seed.catalog_bright_limit_mag > seed.catalog_faint_limit_mag
          }
        >
          {busy ? '归算中…' : '确认参考星匹配并归算'}
        </Button>
      </footer>
    </section>
  )
}
