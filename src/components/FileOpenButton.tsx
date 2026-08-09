import { open } from '@tauri-apps/plugin-dialog'
import { useFitsStore } from '../stores/fitsStore'
import { storeFits, getRawPixels } from '../lib/tauri'
import { zscale, linearStretchInverted } from '../lib/stretch'
import { Button } from './ui/button'

export function FileOpenButton() {
  const { setFilePath, setMeta, setRawPixels, setImageData, setLoading, setError } = useFitsStore()

  const handleOpen = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'FITS', extensions: ['fits', 'fit', 'fts'] }],
      })
      if (!selected) return

      setLoading(true)
      setError(null)

      // 1. Load FITS into Rust backend
      const meta = await storeFits(selected as string)
      setFilePath(selected as string)
      setMeta(meta)

      // 2. Fetch raw pixel data
      const raw = await getRawPixels()
      const pixels = new Float32Array(raw.pixels)
      setRawPixels(pixels, raw.width, raw.height)

      // 3. Auto-stretch: ZScale + ASINH inverted
      const { z1, z2 } = zscale(pixels, raw.width, raw.height)
      const imageData = linearStretchInverted(pixels, z1, z2, raw.width, raw.height)
      setImageData(imageData)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="primary" size="sm" onClick={handleOpen}>
      打开
    </Button>
  )
}
