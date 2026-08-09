import { useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

interface StarOverlayProps {
  width: number
  height: number
}

export function StarOverlay({ width, height }: StarOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { detectedStars, wcs, frameAnalyses, currentFrameIndex } = useSessionStore()
  const solution = frameAnalyses[currentFrameIndex]?.solution

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const theme = getComputedStyle(document.documentElement)
    const starColor = theme.getPropertyValue('--color-sky-accent-green').trim()
    const selectedColor = theme.getPropertyValue('--color-sky-primary').trim()
    const rejectedColor = theme.getPropertyValue('--color-sky-accent-yellow').trim()

    canvas.width = width
    canvas.height = height
    ctx.clearRect(0, 0, width, height)

    for (const star of detectedStars) {
      ctx.beginPath()
      const radius = Math.max(4, Math.min(12, star.fwhm * 1.4))
      ctx.arc(star.x, star.y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = solution?.matches.length ? `${starColor}70` : starColor
      ctx.lineWidth = 1.25
      ctx.stroke()
    }

    for (const match of solution?.matches ?? []) {
      const star = detectedStars[match.image_source_index]
      if (!star) continue
      const color = match.used && !match.rejection_reason ? starColor : rejectedColor
      ctx.beginPath()
      ctx.arc(star.x, star.y, Math.max(5, Math.min(13, star.fwhm * 1.55)), 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.6
      ctx.stroke()

      const vectorScale = 8
      ctx.beginPath()
      ctx.moveTo(star.x, star.y)
      ctx.lineTo(
        star.x + match.residual_x_arcsec * vectorScale,
        star.y + match.residual_y_arcsec * vectorScale,
      )
      ctx.strokeStyle = color
      ctx.lineWidth = 1.25
      ctx.stroke()
    }

    if (wcs) {
      ctx.beginPath()
      ctx.arc(wcs.crpix1, wcs.crpix2, 6, 0, Math.PI * 2)
      ctx.strokeStyle = selectedColor
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }, [detectedStars, solution, wcs, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
    />
  )
}
