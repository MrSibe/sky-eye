import { useRef, useEffect, useCallback, useState, useImperativeHandle } from 'react'
import { useFitsStore } from '../../stores/fitsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { GaiaCalibrationOverlay, type ManualCalibrationState } from '../ManualCalibration'
import type { EphemerisPoint, TargetMeasurement } from '../../lib/tauri'
import type { WCS } from '../../types/phase2'
import { zscale } from '../../lib/stretch'
import { createFrameRenderer, type FrameRenderer } from './fitsRenderer'

interface FITSViewerProps {
  ref?: React.Ref<FITSViewerHandle>
  stretchMode?: 'linear' | 'asinh'
  inverted?: boolean
  manualCalibration?: ManualCalibrationState | null
  onManualOffsetChange?: (x: number, y: number) => void
  measureEnabled?: boolean
  onMeasure?: (x: number, y: number) => void
  measurements?: TargetMeasurement[]
  knownObjects?: EphemerisPoint[]
}

export interface FITSViewerHandle {
  /** 只上传 index 帧纹理、不改变显示帧(顺序预热用)。 */
  prewarmFrame: (index: number) => void
}

interface CursorMeasurement {
  x: number
  y: number
  value: number
  ra?: number
  dec?: number
}

const MIN_VISIBLE_IMAGE_PX = 24
const MAX_VISIBLE_IMAGE_PX = 64

export function clampImagePan(
  panX: number,
  panY: number,
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
) {
  const scaledWidth = imageWidth * zoom
  const scaledHeight = imageHeight * zoom
  const requiredVisibleWidth = Math.min(
    scaledWidth,
    MAX_VISIBLE_IMAGE_PX,
    Math.max(MIN_VISIBLE_IMAGE_PX, scaledWidth * 0.2),
  )
  const requiredVisibleHeight = Math.min(
    scaledHeight,
    MAX_VISIBLE_IMAGE_PX,
    Math.max(MIN_VISIBLE_IMAGE_PX, scaledHeight * 0.2),
  )
  const maxPanX = Math.max(0, (viewportWidth + scaledWidth) / 2 - requiredVisibleWidth)
  const maxPanY = Math.max(0, (viewportHeight + scaledHeight) / 2 - requiredVisibleHeight)
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
    y: Math.max(-maxPanY, Math.min(maxPanY, panY)),
  }
}

export function pixelToSky(x: number, y: number, wcs: WCS) {
  const dx = x - wcs.crpix1
  const dy = y - wcs.crpix2
  const xi = ((wcs.cd1_1 * dx + wcs.cd1_2 * dy) * Math.PI) / 180
  const eta = ((wcs.cd2_1 * dx + wcs.cd2_2 * dy) * Math.PI) / 180
  const ra0 = (wcs.crval1 * Math.PI) / 180
  const dec0 = (wcs.crval2 * Math.PI) / 180
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0)
  const raRadians = ra0 + Math.atan2(xi, denominator)
  const decRadians = Math.atan2(
    Math.sin(dec0) + eta * Math.cos(dec0),
    Math.sqrt(denominator * denominator + xi * xi),
  )
  return {
    ra: ((((raRadians * 180) / Math.PI) % 360) + 360) % 360,
    dec: (decRadians * 180) / Math.PI,
  }
}
export function skyToPixel(ra: number, dec: number, wcs: WCS) {
  const r = (ra * Math.PI) / 180,
    d = (dec * Math.PI) / 180,
    r0 = (wcs.crval1 * Math.PI) / 180,
    d0 = (wcs.crval2 * Math.PI) / 180,
    dr = r - r0
  const den = Math.sin(d) * Math.sin(d0) + Math.cos(d) * Math.cos(d0) * Math.cos(dr)
  if (den <= 0) return null
  const xi = (((Math.cos(d) * Math.sin(dr)) / den) * 180) / Math.PI,
    eta =
      (((Math.sin(d) * Math.cos(d0) - Math.cos(d) * Math.sin(d0) * Math.cos(dr)) / den) * 180) /
      Math.PI
  const det = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1
  if (Math.abs(det) < 1e-15) return null
  return {
    x: wcs.crpix1 + (wcs.cd2_2 * xi - wcs.cd1_2 * eta) / det,
    y: wcs.crpix2 + (-wcs.cd2_1 * xi + wcs.cd1_1 * eta) / det,
  }
}

export function FITSViewer({
  ref,
  stretchMode = 'linear',
  inverted = true,
  manualCalibration,
  onManualOffsetChange,
  measureEnabled = false,
  onMeasure,
  measurements = [],
  knownObjects = [],
}: FITSViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<FrameRenderer | null>(null)
  const [glEpoch, setGlEpoch] = useState(0)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const cursorImagePos = useRef<{ x: number; y: number } | null>(null)
  const [cursorMeasurement, setCursorMeasurement] = useState<CursorMeasurement | null>(null)

  const {
    zoom,
    panX,
    panY,
    fitRequest,
    stretchLimits,
    setZoom,
    setPan,
    resetView,
    setStretchLimits,
  } = useFitsStore()

  // 显示数据源:当前帧像素(来自 sessionStore.framePixels),不再经过 fitsStore.rawPixels
  const currentFrameIndex = useSessionStore((s) => s.currentFrameIndex)
  const currentFrame = useSessionStore((s) => s.framePixels[currentFrameIndex])
  const wcs = useSessionStore((s) => s.wcs)
  const solveSuccess = useSessionStore((s) => s.solveSuccess)
  const blinkAlignment = useSessionStore((s) => s.blinkAlignment)
  const blinkReferenceIndex = useSessionStore((s) => s.blinkReferenceIndex)
  const setBlinkAlignment = useSessionStore((s) => s.setBlinkAlignment)
  const referenceFrameMeta = useSessionStore((s) =>
    blinkReferenceIndex == null ? undefined : s.frames[blinkReferenceIndex],
  )
  const referenceWcs = useSessionStore((s) =>
    blinkReferenceIndex == null
      ? null
      : (s.frameAnalyses[blinkReferenceIndex]?.solution?.wcs ?? null),
  )
  const alignmentActive = blinkAlignment === 'wcs' && !!referenceWcs && !!wcs

  const sourceWidth = currentFrame?.width ?? 0
  const sourceHeight = currentFrame?.height ?? 0
  const imageWidth = alignmentActive ? (referenceFrameMeta?.width ?? 0) : sourceWidth
  const imageHeight = alignmentActive ? (referenceFrameMeta?.height ?? 0) : sourceHeight
  const hasImage = !!currentFrame

  useEffect(() => {
    if (blinkAlignment !== 'wcs') return
    if (blinkReferenceIndex == null || !referenceWcs || !wcs) {
      setBlinkAlignment('raw')
    }
  }, [blinkAlignment, blinkReferenceIndex, referenceWcs, setBlinkAlignment, wcs])

  // 命令式 handle:顺序预热期间只上传纹理,不切换显示帧
  useImperativeHandle(
    ref,
    () => ({
      prewarmFrame: (index: number) => {
        const s = useSessionStore.getState()
        const frame = s.framePixels[index]
        const renderer = rendererRef.current
        if (!frame || !renderer) return
        renderer.prewarm(`${s.sessionId}:${index}`, frame.pixels, frame.width, frame.height)
      },
    }),
    [],
  )

  useEffect(() => {
    if (!imageWidth || !imageHeight || !containerRef.current) return
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const scaleX = cw / imageWidth
    const scaleY = ch / imageHeight
    resetView()
    setZoom(Math.max(0.1, Math.min(scaleX, scaleY, 2)))
  }, [fitRequest, imageHeight, imageWidth, resetView, setZoom])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !imageWidth || !imageHeight) return

    const keepImageReachable = () => {
      const state = useFitsStore.getState()
      const next = clampImagePan(
        state.panX,
        state.panY,
        container.clientWidth,
        container.clientHeight,
        imageWidth,
        imageHeight,
        state.zoom,
      )
      if (next.x !== state.panX || next.y !== state.panY) {
        state.setPan(next.x, next.y)
      }
    }

    keepImageReachable()
    const observer = new ResizeObserver(keepImageReachable)
    observer.observe(container)
    return () => observer.disconnect()
  }, [imageHeight, imageWidth, zoom])

  // WebGL 生命周期独立于当前帧:canvas 稳定挂载,仅在有图/context 恢复时(重建)创建 renderer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !hasImage) return
    const renderer = createFrameRenderer(canvas, imageWidth, imageHeight, () =>
      setGlEpoch((epoch) => epoch + 1),
    )
    rendererRef.current = renderer
    return () => {
      if (rendererRef.current === renderer) rendererRef.current = null
      renderer.dispose()
    }
  }, [glEpoch, hasImage, imageHeight, imageWidth])

  // 播放热路径:每 tick 只走 bindTexture + setUniforms + drawArrays,零上传/零编译
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !currentFrame) return
    const limits =
      stretchLimits ?? zscale(currentFrame.pixels, currentFrame.width, currentFrame.height)
    if (!stretchLimits) setStretchLimits(limits)
    const s = useSessionStore.getState()
    renderer.showFrame({
      key: `${s.sessionId}:${currentFrameIndex}`,
      pixels: currentFrame.pixels,
      width: currentFrame.width,
      height: currentFrame.height,
      z1: limits.z1,
      z2: limits.z2,
      stretchMode,
      inverted,
      alignment:
        alignmentActive && referenceWcs && wcs
          ? {
              reference: referenceWcs,
              source: wcs,
              outputWidth: imageWidth,
              outputHeight: imageHeight,
            }
          : undefined,
    })
  }, [
    alignmentActive,
    currentFrame,
    currentFrameIndex,
    glEpoch,
    imageHeight,
    imageWidth,
    inverted,
    referenceWcs,
    setStretchLimits,
    stretchLimits,
    stretchMode,
    wcs,
  ])

  const displayToSource = useCallback(
    (x: number, y: number) => {
      if (!alignmentActive || !referenceWcs || !wcs) return { x, y }
      const sky = pixelToSky(x, y, referenceWcs)
      return skyToPixel(sky.ra, sky.dec, wcs)
    },
    [alignmentActive, referenceWcs, wcs],
  )

  const sourceToDisplay = useCallback(
    (x: number, y: number) => {
      if (!alignmentActive || !referenceWcs || !wcs) return { x, y }
      const sky = pixelToSky(x, y, wcs)
      return skyToPixel(sky.ra, sky.dec, referenceWcs)
    },
    [alignmentActive, referenceWcs, wcs],
  )

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(Math.max(0.1, Math.min(50, zoom * delta)))
    },
    [zoom, setZoom],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return
    e.preventDefault()
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const updateCursorMeasurement = useCallback(
    (x: number, y: number) => {
      const frame = useSessionStore.getState().framePixels[currentFrameIndex]
      if (!frame) {
        setCursorMeasurement(null)
        return
      }
      const source = displayToSource(x, y)
      if (!source) {
        setCursorMeasurement(null)
        return
      }
      const pixelX = Math.floor(source.x)
      const pixelY = Math.floor(source.y)
      if (pixelX >= 0 && pixelX < sourceWidth && pixelY >= 0 && pixelY < sourceHeight) {
        const sky = wcs && solveSuccess ? pixelToSky(source.x, source.y, wcs) : null
        setCursorMeasurement({
          x: source.x,
          y: source.y,
          value: frame.pixels[pixelY * sourceWidth + pixelX],
          ...(sky ?? {}),
        })
      } else {
        setCursorMeasurement(null)
      }
    },
    [currentFrameIndex, displayToSource, solveSuccess, sourceHeight, sourceWidth, wcs],
  )

  useEffect(() => {
    const position = cursorImagePos.current
    if (position) updateCursorMeasurement(position.x, position.y)
  }, [updateCursorMeasurement])

  const handleImagePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!imageWidth || !imageHeight) return
      const bounds = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - bounds.left) * imageWidth) / bounds.width
      const y = ((e.clientY - bounds.top) * imageHeight) / bounds.height
      cursorImagePos.current = { x, y }
      updateCursorMeasurement(x, y)
    },
    [imageHeight, imageWidth, updateCursorMeasurement],
  )

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isDragging.current) {
        const dx = e.clientX - lastPos.current.x
        const dy = e.clientY - lastPos.current.y
        lastPos.current = { x: e.clientX, y: e.clientY }
        const container = containerRef.current
        if (!container || !imageWidth || !imageHeight) return
        const next = clampImagePan(
          panX + dx,
          panY + dy,
          container.clientWidth,
          container.clientHeight,
          imageWidth,
          imageHeight,
          zoom,
        )
        setPan(next.x, next.y)
      }
    },
    [imageHeight, imageWidth, panX, panY, setPan, zoom],
  )

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!measureEnabled || !onMeasure || !imageWidth || !imageHeight) return
      const b = e.currentTarget.getBoundingClientRect()
      const source = displayToSource(
        ((e.clientX - b.left) * imageWidth) / b.width,
        ((e.clientY - b.top) * imageHeight) / b.height,
      )
      if (source) onMeasure(source.x, source.y)
    },
    [displayToSource, imageHeight, imageWidth, measureEnabled, onMeasure],
  )

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-sky-canvas-viewer"
      onPointerDown={handlePointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* canvas 稳定挂载:无图时 visibility hidden,不清除 WebGL context */}
      <div
        className="absolute cursor-crosshair"
        style={{
          // Keep the canvas centered in screen coordinates before scaling.
          // Negative margins used here previously stayed at the unscaled
          // FITS size and moved large images completely outside the viewport.
          transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
          transformOrigin: 'center center',
          left: '50%',
          top: '50%',
          width: imageWidth,
          height: imageHeight,
          visibility: hasImage ? 'visible' : 'hidden',
        }}
        onPointerMove={handleImagePointerMove}
        onClick={handleClick}
        onPointerLeave={() => {
          cursorImagePos.current = null
          setCursorMeasurement(null)
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {hasImage && manualCalibration && onManualOffsetChange && (
          <GaiaCalibrationOverlay
            width={imageWidth}
            height={imageHeight}
            calibration={manualCalibration}
            onOffsetChange={onManualOffsetChange}
          />
        )}
        {hasImage && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          >
            {measurements
              .filter((m) => m.frame_index === currentFrameIndex)
              .map((m) => ({ measurement: m, point: sourceToDisplay(m.x, m.y) }))
              .filter((entry) => entry.point)
              .map(({ measurement: m, point }) => (
                <g key={m.id} opacity={m.stale ? 0.45 : 1}>
                  <circle
                    cx={point!.x}
                    cy={point!.y}
                    r={Math.max(4 / zoom, m.aperture_radius_px)}
                    fill="none"
                    stroke={m.stale ? 'var(--color-sky-accent-yellow)' : 'var(--color-sky-primary)'}
                    strokeWidth={1.5 / zoom}
                  />
                </g>
              ))}
            {(alignmentActive ? referenceWcs : wcs) &&
              knownObjects.map((o) => {
                const overlayWcs = alignmentActive ? referenceWcs! : wcs!
                const p = skyToPixel(o.ra_deg, o.dec_deg, overlayWcs)
                return p && p.x >= 0 && p.y >= 0 && p.x < imageWidth && p.y < imageHeight ? (
                  <g key={o.designation}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={10 / zoom}
                      fill="none"
                      stroke={
                        o.quality !== 'degraded_time'
                          ? 'var(--color-sky-accent-green)'
                          : 'var(--color-sky-accent-yellow)'
                      }
                      strokeWidth={1.4 / zoom}
                    />
                    <text
                      x={p.x + 12 / zoom}
                      y={p.y - 8 / zoom}
                      fontSize={11 / zoom}
                      fill={
                        o.quality !== 'degraded_time'
                          ? 'var(--color-sky-accent-green)'
                          : 'var(--color-sky-accent-yellow)'
                      }
                    >
                      {o.designation}
                    </text>
                  </g>
                ) : null
              })}
          </svg>
        )}
      </div>
      {!hasImage && (
        <div className="absolute inset-0 flex items-center justify-center text-sky-mute select-none">
          <div className="text-center">
            <p className="text-body-lg mb-2">打开 FITS 文件开始</p>
          </div>
        </div>
      )}
      {hasImage && cursorMeasurement && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded bg-sky-canvas/85 px-2 py-1 text-caption-mono text-sky-body backdrop-blur-sm">
          <span>X {cursorMeasurement.x.toFixed(1)}</span>
          <span>Y {cursorMeasurement.y.toFixed(1)}</span>
          <span>
            L {Number.isFinite(cursorMeasurement.value) ? cursorMeasurement.value.toFixed(2) : '—'}
          </span>
          {cursorMeasurement.ra != null && cursorMeasurement.dec != null && (
            <>
              <span className="h-3 w-px bg-sky-hairline-strong" aria-hidden="true" />
              <span>RA {cursorMeasurement.ra.toFixed(6)}°</span>
              <span>Dec {cursorMeasurement.dec.toFixed(6)}°</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
