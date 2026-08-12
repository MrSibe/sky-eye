export interface ZScaleOptions {
  contrast?: number
  samples?: number
  sigmaReject?: number
  maxIterations?: number
  maxRejectFraction?: number
}

function sampleImageGrid(
  pixels: Float32Array,
  width: number,
  height: number,
  maximumSamples: number,
): number[] {
  if (width <= 0 || height <= 0 || pixels.length === 0) return []
  const target = Math.max(1, Math.min(maximumSamples, width * height))
  const aspect = width / height
  const columns = Math.max(1, Math.round(Math.sqrt(target * aspect)))
  const rows = Math.max(1, Math.ceil(target / columns))
  const samples: number[] = []
  for (let row = 0; row < rows && samples.length < target; row++) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) * height) / rows))
    for (let column = 0; column < columns && samples.length < target; column++) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) * width) / columns))
      const value = pixels[y * width + x]
      if (Number.isFinite(value)) samples.push(value)
    }
  }
  return samples
}

function fitRankedLine(
  values: number[],
  valid: boolean[],
): { intercept: number; slope: number } | null {
  let count = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  const midpoint = (values.length - 1) / 2
  for (let index = 0; index < values.length; index++) {
    if (!valid[index]) continue
    const x = index - midpoint
    const y = values[index]
    count++
    sumX += x
    sumY += y
    sumXX += x * x
    sumXY += x * y
  }
  const denominator = count * sumXX - sumX * sumX
  if (count < 2 || Math.abs(denominator) < Number.EPSILON) return null
  const slope = (count * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / count
  return { intercept, slope }
}

/** IRAF/Astropy-style ZScale interval using a uniform two-dimensional sample. */
export function zscale(
  pixels: Float32Array,
  width: number,
  height: number,
  options: ZScaleOptions = {},
): { z1: number; z2: number } {
  const contrast = Math.max(0.001, Math.min(1, options.contrast ?? 0.25))
  const sigmaReject = options.sigmaReject ?? 2.5
  const maxIterations = options.maxIterations ?? 5
  const maxRejectFraction = options.maxRejectFraction ?? 0.5
  const values = sampleImageGrid(pixels, width, height, options.samples ?? 1000).sort(
    (left, right) => left - right,
  )
  if (values.length < 5) return { z1: values[0] ?? 0, z2: values[values.length - 1] ?? 1 }

  const minimum = values[0]
  const maximum = values[values.length - 1]
  const middle = Math.floor(values.length / 2)
  const median =
    values.length % 2 === 0 ? (values[middle - 1] + values[middle]) * 0.5 : values[middle]
  let valid = new Array<boolean>(values.length).fill(true)
  const minimumGood = Math.max(5, Math.ceil(values.length * (1 - maxRejectFraction)))
  const grow = Math.max(1, Math.floor(values.length * 0.01))
  let fit = fitRankedLine(values, valid)

  for (let iteration = 0; iteration < maxIterations && fit; iteration++) {
    const midpoint = (values.length - 1) / 2
    const residuals = values.map((value, index) =>
      valid[index] ? value - (fit!.intercept + fit!.slope * (index - midpoint)) : 0,
    )
    const goodResiduals = residuals.filter((_, index) => valid[index])
    const mean = goodResiduals.reduce((sum, value) => sum + value, 0) / goodResiduals.length
    const variance =
      goodResiduals.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, goodResiduals.length - 1)
    const sigma = Math.sqrt(Math.max(0, variance))
    if (!Number.isFinite(sigma) || sigma <= Number.EPSILON) break

    const next = [...valid]
    let rejected = 0
    for (let index = 0; index < residuals.length; index++) {
      if (!valid[index] || Math.abs(residuals[index] - mean) <= sigmaReject * sigma) continue
      for (
        let neighbor = Math.max(0, index - grow);
        neighbor <= Math.min(values.length - 1, index + grow);
        neighbor++
      ) {
        next[neighbor] = false
      }
    }
    for (let index = 0; index < next.length; index++) {
      if (!next[index]) rejected++
    }
    if (values.length - rejected < minimumGood) {
      fit = null
      break
    }
    if (next.every((value, index) => value === valid[index])) break
    valid = next
    fit = fitRankedLine(values, valid)
  }

  const goodCount = valid.filter(Boolean).length
  if (!fit || goodCount < minimumGood) return { z1: minimum, z2: maximum }
  const midpoint = (values.length - 1) / 2
  const slope = fit.slope / contrast
  const z1 = Math.max(minimum, median - midpoint * slope)
  const z2 = Math.min(maximum, median + (values.length - 1 - midpoint) * slope)
  if (!Number.isFinite(z1) || !Number.isFinite(z2) || z1 >= z2) {
    return { z1: minimum, z2: maximum }
  }
  return { z1, z2 }
}
