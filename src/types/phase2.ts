export interface DetectedStar {
  x: number
  y: number
  peak: number
  flux: number
  fwhm: number
  ellipticity: number
  npix: number
  flags: number
  saturated: boolean
  snr: number | null
  x_error_px: number | null
  y_error_px: number | null
  centroid_refined: boolean
}

export interface DetectionResult {
  stars: DetectedStar[]
  astrometry_stars: DetectedStar[]
  noise: number
  background: number
  num_stars: number
  backend: string
}

export interface WCS {
  crpix1: number
  crpix2: number
  crval1: number
  crval2: number
  cd1_1: number
  cd1_2: number
  cd2_1: number
  cd2_2: number
  image_width: number
  image_height: number
}

export interface PlateSolveResult {
  run_id: string | null
  success: boolean
  status: 'accepted' | 'review_required' | 'rejected'
  failure_code: string | null
  wcs: WCS | null
  num_matched: number
  num_catalog: number
  residual_rms: number | null
  backend: string | null
  message: string
  matches: Array<{
    image_source_index: number
    catalog_source_index: number
    residual_arcsec: number
    residual_x_arcsec: number
    residual_y_arcsec: number
    weight: number
    used: boolean
    rejection_reason: string | null
  }>
  quality: AstrometricQuality | null
  manual_review_confirmed: boolean
}

export interface AstrometricQuality {
  status: 'accepted' | 'review_required' | 'rejected'
  matched: number
  occupied_grid_cells: number
  residual_rms_arcsec: number
  residual_median_arcsec: number
  residual_p68_arcsec: number
  residual_p95_arcsec: number
  rms_ra_arcsec: number
  rms_dec_arcsec: number
  mean_ra_arcsec: number
  mean_dec_arcsec: number
  spatial_trend_arcsec: number
  distortion_suspected: boolean
  reasons: string[]
}

export interface FrameAnalysis {
  detection: DetectionResult | null
  catalog: GaiaQueryResult | null
  solution: PlateSolveResult | null
  photometry: FramePhotometry | null
  photometry_error: string | null
}

export interface PhotometricSolution {
  band: string
  zero_point: number
  color_term: number | null
  rms_mag: number
  reference_stars: number
  accepted: boolean
  reason: string
}

export interface FramePhotometry {
  solution: PhotometricSolution
  catalog_sha256: string
}

export interface GaiaQuery {
  ra_deg: number
  dec_deg: number
  radius_deg: number
  observation_jd?: number
  max_rows?: number
}

export interface GaiaSource {
  source_id: string
  ra_deg: number
  dec_deg: number
  catalog_ra_deg: number
  catalog_dec_deg: number
  pm_ra_mas_per_year: number | null
  pm_dec_mas_per_year: number | null
  ra_error_mas: number | null
  dec_error_mas: number | null
  pm_ra_error_mas_per_year: number | null
  pm_dec_error_mas_per_year: number | null
  ra_dec_correlation: number | null
  parallax_mas: number | null
  parallax_error_mas: number | null
  ruwe: number | null
  duplicated_source: boolean
  astrometric_params_solved: number | null
  propagated_ra_error_mas: number | null
  propagated_dec_error_mas: number | null
  g_mag: number | null
  epoch_year: number
}

export interface GaiaQueryResult {
  catalog: string
  endpoint: string
  query: {
    ra_deg: number
    dec_deg: number
    radius_deg: number
    epoch_year: number
    max_rows: number
  }
  sources: GaiaSource[]
  cached: boolean
  adql: string
  response_sha256: string
  queried_unix: number
}

export interface FrameMeta {
  id: number
  path: string
  width: number
  height: number
  min_val: number
  max_val: number
  object: string | null
  ra: number | null
  dec: number | null
  exposure: number | null
  filter: string | null
  date_obs: string | null
  selected_hdu: number
  image_hdu_count: number
  timesys: string
  time_reference: string | null
  diagnostics: string[]
  observation_midpoint_jd: number | null
  focal_length: number | null
  pixel_size: number | null
  pixel_scale_arcsec: number | null
  rotation_deg: number | null
  parity_flipped: boolean | null
  label: string
  solved: boolean
}

export interface BlinkState {
  current_index: number
  playing: boolean
  speed_ms: number
}

export interface FrameReductionResult {
  frame_index: number
  detection: DetectionResult | null
  solution: PlateSolveResult
  photometry: FramePhotometry | null
  photometry_error: string | null
}

export interface BatchReductionResult {
  frames: FrameReductionResult[]
  solved: number
  failed: number
  session_id: string
  session_log_path: string | null
}

export interface BatchReductionProgress {
  frame_index: number
  total: number
  phase: 'detection' | 'matching' | 'photometry' | 'solved' | 'failed'
  message: string
}
