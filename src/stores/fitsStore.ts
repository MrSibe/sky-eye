import { create } from 'zustand'
import type { FitsMeta } from '../types/fits'
import { writeFrontendLog } from '../lib/tauri'

interface FitsState {
  filePath: string | null
  meta: FitsMeta | null
  rawPixels: Float32Array | null
  imageData: ImageData | null
  width: number
  height: number
  isLoading: boolean
  error: string | null
  zoom: number
  panX: number
  panY: number
  fitRequest: number

  setFilePath: (path: string | null) => void
  setMeta: (meta: FitsMeta | null) => void
  setRawPixels: (pixels: Float32Array | null, width: number, height: number) => void
  setImageData: (data: ImageData | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setZoom: (zoom: number) => void
  setPanX: (x: number) => void
  setPanY: (y: number) => void
  setPan: (x: number, y: number) => void
  resetView: () => void
  requestFit: () => void
}

export const useFitsStore = create<FitsState>((set) => ({
  filePath: null,
  meta: null,
  rawPixels: null,
  imageData: null,
  width: 0,
  height: 0,
  isLoading: false,
  error: null,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  fitRequest: 0,

  setFilePath: (path) => set({ filePath: path }),
  setMeta: (meta) => set({ meta }),
  setRawPixels: (pixels, width, height) => set({ rawPixels: pixels, width, height }),
  setImageData: (data) =>
    set({
      imageData: data,
      width: data?.width ?? 0,
      height: data?.height ?? 0,
    }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => {
    if (error) writeFrontendLog('error', error, 'ui-error')
    set({ error })
  },
  setZoom: (zoom) => set({ zoom }),
  setPanX: (x) => set({ panX: x }),
  setPanY: (y) => set({ panY: y }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  resetView: () => set({ zoom: 1.0, panX: 0, panY: 0 }),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
}))
