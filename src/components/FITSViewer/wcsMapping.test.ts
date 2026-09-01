import { describe, expect, it } from 'vitest'
import type { WCS } from '../../types/phase2'
import { pixelToSky, skyToPixel } from './FITSViewer'

const base: WCS = {
  crpix1: 1024,
  crpix2: 1024,
  crval1: 359.98,
  crval2: 72,
  cd1_1: -0.00028,
  cd1_2: 0.00004,
  cd2_1: 0.00004,
  cd2_2: 0.00028,
  image_width: 2048,
  image_height: 2048,
}

describe('TAN WCS blink mapping', () => {
  it.each([
    [1024, 1024],
    [200, 400],
    [1800, 1600],
  ])('round-trips pixels across rotation and high latitude', (x, y) => {
    const sky = pixelToSky(x, y, base)
    const pixel = skyToPixel(sky.ra, sky.dec, base)
    expect(pixel).not.toBeNull()
    expect(pixel!.x).toBeCloseTo(x, 7)
    expect(pixel!.y).toBeCloseTo(y, 7)
  })

  it('handles mirrored frames and the RA=0 boundary', () => {
    const mirrored = { ...base, cd1_1: -base.cd1_1, cd2_1: -base.cd2_1 }
    const sky = pixelToSky(1100, 900, base)
    expect(sky.ra).toBeGreaterThanOrEqual(0)
    expect(sky.ra).toBeLessThan(360)
    const mapped = skyToPixel(sky.ra, sky.dec, mirrored)
    expect(mapped).not.toBeNull()
    const recovered = pixelToSky(mapped!.x, mapped!.y, mirrored)
    expect(recovered.ra).toBeCloseTo(sky.ra, 8)
    expect(recovered.dec).toBeCloseTo(sky.dec, 8)
  })

  it('returns null for a sky point behind the tangent plane', () => {
    expect(skyToPixel(180, -72, base)).toBeNull()
  })
})
