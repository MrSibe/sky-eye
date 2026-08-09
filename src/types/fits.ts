export interface FitsMeta {
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
  focal_length: number | null
  pixel_size: number | null
  pixel_scale_arcsec: number | null
  rotation_deg: number | null
  parity_flipped: boolean | null
}
