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

function renderStretch(
  pixels: Float32Array,
  z1: number,
  z2: number,
  width: number,
  height: number,
  transfer: (normalized: number) => number,
): ImageData {
  const range = z2 - z1
  const rgba = new Uint8ClampedArray(Math.max(1, width * height) * 4)
  if (range <= 0 || !Number.isFinite(range) || width <= 0 || height <= 0) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba[offset] = 0
      rgba[offset + 1] = 0
      rgba[offset + 2] = 0
      rgba[offset + 3] = 255
    }
    return new ImageData(rgba, Math.max(1, width), Math.max(1, height))
  }
  for (let index = 0; index < width * height; index++) {
    const value = Number.isFinite(pixels[index]) ? pixels[index] : z1
    const normalized = Math.max(0, Math.min(1, (value - z1) / range))
    const stretched = Math.max(0, Math.min(1, transfer(normalized)))
    const display = Math.round(stretched * 255)
    const offset = index * 4
    rgba[offset] = display
    rgba[offset + 1] = display
    rgba[offset + 2] = display
    rgba[offset + 3] = 255
  }
  return new ImageData(rgba, width, height)
}

export function linearStretchInverted(
  pixels: Float32Array,
  z1: number,
  z2: number,
  width: number,
  height: number,
): ImageData {
  return invertImageData(linearStretch(pixels, z1, z2, width, height))
}

export function linearStretch(
  pixels: Float32Array,
  z1: number,
  z2: number,
  width: number,
  height: number,
): ImageData {
  return renderStretch(pixels, z1, z2, width, height, (value) => value)
}

export function asinhStretchInverted(
  pixels: Float32Array,
  z1: number,
  z2: number,
  width: number,
  height: number,
  softening = 5,
): ImageData {
  return invertImageData(asinhStretch(pixels, z1, z2, width, height, softening))
}

export function asinhStretch(
  pixels: Float32Array,
  z1: number,
  z2: number,
  width: number,
  height: number,
  softening = 5,
): ImageData {
  const q = Math.max(0.01, softening)
  const denominator = Math.asinh(q)
  return renderStretch(
    pixels,
    z1,
    z2,
    width,
    height,
    (value) => Math.asinh(q * value) / denominator,
  )
}

export function invertImageData(source: ImageData): ImageData {
  const data = new Uint8ClampedArray(source.data.length)
  for (let offset = 0; offset < source.data.length; offset += 4) {
    data[offset] = 255 - source.data[offset]
    data[offset + 1] = 255 - source.data[offset + 1]
    data[offset + 2] = 255 - source.data[offset + 2]
    data[offset + 3] = source.data[offset + 3]
  }
  return new ImageData(data, source.width, source.height)
}
