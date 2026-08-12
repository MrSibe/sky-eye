import { useRef, useEffect, useCallback, useState } from 'react'
import { useFitsStore } from '../../stores/fitsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { GaiaCalibrationOverlay, type ManualCalibrationState } from '../ManualCalibration'
import type { EphemerisPoint, TargetMeasurement } from '../../lib/tauri'
import { zscale } from '../../lib/stretch'

interface FITSViewerProps {
  stretchMode?: 'linear' | 'asinh'
  inverted?: boolean
  manualCalibration?: ManualCalibrationState | null
  onManualOffsetChange?: (x: number, y: number) => void
  measurementMode?: boolean
  onMeasure?: (x: number, y: number) => void
  measurements?: TargetMeasurement[]
  knownObjects?: EphemerisPoint[]
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

function pixelToSky(
  x: number,
  y: number,
  wcs: NonNullable<ReturnType<typeof useSessionStore.getState>['wcs']>,
) {
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
function skyToPixel(
  ra: number,
  dec: number,
  wcs: NonNullable<ReturnType<typeof useSessionStore.getState>['wcs']>,
) {
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
  stretchMode = 'linear',
  inverted = true,
  manualCalibration,
  onManualOffsetChange,
  measurementMode = false,
  onMeasure,
  measurements = [],
  knownObjects = [],
}: FITSViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const cursorImagePos = useRef<{ x: number; y: number } | null>(null)
  const [cursorMeasurement, setCursorMeasurement] = useState<CursorMeasurement | null>(null)

  const {
    rawPixels,
    width: imageWidth,
    height: imageHeight,
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

  const { framePixels, currentFrameIndex, wcs, solveSuccess } = useSessionStore()

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !rawPixels || !imageWidth || !imageHeight) return
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl) return
    const vertexSource = `#version 300 es
      in vec2 position;
      out vec2 uv;
      void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`
    const fragmentSource = `#version 300 es
      precision highp float;
      uniform sampler2D image;
      uniform float blackPoint;
      uniform float whitePoint;
      uniform bool useAsinh;
      uniform bool inverted;
      in vec2 uv;
      out vec4 color;
      void main() {
        float source = texture(image, vec2(uv.x, 1.0 - uv.y)).r;
        float value = clamp((source - blackPoint) / max(whitePoint - blackPoint, 1.0e-20), 0.0, 1.0);
        if (useAsinh) value = asinh(value * 10.0) / asinh(10.0);
        if (inverted) value = 1.0 - value;
        if (isnan(source) || isinf(source)) value = inverted ? 1.0 : 0.0;
        color = vec4(value, value, value, 1.0);
      }`
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('WebGL2 shader allocation failed')
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL2 shader compile failed')
      }
      return shader
    }
    const program = gl.createProgram()
    if (!program) return
    const vertex = compile(gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 program link failed')
    }
    canvas.width = imageWidth
    canvas.height = imageHeight
    gl.viewport(0, 0, imageWidth, imageHeight)
    gl.useProgram(program)
    const vertices = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      imageWidth,
      imageHeight,
      0,
      gl.RED,
      gl.FLOAT,
      rawPixels,
    )
    const limits = stretchLimits ?? zscale(rawPixels, imageWidth, imageHeight)
    if (!stretchLimits) setStretchLimits(limits)
    gl.uniform1f(gl.getUniformLocation(program, 'blackPoint'), limits.z1)
    gl.uniform1f(gl.getUniformLocation(program, 'whitePoint'), limits.z2)
    gl.uniform1i(gl.getUniformLocation(program, 'useAsinh'), stretchMode === 'asinh' ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(program, 'inverted'), inverted ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return () => {
      gl.deleteTexture(texture)
      gl.deleteBuffer(vertices)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      gl.deleteProgram(program)
    }
  }, [imageHeight, imageWidth, inverted, rawPixels, setStretchLimits, stretchLimits, stretchMode])

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
      if (!rawPixels || !imageWidth || !imageHeight) {
        setCursorMeasurement(null)
        return
      }
      const pixelX = Math.floor(x)
      const pixelY = Math.floor(y)
      const pixels = framePixels[currentFrameIndex]?.pixels

      if (pixels && pixelX >= 0 && pixelX < imageWidth && pixelY >= 0 && pixelY < imageHeight) {
        const sky = wcs && solveSuccess ? pixelToSky(x, y, wcs) : null
        setCursorMeasurement({
          x,
          y,
          value: pixels[pixelY * imageWidth + pixelX],
          ...(sky ?? {}),
        })
      } else {
        setCursorMeasurement(null)
      }
    },
    [currentFrameIndex, framePixels, imageHeight, imageWidth, rawPixels, solveSuccess, wcs],
  )

  useEffect(() => {
    const position = cursorImagePos.current
    if (position) updateCursorMeasurement(position.x, position.y)
  }, [updateCursorMeasurement])

  const handleImagePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rawPixels || !imageWidth || !imageHeight) return
      const bounds = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - bounds.left) * imageWidth) / bounds.width
      const y = ((e.clientY - bounds.top) * imageHeight) / bounds.height
      cursorImagePos.current = { x, y }
      updateCursorMeasurement(x, y)
    },
    [imageHeight, imageWidth, rawPixels, updateCursorMeasurement],
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
      if (!measurementMode || !onMeasure || !imageWidth || !imageHeight) return
      const b = e.currentTarget.getBoundingClientRect()
      onMeasure(
        ((e.clientX - b.left) * imageWidth) / b.width,
        ((e.clientY - b.top) * imageHeight) / b.height,
      )
    },
    [imageHeight, imageWidth, measurementMode, onMeasure],
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
      {rawPixels && imageWidth > 0 && imageHeight > 0 ? (
        <>
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
            }}
            onPointerMove={handleImagePointerMove}
            onClick={handleClick}
            onPointerLeave={() => {
              cursorImagePos.current = null
              setCursorMeasurement(null)
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0" />
            {manualCalibration && onManualOffsetChange && (
              <GaiaCalibrationOverlay
                width={imageWidth}
                height={imageHeight}
                calibration={manualCalibration}
                onOffsetChange={onManualOffsetChange}
              />
            )}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${imageWidth} ${imageHeight}`}
            >
              {measurements
                .filter((m) => m.frame_index === currentFrameIndex)
                .map((m) => (
                  <g key={m.id}>
                    <circle
                      cx={m.x}
                      cy={m.y}
                      r={Math.max(4 / zoom, m.aperture_radius_px)}
                      fill="none"
                      stroke="#fb7185"
                      strokeWidth={1.5 / zoom}
                    />
                  </g>
                ))}
              {wcs &&
                knownObjects.map((o) => {
                  const p = skyToPixel(o.ra_deg, o.dec_deg, wcs)
                  return p && p.x >= 0 && p.y >= 0 && p.x < imageWidth && p.y < imageHeight ? (
                    <g key={o.designation}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={10 / zoom}
                        fill="none"
                        stroke={o.quality !== 'degraded_time' ? '#22d3ee' : '#f59e0b'}
                        strokeWidth={1.4 / zoom}
                      />
                      <text
                        x={p.x + 12 / zoom}
                        y={p.y - 8 / zoom}
                        fontSize={11 / zoom}
                        fill={o.quality !== 'degraded_time' ? '#22d3ee' : '#f59e0b'}
                      >
                        {o.designation}
                      </text>
                    </g>
                  ) : null
                })}
            </svg>
          </div>
          {cursorMeasurement && (
            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded bg-sky-canvas/85 px-2 py-1 font-mono text-[10px] leading-4 text-sky-body backdrop-blur-sm">
              <span>X {cursorMeasurement.x.toFixed(1)}</span>
              <span>Y {cursorMeasurement.y.toFixed(1)}</span>
              <span>
                L{' '}
                {Number.isFinite(cursorMeasurement.value)
                  ? cursorMeasurement.value.toFixed(2)
                  : '—'}
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
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sky-mute select-none">
          <div className="text-center">
            <p className="text-lg mb-2">打开 FITS 文件开始</p>
          </div>
        </div>
      )}
    </div>
  )
}
