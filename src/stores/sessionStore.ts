import { create } from 'zustand'
import { ByteLru, type ByteLruStats } from '../lib/byteLru'
import type {
  DetectedStar,
  WCS,
  FrameMeta,
  BlinkState,
  DetectionResult,
  PlateSolveResult,
  FrameAnalysis,
  FramePhotometry,
} from '../types/phase2'

interface SessionState {
  detectedStars: DetectedStar[]
  noise: number
  isDetecting: boolean
  wcs: WCS | null
  isSolving: boolean
  solveSuccess: boolean
  frames: FrameMeta[]
  framePixels: Record<number, { pixels: Float32Array; width: number; height: number }>
  pixelCacheStats: ByteLruStats
  currentFrameIndex: number
  isPlaying: boolean
  speedMs: number
  frameAnalyses: Record<number, FrameAnalysis>
  /** 序列标识,打开新序列时递增;纹理缓存 key 用它杜绝跨序列串图 */
  sessionId: number
  /** 闪图预热进度;null 表示已就绪(Ready) */
  blinkPrep: { loaded: number; total: number } | null
  blinkAlignment: 'raw' | 'wcs'
  blinkReferenceIndex: number | null

  setDetection: (result: DetectionResult) => void
  setSolution: (result: PlateSolveResult) => void
  setFrameReduction: (
    index: number,
    detection: DetectionResult | null,
    solution: PlateSolveResult,
    photometry: FramePhotometry | null,
    photometryError: string | null,
  ) => void
  setIsDetecting: (v: boolean) => void
  setIsSolving: (v: boolean) => void
  setFrames: (frames: FrameMeta[]) => void
  setBlinkState: (state: BlinkState) => void
  cacheFramePixels: (index: number, pixels: Float32Array, width: number, height: number) => void
  setCurrentFrame: (index: number) => void
  setPlaying: (playing: boolean) => void
  setSpeedMs: (ms: number) => void
  setBlinkPrep: (prep: { loaded: number; total: number } | null) => void
  setBlinkAlignment: (mode: 'raw' | 'wcs', referenceIndex?: number) => void
  invalidateScience: () => void
  resetSession: () => void
}

/** 稳定空数组(模块级,从未修改):未分析帧的 detectedStars 保持同一引用,避免每 tick 触发 overlay 重渲染 */
const EMPTY_STARS: DetectedStar[] = []

let nextSessionId = 1
const CPU_PIXEL_BUDGET_BYTES = 256 * 1024 * 1024
const pixelLru = new ByteLru<number, { pixels: Float32Array; width: number; height: number }>(
  CPU_PIXEL_BUDGET_BYTES,
)

export const useSessionStore = create<SessionState>((set) => ({
  detectedStars: [],
  noise: 0,
  isDetecting: false,
  wcs: null,
  isSolving: false,
  solveSuccess: false,
  frames: [],
  framePixels: {},
  pixelCacheStats: pixelLru.stats(),
  currentFrameIndex: 0,
  isPlaying: false,
  speedMs: 300,
  frameAnalyses: {},
  sessionId: nextSessionId++,
  blinkPrep: null,
  blinkAlignment: 'raw',
  blinkReferenceIndex: null,

  setDetection: (result) =>
    set((state) => ({
      detectedStars: result.astrometry_stars,
      noise: result.noise,
      frameAnalyses: {
        ...state.frameAnalyses,
        [state.currentFrameIndex]: {
          detection: result,
          catalog: state.frameAnalyses[state.currentFrameIndex]?.catalog ?? null,
          solution: state.frameAnalyses[state.currentFrameIndex]?.solution ?? null,
          photometry: state.frameAnalyses[state.currentFrameIndex]?.photometry ?? null,
          photometry_error: state.frameAnalyses[state.currentFrameIndex]?.photometry_error ?? null,
        },
      },
    })),
  setSolution: (result) =>
    set((state) => ({
      wcs: result.wcs,
      solveSuccess: result.success,
      frames: state.frames.map((frame, index) =>
        index === state.currentFrameIndex ? { ...frame, solved: result.success } : frame,
      ),
      frameAnalyses: {
        ...state.frameAnalyses,
        [state.currentFrameIndex]: {
          detection: state.frameAnalyses[state.currentFrameIndex]?.detection ?? null,
          catalog: state.frameAnalyses[state.currentFrameIndex]?.catalog ?? null,
          solution: result,
          photometry: null,
          photometry_error: null,
        },
      },
    })),
  setFrameReduction: (index, detection, solution, photometry, photometryError) =>
    set((state) => ({
      frames: state.frames.map((frame, frameIndex) =>
        frameIndex === index ? { ...frame, solved: solution.success } : frame,
      ),
      frameAnalyses: {
        ...state.frameAnalyses,
        [index]: {
          detection,
          catalog: state.frameAnalyses[index]?.catalog ?? null,
          solution,
          photometry,
          photometry_error: photometryError,
        },
      },
      ...(index === state.currentFrameIndex
        ? {
            detectedStars: detection?.astrometry_stars ?? EMPTY_STARS,
            noise: detection?.noise ?? 0,
            wcs: solution.wcs,
            solveSuccess: solution.success,
          }
        : {}),
    })),
  setIsDetecting: (v) => set({ isDetecting: v }),
  setIsSolving: (v) => set({ isSolving: v }),
  setFrames: (frames) =>
    set(() => {
      pixelLru.clear()
      return {
        frames,
        frameAnalyses: {},
        detectedStars: EMPTY_STARS,
        noise: 0,
        wcs: null,
        solveSuccess: false,
        framePixels: {},
        pixelCacheStats: pixelLru.stats(),
        currentFrameIndex: 0,
        isPlaying: false,
        // 新序列:递增 sessionId,BlinkSet 纹理 key 整体换代
        sessionId: nextSessionId++,
        blinkPrep: null,
        blinkAlignment: 'raw',
        blinkReferenceIndex: null,
      }
    }),
  setBlinkState: (blink) =>
    set((state) => ({
      currentFrameIndex: blink.current_index,
      isPlaying: blink.playing,
      speedMs: blink.speed_ms,
      detectedStars:
        state.frameAnalyses[blink.current_index]?.detection?.astrometry_stars ?? EMPTY_STARS,
      noise: state.frameAnalyses[blink.current_index]?.detection?.noise ?? 0,
      wcs: state.frameAnalyses[blink.current_index]?.solution?.wcs ?? null,
      solveSuccess: state.frameAnalyses[blink.current_index]?.solution?.success ?? false,
    })),
  cacheFramePixels: (index, pixels, width, height) =>
    set((state) => {
      const value = { pixels, width, height }
      const nextIndex =
        state.frames.length > 1 ? (state.currentFrameIndex + 1) % state.frames.length : -1
      const protectedKeys = new Set([state.currentFrameIndex, nextIndex])
      const evicted = pixelLru.set(index, value, pixels.byteLength, protectedKeys)
      const framePixels = { ...state.framePixels, [index]: value }
      for (const key of evicted) delete framePixels[key]
      return { framePixels, pixelCacheStats: pixelLru.stats() }
    }),
  setCurrentFrame: (index) =>
    set((state) => {
      pixelLru.get(index)
      return {
        currentFrameIndex: index,
        pixelCacheStats: pixelLru.stats(),
        detectedStars: state.frameAnalyses[index]?.detection?.astrometry_stars ?? EMPTY_STARS,
        noise: state.frameAnalyses[index]?.detection?.noise ?? 0,
        wcs: state.frameAnalyses[index]?.solution?.wcs ?? null,
        solveSuccess: state.frameAnalyses[index]?.solution?.success ?? false,
      }
    }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setSpeedMs: (ms) => set({ speedMs: ms }),
  setBlinkPrep: (prep) => set({ blinkPrep: prep }),
  setBlinkAlignment: (mode, referenceIndex) =>
    set((state) => ({
      blinkAlignment: mode,
      blinkReferenceIndex: mode === 'wcs' ? (referenceIndex ?? state.currentFrameIndex) : null,
    })),
  invalidateScience: () =>
    set({
      detectedStars: EMPTY_STARS,
      noise: 0,
      wcs: null,
      solveSuccess: false,
      frameAnalyses: {},
    }),
  resetSession: () =>
    set(() => {
      pixelLru.clear()
      return {
        detectedStars: EMPTY_STARS,
        noise: 0,
        wcs: null,
        solveSuccess: false,
        frames: [],
        framePixels: {},
        pixelCacheStats: pixelLru.stats(),
        currentFrameIndex: 0,
        isPlaying: false,
        speedMs: 300,
        frameAnalyses: {},
        sessionId: nextSessionId++,
        blinkPrep: null,
        blinkAlignment: 'raw',
        blinkReferenceIndex: null,
      }
    }),
}))
