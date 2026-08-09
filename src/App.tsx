import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { FITSViewer } from './components/FITSViewer'
import { TitleBar } from './components/TitleBar'
import { DisplaySidebar } from './components/DisplaySidebar'
import { SciencePanel } from './components/SciencePanel'
import { SettingsDialog } from './components/SettingsDialog'
import { ReportExportDialog } from './components/ReportExportDialog'
import { SuspiciousTargetDialog } from './components/SuspiciousTargetDialog'
import { ReductionSettings } from './components/ReductionSettings'
import {
  countApproximateMatches,
  ManualCalibrationPanel,
  type ManualCalibrationState,
} from './components/ManualCalibration'
import { useFitsStore } from './stores/fitsStore'
import { useSessionStore } from './stores/sessionStore'
import {
  loadFrames,
  closeAllImages,
  getFramePixelBuffer,
  blinkGetState,
  blinkSetFrame,
  startReduction,
  getFrameAnalysis,
  plateSolve,
  calibrateFramePhotometry,
  getMpcorbStatus,
  matchTracklet,
  measureTarget,
  confirmTargetMeasurement,
  discardTargetMeasurement,
  searchKnownObjectsBatch,
  deleteTargetMeasurement,
  renameTargetMeasurement,
  updateMpcorb,
  getAppConfig,
  saveAppConfig,
  previewReport,
  exportReport,
  writeFrontendLog,
} from './lib/tauri'
import type {
  AppConfig,
  EphemerisPoint,
  ManualCalibrationSeed,
  MpcorbManifest,
  ObjectIdentity,
  ReportContext,
  ReportFormat,
  ReportObservation,
  SolveParams,
  TargetMeasurement,
} from './lib/tauri'
import { asinhStretch, invertImageData, linearStretch, zscale } from './lib/stretch'
import {
  Crosshair,
  Eye,
  EyeOff,
  FileOutput,
  FolderOpen,
  ImageOff,
  ListChecks,
  Orbit,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Toolbar } from './components/ui/surface'
import { OperationDialog } from './components/ui/operation-dialog'
import { MessageDialog } from './components/ui/message-dialog'

function reportIdentity(designation: string): ObjectIdentity {
  return { kind: 'tracklet', value: designation }
}

function App() {
  const {
    error,
    isLoading,
    setMeta,
    setRawPixels,
    setImageData,
    setLoading,
    setError,
    setFilePath,
    requestFit,
  } = useFitsStore()
  const {
    detectedStars,
    isDetecting,
    isSolving,
    frames,
    framePixels,
    frameWidth,
    frameHeight,
    currentFrameIndex,
    frameAnalyses,
    setFrames,
    setBlinkState,
    setFramePixels,
    setDetection,
    setSolution,
    setFrameReduction,
    setIsDetecting,
    setIsSolving,
    resetSession,
  } = useSessionStore()

  const stretchCache = useRef<Map<number, ImageData>>(new Map())
  const stretchLimits = useRef<{ z1: number; z2: number } | null>(null)
  const [loadingProgress, setLoadingProgress] = useState<string | null>(null)
  const [reductionMessage, setReductionMessage] = useState<string | null>(null)
  const [showReductionSettings, setShowReductionSettings] = useState(false)
  const [reductionProgress, setReductionProgress] = useState<string | null>(null)
  const [stretchMode, setStretchMode] = useState<'linear' | 'asinh'>('linear')
  const [inverted, setInverted] = useState(true)
  const [manualCalibration, setManualCalibration] = useState<ManualCalibrationState | null>(null)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualQueue, setManualQueue] = useState<number[]>([])
  const [measurementMode, setMeasurementMode] = useState(false)
  const [pendingMeasurement, setPendingMeasurement] = useState<TargetMeasurement | null>(null)
  const [scienceOpen, setScienceOpen] = useState(false)
  const [scienceBusy, setScienceBusy] = useState(false)
  const [measurements, setMeasurements] = useState<TargetMeasurement[]>([])
  const [mpcorb, setMpcorb] = useState<MpcorbManifest | null>(null)
  const [knownObjectsByFrame, setKnownObjectsByFrame] = useState<Record<number, EphemerisPoint[]>>(
    {},
  )
  const [knownVisible, setKnownVisible] = useState(false)
  const [knownSearchBusy, setKnownSearchBusy] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportFormat, setReportFormat] = useState<ReportFormat>('ades2022_psv')
  const [reportPreview, setReportPreview] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const manualFrameIndex = useRef<number | null>(null)
  const lastSolveParams = useRef<SolveParams>({})
  const currentWcsAccepted = frameAnalyses[currentFrameIndex]?.solution?.status === 'accepted'
  const canMeasure = currentWcsAccepted
  const knownPrerequisites = Boolean(
    frames.length > 0 &&
    mpcorb &&
    frames.every(
      (frame, index) =>
        frame.observation_midpoint_jd != null &&
        frameAnalyses[index]?.solution?.status === 'accepted',
    ),
  )
  const currentKnownObjects = knownObjectsByFrame[currentFrameIndex] ?? []
  const knownObjectCount = Object.values(knownObjectsByFrame).reduce(
    (total, objects) => total + objects.length,
    0,
  )
  const reportMeasurements = measurements
  const reportContext = useMemo<ReportContext | null>(
    () =>
      appConfig
        ? {
            observatory_code: appConfig.station.mpc_code,
            submitter: appConfig.submitter,
            observers: appConfig.station.observer_names,
            measurers: appConfig.station.measurer_names,
            telescope: appConfig.station.telescope,
            telescope_aperture_m: appConfig.station.aperture_m,
            detector: appConfig.station.detector,
            software_version: 'SkyEye 0.1.0',
            position_precision_1e6_deg: appConfig.report.position_precision_1e6_deg,
            magnitude_precision_hundredth: appConfig.report.magnitude_precision_hundredth,
            mpcorb_sha256: mpcorb?.sha256,
            refcat2_sha256: measurements.find(
              (measurement) => typeof measurement.provenance.refcat2_sha256 === 'string',
            )?.provenance.refcat2_sha256 as string | undefined,
          }
        : null,
    [appConfig, measurements, mpcorb],
  )
  const reportObservations = useMemo<ReportObservation[]>(
    () =>
      reportMeasurements.map((measurement) => {
        const frame = frames[measurement.frame_index]
        const solution = frameAnalyses[measurement.frame_index]?.solution
        const quality = solution?.quality
        const wcs = solution?.wcs
        const pixelScale = wcs
          ? (Math.hypot(wcs.cd1_1, wcs.cd2_1) + Math.hypot(wcs.cd1_2, wcs.cd2_2)) * 1800
          : undefined
        const combineUncertainty = (centroid: number | null, fit: number | undefined) =>
          centroid == null && fit == null ? undefined : Math.hypot(centroid ?? 0, fit ?? 0)
        return {
          identity: reportIdentity(measurement.designation),
          mode: 'CCD',
          obs_time_utc: measurement.midpoint_utc ?? '',
          ra_deg: measurement.ra_deg ?? Number.NaN,
          dec_deg: measurement.dec_deg ?? Number.NaN,
          ra_uncertainty_arcsec: combineUncertainty(
            measurement.ra_uncertainty_arcsec,
            quality?.rms_ra_arcsec,
          ),
          dec_uncertainty_arcsec: combineUncertainty(
            measurement.dec_uncertainty_arcsec,
            quality?.rms_dec_arcsec,
          ),
          astrometric_catalog: 'Gaia3',
          magnitude: appConfig?.report.include_magnitude
            ? (measurement.magnitude ?? undefined)
            : undefined,
          magnitude_uncertainty: measurement.magnitude_error ?? undefined,
          band:
            appConfig?.report.include_magnitude && measurement.magnitude != null
              ? (measurement.band ?? undefined)
              : undefined,
          filter:
            appConfig?.report.include_magnitude &&
            measurement.magnitude != null &&
            appConfig.report.band !== 'C'
              ? appConfig.report.band
              : undefined,
          photometric_catalog: measurement.photometric_catalog ?? undefined,
          aperture_arcsec:
            pixelScale == null ? undefined : measurement.aperture_radius_px * pixelScale,
          snr: measurement.snr ?? undefined,
          seeing_arcsec:
            pixelScale == null || measurement.fwhm_px == null
              ? undefined
              : measurement.fwhm_px * pixelScale,
          exposure_seconds: frame?.exposure ?? undefined,
          rms_fit_arcsec: quality?.residual_rms_arcsec,
          astrometric_reference_stars: quality?.matched,
          accepted_wcs: solution?.status === 'accepted',
        }
      }),
    [appConfig, reportMeasurements, frameAnalyses, frames],
  )
  useEffect(() => {
    void getAppConfig()
      .then(setAppConfig)
      .catch((e) => setError(String(e)))
  }, [setError])
  useEffect(() => {
    if (!appConfig) return
    void getMpcorbStatus()
      .then((local) => {
        setMpcorb(local)
        if (
          appConfig.data.mpcorb_auto_update &&
          (!local ||
            Date.now() / 1000 - local.downloaded_unix > appConfig.data.mpcorb_max_age_hours * 3600)
        ) {
          void updateMpcorb()
            .then(setMpcorb)
            .catch(() => {
              /* offline startup retains the active snapshot */
            })
        }
      })
      .catch(() => {})
  }, [appConfig])
  useEffect(() => {
    if (!canMeasure) setMeasurementMode(false)
  }, [canMeasure])
  useEffect(() => {
    if (!knownPrerequisites) setKnownVisible(false)
  }, [knownPrerequisites])

  const approximateManualMatches = useMemo(
    () =>
      manualCalibration
        ? countApproximateMatches(manualCalibration, detectedStars, frameWidth, frameHeight)
        : 0,
    [manualCalibration, detectedStars, frameWidth, frameHeight],
  )

  const renderFrame = useCallback(
    (index: number) => {
      const pixels = framePixels[index]
      if (!pixels || frameWidth === 0) return

      const cached = stretchCache.current.get(index)
      if (cached) {
        setImageData(cached)
        return
      }

      const limits = stretchLimits.current ?? zscale(pixels, frameWidth, frameHeight)
      stretchLimits.current = limits
      const stretched =
        stretchMode === 'asinh'
          ? asinhStretch(pixels, limits.z1, limits.z2, frameWidth, frameHeight)
          : linearStretch(pixels, limits.z1, limits.z2, frameWidth, frameHeight)
      const imgData = inverted ? invertImageData(stretched) : stretched
      stretchCache.current.set(index, imgData)
      setImageData(imgData)
    },
    [framePixels, frameWidth, frameHeight, inverted, setImageData, stretchMode],
  )

  useEffect(() => {
    if (framePixels.length === 0) return
    renderFrame(currentFrameIndex)
  }, [currentFrameIndex, framePixels, renderFrame])

  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'FITS', extensions: ['fits', 'fit', 'fts'] }],
      })
      if (!selected || selected.length === 0) return
      const paths = Array.isArray(selected) ? selected : [selected]
      setLoading(true)
      setError(null)
      setLoadingProgress(null)
      setReductionMessage(null)
      setShowReductionSettings(false)
      setManualCalibration(null)
      setManualQueue([])
      setMeasurements([])
      setKnownObjectsByFrame({})
      setKnownVisible(false)
      manualFrameIndex.current = null
      stretchCache.current.clear()
      stretchLimits.current = null

      const result = await loadFrames(paths)
      const first = result.frames[0]
      if (!first) {
        setError('No frames loaded')
        setLoading(false)
        return
      }

      // Load ALL frames' pixels upfront with progress
      const allPixels: Float32Array[] = new Array(result.total)
      let firstWidth = 0
      let firstHeight = 0

      for (let i = 0; i < result.total; i++) {
        setLoadingProgress(`加载帧 ${i + 1}/${result.total}`)
        const frame = result.frames[i]
        const buffer = await getFramePixelBuffer(i)
        allPixels[i] = new Float32Array(buffer)
        if (i === 0) {
          firstWidth = frame.width
          firstHeight = frame.height
        }
        writeFrontendLog(
          'debug',
          `Frame ${i + 1}/${result.total}: w=${frame.width} h=${frame.height} pixels=${allPixels[i].length} min=${frame.min_val} max=${frame.max_val}`,
          'fits',
        )
      }

      // All loaded — update state
      setLoadingProgress(null)
      setFrames(result.frames)
      setFilePath(first.path)
      setMeta({
        path: first.path,
        width: first.width,
        height: first.height,
        min_val: first.min_val,
        max_val: first.max_val,
        object: first.object,
        ra: first.ra,
        dec: first.dec,
        exposure: first.exposure,
        filter: first.filter,
        date_obs: first.date_obs,
        focal_length: first.focal_length,
        pixel_size: first.pixel_size,
        pixel_scale_arcsec: first.pixel_scale_arcsec,
        rotation_deg: first.rotation_deg,
        parity_flipped: first.parity_flipped,
      })

      setRawPixels(allPixels[0], firstWidth, firstHeight)
      setFramePixels(allPixels, firstWidth, firstHeight)

      const { z1, z2 } = zscale(allPixels[0], firstWidth, firstHeight)
      stretchLimits.current = { z1, z2 }
      writeFrontendLog('debug', `zscale: z1=${z1} z2=${z2} range=${z2 - z1}`, 'display')
      const stretched =
        stretchMode === 'asinh'
          ? asinhStretch(allPixels[0], z1, z2, firstWidth, firstHeight)
          : linearStretch(allPixels[0], z1, z2, firstWidth, firstHeight)
      const imgData = inverted ? invertImageData(stretched) : stretched
      writeFrontendLog('debug', `ImageData: w=${imgData.width} h=${imgData.height}`, 'display')
      stretchCache.current.set(0, imgData)
      setImageData(imgData)
      requestFit()

      // Set up Blink session if needed
      if (result.total >= 2) {
        const blinkState = await blinkGetState()
        setBlinkState(blinkState)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      setLoadingProgress(null)
    }
  }, [
    setMeta,
    setRawPixels,
    setImageData,
    setLoading,
    setError,
    setFilePath,
    setFrames,
    setBlinkState,
    setFramePixels,
    requestFit,
    stretchMode,
    inverted,
  ])

  const handleCloseAllImages = useCallback(async () => {
    try {
      await closeAllImages()
      resetSession()
      setMeta(null)
      setRawPixels(null, 0, 0)
      setImageData(null)
      setFilePath(null)
      setLoading(false)
      setError(null)
      setMeasurements([])
      setKnownObjectsByFrame({})
      setKnownVisible(false)
      setMeasurementMode(false)
      setPendingMeasurement(null)
      setScienceOpen(false)
      setReportOpen(false)
      setReportPreview('')
      setShowReductionSettings(false)
      setManualCalibration(null)
      setManualQueue([])
      manualFrameIndex.current = null
      stretchCache.current.clear()
      stretchLimits.current = null
      setLoadingProgress(null)
      setReductionProgress(null)
      setReductionMessage(null)
    } catch (e) {
      setError(String(e))
    }
  }, [resetSession, setError, setFilePath, setImageData, setLoading, setMeta, setRawPixels])

  const handleMeasure = useCallback(
    async (x: number, y: number) => {
      setMeasurementMode(false)
      setScienceBusy(true)
      try {
        setPendingMeasurement(await measureTarget(currentFrameIndex, x, y))
      } catch (e) {
        setError(String(e))
      } finally {
        setScienceBusy(false)
      }
    },
    [currentFrameIndex, setError],
  )
  const confirmMeasurement = useCallback(
    async (designation: string) => {
      if (!pendingMeasurement) return
      setScienceBusy(true)
      try {
        const value = await confirmTargetMeasurement(pendingMeasurement.id, designation)
        setMeasurements((v) => [...v.filter((m) => m.id !== value.id), value])
        setPendingMeasurement(null)
        setScienceOpen(true)
      } catch (e) {
        setError(String(e))
      } finally {
        setScienceBusy(false)
      }
    },
    [pendingMeasurement, setError],
  )
  const cancelMeasurement = useCallback(async () => {
    if (!pendingMeasurement) return
    try {
      await discardTargetMeasurement(pendingMeasurement.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingMeasurement(null)
    }
  }, [pendingMeasurement, setError])
  const handleMpcUpdate = useCallback(async () => {
    setScienceBusy(true)
    try {
      setMpcorb(await updateMpcorb())
    } finally {
      setScienceBusy(false)
    }
  }, [])
  const observatory = useMemo(() => {
    const s = appConfig?.station
    return s?.longitude_deg_east != null && s.latitude_deg != null
      ? {
          longitude_deg_east: s.longitude_deg_east,
          latitude_deg: s.latitude_deg,
          altitude_m: s.altitude_m ?? 0,
        }
      : undefined
  }, [appConfig])
  const handleOverlay = useCallback(async () => {
    if (!knownPrerequisites) {
      setError('显示已知目标需要整组图片都有 accepted WCS 和 UTC 曝光中点。')
      return false
    }
    const searches = frames.map((frame, frameIndex) => {
      const w = useSessionStore.getState().frameAnalyses[frameIndex]!.solution!.wcs!
      const scale = (Math.hypot(w.cd1_1, w.cd2_1) + Math.hypot(w.cd1_2, w.cd2_2)) * 1800
      return {
        frame_index: frameIndex,
        jd_utc: frame.observation_midpoint_jd!,
        center_ra_deg: w.crval1,
        center_dec_deg: w.crval2,
        radius_deg: ((Math.hypot(frame.width, frame.height) * scale) / 7200) * 1.15,
      }
    })
    setKnownSearchBusy(true)
    try {
      const result = await searchKnownObjectsBatch({
        frames: searches,
        station: observatory,
        max_results_per_frame: 1000,
      })
      setKnownObjectsByFrame(
        Object.fromEntries(result.frames.map((frame) => [frame.frame_index, frame.objects])),
      )
      return true
    } catch (e) {
      setError(String(e))
      return false
    } finally {
      setKnownSearchBusy(false)
    }
  }, [frames, knownPrerequisites, observatory, setError])
  const handleKnownToggle = useCallback(async () => {
    if (knownVisible) {
      setKnownVisible(false)
      return
    }
    if (Object.keys(knownObjectsByFrame).length > 0) {
      setKnownVisible(true)
      return
    }
    if (await handleOverlay()) setKnownVisible(true)
  }, [handleOverlay, knownObjectsByFrame, knownVisible])
  const handleMatch = useCallback(async () => {
    const points = measurements
      .filter((m) => m.midpoint_jd != null && m.ra_deg != null && m.dec_deg != null)
      .map((m) => ({
        measurement_id: m.id,
        jd_utc: m.midpoint_jd!,
        ra_deg: m.ra_deg!,
        dec_deg: m.dec_deg!,
      }))
    setScienceBusy(true)
    try {
      const r = await matchTracklet(points, observatory)
      setReductionMessage(
        `${r.status}: ${r.reason}${r.candidates[0] ? `；最佳候选 ${r.candidates[0].designation}，最大 O-C ${r.candidates[0].max_residual_arcsec.toFixed(2)}″` : ''}`,
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setScienceBusy(false)
    }
  }, [measurements, observatory, setError])
  const handleSaveConfig = useCallback(async (config: AppConfig) => {
    await saveAppConfig(config)
    setAppConfig(config)
    setReductionMessage('软件设置已保存到 config/settings.json。')
  }, [])
  const handleDeleteMeasurement = useCallback(
    async (id: string) => {
      setScienceBusy(true)
      try {
        await deleteTargetMeasurement(id)
        setMeasurements((current) => current.filter((measurement) => measurement.id !== id))
      } catch (e) {
        setError(String(e))
      } finally {
        setScienceBusy(false)
      }
    },
    [setError],
  )
  const handleRenameMeasurement = useCallback(
    async (id: string, name: string) => {
      setScienceBusy(true)
      try {
        const updated = await renameTargetMeasurement(id, name)
        setMeasurements((current) =>
          current.map((measurement) => (measurement.id === id ? updated : measurement)),
        )
      } catch (e) {
        setError(String(e))
      } finally {
        setScienceBusy(false)
      }
    },
    [setError],
  )
  const openReportDialog = useCallback(() => {
    if (!appConfig) return
    setReportFormat(appConfig.report.default_format)
    setReportPreview('')
    setReportOpen(true)
  }, [appConfig])
  const handleReportExport = useCallback(async () => {
    if (!reportContext) return
    setReportBusy(true)
    try {
      const preview = await previewReport(reportFormat, reportContext, reportObservations)
      setReportPreview(preview)
      const extension = reportFormat === 'ades2022_psv' ? 'psv' : 'txt'
      const destination = await saveDialog({
        defaultPath: `skyeye-observations.${extension}`,
        filters: [
          {
            name: reportFormat === 'ades2022_psv' ? 'ADES 2022 PSV' : 'MPC 80-column',
            extensions: [extension],
          },
        ],
      })
      if (!destination) return
      await exportReport(destination, reportFormat, reportContext, reportObservations)
      setReportOpen(false)
      setReductionMessage(`观测报告已导出：${destination}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setReportBusy(false)
    }
  }, [reportContext, reportFormat, reportObservations, setError])

  useEffect(() => {
    if (!reportOpen || !reportContext) return
    let active = true
    setReportPreview('')
    setReportBusy(true)
    void previewReport(reportFormat, reportContext, reportObservations)
      .then((preview) => {
        if (active) setReportPreview(preview)
      })
      .catch((error) => {
        if (active) setError(String(error))
      })
      .finally(() => {
        if (active) setReportBusy(false)
      })
    return () => {
      active = false
    }
  }, [reportOpen, reportFormat, reportContext, reportObservations, setError])

  const beginManualCalibration = useCallback(
    async (frameIndex: number, solveParams: SolveParams) => {
      manualFrameIndex.current = frameIndex
      const blinkState = await blinkSetFrame(frameIndex)
      setBlinkState(blinkState)

      const analysis = await getFrameAnalysis(frameIndex)
      if (!analysis.detection || !analysis.catalog) return false

      const frame = frames[frameIndex]
      if (!frame) return false
      const solvedWcs = analysis.solution?.wcs
      const solvedScale = solvedWcs
        ? (Math.hypot(solvedWcs.cd1_1, solvedWcs.cd2_1) +
            Math.hypot(solvedWcs.cd1_2, solvedWcs.cd2_2)) *
          1_800
        : undefined
      const solvedRotation = solvedWcs
        ? (Math.atan2(solvedWcs.cd2_1, solvedWcs.cd1_1) * 180) / Math.PI
        : undefined
      const solvedParity = solvedWcs
        ? solvedWcs.cd1_1 * solvedWcs.cd2_2 - solvedWcs.cd1_2 * solvedWcs.cd2_1 < 0
        : undefined
      const scale = solveParams.pixel_scale_arcsec ?? solvedScale ?? frame?.pixel_scale_arcsec
      if (scale == null || !Number.isFinite(scale)) return false

      setDetection(analysis.detection)
      setManualCalibration({
        sources: analysis.catalog.sources,
        seed: {
          center_ra_deg: solvedWcs?.crval1 ?? analysis.catalog.query.ra_deg,
          center_dec_deg: solvedWcs?.crval2 ?? analysis.catalog.query.dec_deg,
          pixel_scale_arcsec: scale,
          rotation_deg: solveParams.rotation_deg ?? solvedRotation ?? frame?.rotation_deg ?? 0,
          parity_flipped:
            solveParams.parity_flipped ?? solvedParity ?? frame?.parity_flipped ?? false,
          offset_x_px: solvedWcs ? solvedWcs.crpix1 - frame.width * 0.5 : 0,
          offset_y_px: solvedWcs ? solvedWcs.crpix2 - frame.height * 0.5 : 0,
          catalog_bright_limit_mag: solveParams.catalog_bright_limit_mag ?? 5,
          catalog_faint_limit_mag: Math.min(
            22,
            Math.max(20, solveParams.catalog_faint_limit_mag ?? 20),
          ),
        },
      })
      setShowReductionSettings(false)
      setReductionMessage(null)
      return true
    },
    [frames, setBlinkState, setDetection],
  )

  const handleReduction = useCallback(
    async (params: SolveParams = {}) => {
      const configuredScale =
        appConfig?.instrument.focal_length_mm && appConfig.instrument.pixel_width_um
          ? (206.265 * appConfig.instrument.pixel_width_um) / appConfig.instrument.focal_length_mm
          : undefined
      const configuredParity = appConfig
        ? appConfig.instrument.flip_horizontal !== appConfig.instrument.flip_vertical
        : undefined
      const effectiveParams: SolveParams = {
        pixel_scale_arcsec: configuredScale,
        rotation_deg: appConfig?.instrument.position_angle_deg,
        parity_flipped: configuredParity || undefined,
        catalog_bright_limit_mag: appConfig?.reduction.catalog_bright_limit_mag,
        catalog_faint_limit_mag: appConfig?.reduction.catalog_faint_limit_mag,
        maximum_reference_stars: appConfig?.reduction.maximum_reference_stars,
        astrometric_residual_limit_arcsec: appConfig?.reduction.astrometric_residual_limit_arcsec,
        ...params,
      }
      lastSolveParams.current = effectiveParams
      setManualCalibration(null)
      setManualQueue([])
      manualFrameIndex.current = null
      setError(null)
      setReductionMessage(null)
      setReductionProgress(null)
      setIsDetecting(true)
      try {
        setIsDetecting(false)
        setIsSolving(true)
        const batch = await startReduction(effectiveParams, (progress) => {
          setReductionProgress(progress.message)
        })
        const pendingFrames = batch.frames.filter((frame) => frame.solution.status !== 'accepted')
        const missingHintFrames = pendingFrames.filter(
          (frame) => frame.solution.failure_code === 'missing_hint',
        )
        const photometryFailures = batch.frames.filter(
          (frame) => frame.solution.status === 'accepted' && frame.photometry_error,
        )
        const automaticPhotometryFailed =
          pendingFrames.length === 0 && photometryFailures.length > 0
        if (!automaticPhotometryFailed) {
          for (const frame of batch.frames) {
            setFrameReduction(
              frame.frame_index,
              frame.detection,
              frame.solution,
              frame.photometry,
              frame.photometry_error,
            )
          }
        }
        const photometryFailureMessage =
          photometryFailures.length > 0
            ? `REFCAT2 光度定标失败（${photometryFailures.map((frame) => `第 ${frame.frame_index + 1} 帧：${frame.photometry_error}`).join('；')}）。${automaticPhotometryFailed ? '本次自动归算结果已全部丢弃，请修正配置或数据后重新归算。' : '当前仍有帧需要人工校准，中间结果仅用于继续人工校准。'}`
            : null

        if (pendingFrames.length === 0) {
          if (photometryFailureMessage) {
            setError(photometryFailureMessage)
          } else {
            const scope =
              batch.frames.length > 1 ? `整组 ${batch.frames.length} 帧归算完成` : '本帧归算完成'
            setReductionMessage(`${scope}；REFCAT2 光度定标全部完成。`)
          }
          setShowReductionSettings(false)
        } else if (missingHintFrames.length > 0) {
          const firstMissing = missingHintFrames[0]
          const blinkState = await blinkSetFrame(firstMissing.frame_index)
          setBlinkState(blinkState)
          const astrometryError =
            missingHintFrames.length > 1
              ? `整组有 ${missingHintFrames.length} 帧缺少归算初值。${firstMissing.solution.message}`
              : firstMissing.solution.message
          setError(
            photometryFailureMessage
              ? `${astrometryError}\n${photometryFailureMessage}`
              : astrometryError,
          )
          setShowReductionSettings(true)
        } else {
          const [firstPending, ...remainingFrames] = pendingFrames
          setManualQueue(remainingFrames.map((frame) => frame.frame_index))
          const manualOpened = await beginManualCalibration(
            firstPending.frame_index,
            effectiveParams,
          )
          if (manualOpened) {
            setError(photometryFailureMessage)
            setShowReductionSettings(false)
          } else {
            setError(
              photometryFailureMessage
                ? `${firstPending.solution.message}\n${photometryFailureMessage}`
                : firstPending.solution.message,
            )
            setShowReductionSettings(true)
          }
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setIsDetecting(false)
        setIsSolving(false)
        setReductionProgress(null)
      }
    },
    [
      appConfig,
      beginManualCalibration,
      setBlinkState,
      setError,
      setIsDetecting,
      setIsSolving,
      setFrameReduction,
    ],
  )

  const updateManualSeed = useCallback((seed: ManualCalibrationSeed) => {
    setManualCalibration((current) => (current ? { ...current, seed } : current))
  }, [])

  const handleManualRefine = useCallback(async () => {
    if (!manualCalibration) return
    setManualBusy(true)
    setError(null)
    setReductionProgress('正在使用人工初值重新归算…')
    setIsSolving(true)
    try {
      const seed = manualCalibration.seed
      const solution = await plateSolve({
        center_ra_deg: seed.center_ra_deg,
        center_dec_deg: seed.center_dec_deg,
        pixel_scale_arcsec: seed.pixel_scale_arcsec,
        rotation_deg: seed.rotation_deg,
        parity_flipped: seed.parity_flipped,
        offset_x_px: seed.offset_x_px,
        offset_y_px: seed.offset_y_px,
        catalog_bright_limit_mag: seed.catalog_bright_limit_mag,
        catalog_faint_limit_mag: seed.catalog_faint_limit_mag,
      })
      setSolution(solution)
      if (!solution.success) {
        setError(`使用人工初值归算后仍未通过：${solution.message}`)
        const wcs = solution.wcs
        const frame = frames[currentFrameIndex]
        if (wcs && frame) {
          const scale =
            (Math.hypot(wcs.cd1_1, wcs.cd2_1) + Math.hypot(wcs.cd1_2, wcs.cd2_2)) * 1_800
          const determinant = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1
          setManualCalibration((current) =>
            current
              ? {
                  ...current,
                  seed: {
                    ...current.seed,
                    center_ra_deg: wcs.crval1,
                    center_dec_deg: wcs.crval2,
                    pixel_scale_arcsec: scale,
                    rotation_deg: (Math.atan2(wcs.cd2_1, wcs.cd1_1) * 180) / Math.PI,
                    parity_flipped: determinant < 0,
                    offset_x_px: wcs.crpix1 - frame.width * 0.5,
                    offset_y_px: wcs.crpix2 - frame.height * 0.5,
                  },
                }
              : current,
          )
        }
      } else {
        let photometryMessage: string | null = null
        let photometryError: string | null = null
        setReductionProgress('WCS 已通过，正在使用 REFCAT2 进行光度定标…')
        try {
          const calibrated = await calibrateFramePhotometry(currentFrameIndex)
          setMeasurements((current) =>
            current.map(
              (measurement) =>
                calibrated.measurements.find((item) => item.id === measurement.id) ?? measurement,
            ),
          )
          const analysis = await getFrameAnalysis(currentFrameIndex)
          setFrameReduction(
            currentFrameIndex,
            analysis.detection,
            solution,
            analysis.photometry,
            analysis.photometry_error,
          )
          photometryMessage = `；光度定标完成，${calibrated.matched_reference_stars} 颗参考星，ZP ${calibrated.solution.zero_point.toFixed(3)}`
        } catch (reason) {
          photometryError = `REFCAT2 光度定标失败：${String(reason)}。本帧 WCS 已保留，但在重新归算并成功完成光度定标前只能保留 flux。`
        }
        setManualCalibration(null)
        manualFrameIndex.current = null
        const [nextFrameIndex, ...remainingFrames] = manualQueue
        if (nextFrameIndex == null) {
          if (photometryError) {
            setError(photometryError)
          } else {
            setReductionMessage(
              frames.length > 1
                ? `整组 ${frames.length} 帧归算完成${photometryMessage ?? ''}。`
                : `${solution.message}${photometryMessage ?? ''}`,
            )
          }
        } else {
          setManualQueue(remainingFrames)
          const manualOpened = await beginManualCalibration(nextFrameIndex, lastSolveParams.current)
          if (!manualOpened) {
            const nextFrameError = '下一帧无法直接进入人工对齐，请补充归算初值。'
            setError(photometryError ? `${nextFrameError}\n${photometryError}` : nextFrameError)
            setShowReductionSettings(true)
          } else if (photometryError) {
            setError(photometryError)
          }
        }
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setManualBusy(false)
      setIsSolving(false)
      setReductionProgress(null)
    }
  }, [
    beginManualCalibration,
    currentFrameIndex,
    frames,
    manualCalibration,
    manualQueue,
    setError,
    setFrameReduction,
    setIsSolving,
    setSolution,
  ])

  useEffect(() => {
    if (manualCalibration && manualFrameIndex.current !== currentFrameIndex) {
      setManualCalibration(null)
      setManualQueue([])
      manualFrameIndex.current = null
    }
  }, [currentFrameIndex, manualCalibration])

  return (
    <div className="relative h-screen w-screen flex flex-col bg-sky-canvas-soft-2 overflow-hidden">
      <TitleBar settingsOpen={settingsOpen} onSettings={() => setSettingsOpen((value) => !value)} />

      {/* Toolbar */}
      <Toolbar aria-label="图像操作">
        <Button variant="tool" size="sm" onClick={handleOpen} disabled={isLoading}>
          <FolderOpen size={14} />
          打开图像
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCloseAllImages}
          disabled={
            frames.length === 0 ||
            isLoading ||
            isDetecting ||
            isSolving ||
            knownSearchBusy ||
            scienceBusy
          }
          title={frames.length === 0 ? '当前没有可关闭的图像' : '关闭所有图像'}
        >
          <ImageOff size={14} />
          关闭所有图像
        </Button>

        <div className="h-4 w-px bg-sky-hairline" aria-hidden="true" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleReduction()}
          disabled={frames.length === 0 || isDetecting || isSolving}
          title={frames.length === 0 ? '请先打开 FITS 文件' : '执行图像归算'}
        >
          <Orbit size={14} />
          归算
        </Button>
        <Button
          variant={knownVisible ? 'tool' : 'ghost'}
          size="sm"
          onClick={handleKnownToggle}
          disabled={knownSearchBusy || !knownPrerequisites}
          title={
            !mpcorb
              ? '请先下载 MPCORB'
              : !knownPrerequisites
                ? '需要整组图片都完成 WCS 归算并具有 UTC 曝光中点'
                : '一次计算并显示整组图片中的已知小行星'
          }
        >
          {knownVisible ? <EyeOff size={14} /> : <Eye size={14} />}{' '}
          {knownVisible ? `隐藏已知目标 (${knownObjectCount})` : '显示已知目标'}
        </Button>

        <div className="h-4 w-px bg-sky-hairline" aria-hidden="true" />
        <Button
          variant="tool"
          size="sm"
          className={measurementMode ? 'bg-sky-control-hover text-sky-ink' : ''}
          onClick={() => setMeasurementMode((v) => !v)}
          disabled={!canMeasure}
          aria-pressed={measurementMode}
          title={
            canMeasure
              ? measurementMode
                ? '等待在图像上点击一个可疑目标'
                : '点击后标记下一个可疑目标'
              : '当前帧需要先通过 WCS 归算'
          }
        >
          <Crosshair size={14} />
          标记可疑目标
        </Button>
        <Button
          variant="tool"
          size="sm"
          className={scienceOpen ? 'bg-sky-control-hover text-sky-ink' : ''}
          onClick={() => setScienceOpen((open) => !open)}
          disabled={measurements.length === 0}
          aria-pressed={scienceOpen}
          title={measurements.length === 0 ? '当前没有可疑目标' : '打开或关闭可疑目标列表'}
        >
          <ListChecks size={14} />
          可疑目标列表
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={openReportDialog}
          disabled={!appConfig || reportMeasurements.length === 0}
          title={
            reportMeasurements.length === 0
              ? '至少需要一条可疑目标记录'
              : '选择 ADES PSV 或 MPC 80-column 格式导出'
          }
        >
          <FileOutput size={14} />
          导出报告
        </Button>
      </Toolbar>

      {showReductionSettings && frames[currentFrameIndex] && (
        <ReductionSettings
          frame={frames[currentFrameIndex]}
          busy={isDetecting || isSolving}
          onClose={() => setShowReductionSettings(false)}
          onSubmit={handleReduction}
        />
      )}

      {error && (
        <MessageDialog
          tone="error"
          title="操作未完成"
          message={error}
          onClose={() => setError(null)}
        />
      )}
      {!error && reductionMessage && (
        <MessageDialog
          tone="success"
          title="归算完成"
          message={reductionMessage}
          onClose={() => setReductionMessage(null)}
        />
      )}

      {/* Main Area */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <FITSViewer
            manualCalibration={manualCalibration}
            onManualOffsetChange={(x, y) => {
              if (!manualCalibration) return
              updateManualSeed({
                ...manualCalibration.seed,
                offset_x_px: x,
                offset_y_px: y,
              })
            }}
            measurementMode={measurementMode}
            onMeasure={handleMeasure}
            measurements={measurements}
            knownObjects={knownVisible ? currentKnownObjects : []}
          />
          {scienceOpen && (
            <SciencePanel
              measurements={measurements}
              canMatch={Boolean(mpcorb)}
              busy={scienceBusy}
              onClose={() => setScienceOpen(false)}
              onMatch={handleMatch}
              onDelete={handleDeleteMeasurement}
              onRename={handleRenameMeasurement}
            />
          )}
        </div>
        {frames.length > 0 && (
          <DisplaySidebar
            stretchMode={stretchMode}
            onStretchModeChange={(mode) => {
              stretchCache.current.clear()
              setStretchMode(mode)
            }}
            inverted={inverted}
            onInvertedChange={(nextInverted) => {
              stretchCache.current.clear()
              setInverted(nextInverted)
            }}
            onFitView={requestFit}
          />
        )}
      </div>

      {manualCalibration && (
        <ManualCalibrationPanel
          calibration={manualCalibration}
          approximateMatches={approximateManualMatches}
          busy={manualBusy}
          onChange={updateManualSeed}
          onApply={handleManualRefine}
          onClose={() => {
            setManualCalibration(null)
            setManualQueue([])
            manualFrameIndex.current = null
          }}
        />
      )}

      {settingsOpen && appConfig && (
        <SettingsDialog
          config={appConfig}
          mpcorb={mpcorb}
          mpcorbBusy={scienceBusy}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveConfig}
          onUpdateMpcorb={handleMpcUpdate}
        />
      )}

      {pendingMeasurement && (
        <SuspiciousTargetDialog
          measurement={pendingMeasurement}
          pixels={framePixels[pendingMeasurement.frame_index]}
          width={frames[pendingMeasurement.frame_index]?.width ?? frameWidth}
          height={frames[pendingMeasurement.frame_index]?.height ?? frameHeight}
          busy={scienceBusy}
          onConfirm={confirmMeasurement}
          onCancel={cancelMeasurement}
        />
      )}

      {reportOpen && (
        <ReportExportDialog
          format={reportFormat}
          preview={reportPreview}
          busy={reportBusy}
          onFormatChange={setReportFormat}
          onExport={handleReportExport}
          onClose={() => setReportOpen(false)}
        />
      )}

      {isLoading && (
        <OperationDialog title="正在读取 FITS" message={loadingProgress ?? '正在读取图像信息…'} />
      )}
      {!isLoading && (isDetecting || isSolving) && (
        <OperationDialog
          title="正在归算"
          message={reductionProgress ?? (isDetecting ? '正在提取星点…' : '正在匹配星表并拟合 WCS…')}
        />
      )}
      {knownSearchBusy && (
        <OperationDialog
          title="正在解析已知目标"
          message={`正在解析本地 MPCORB 并标识已知小行星位置…`}
        />
      )}
    </div>
  )
}

export default App
