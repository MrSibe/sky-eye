use celestial_images::core::BitPix;
use celestial_images::fits::{FitsFile, FitsReader};

mod internal {
    use celestial_images::fits::{FitsError, FitsFile, FitsReader};

    pub fn read_keyword_string(
        fits: &mut FitsFile<FitsReader>,
        key: &str,
    ) -> Result<Option<String>, FitsError> {
        let val = fits.get_header_value(0, key)?;
        Ok(val.map(|s| {
            let trimmed = s.trim();
            trimmed
                .trim_start_matches('\'')
                .trim_end_matches('\'')
                .to_string()
        }))
    }

    pub fn read_keyword_f64(
        fits: &mut FitsFile<FitsReader>,
        key: &str,
    ) -> Result<Option<f64>, FitsError> {
        let val = fits.get_header_value(0, key)?;
        val.map(|s| {
            s.parse::<f64>()
                .map_err(|_| FitsError::InvalidFormat(format!("Cannot parse {} value: {}", key, s)))
        })
        .transpose()
    }
}

fn read_optional_f64(
    fits: &mut FitsFile<FitsReader>,
    keys: &[&str],
) -> Result<Option<f64>, String> {
    for &key in keys {
        if let Ok(Some(v)) = internal::read_keyword_f64(fits, key) {
            return Ok(Some(v));
        }
    }
    Ok(None)
}

#[derive(Debug, Clone)]
pub struct FitsData {
    #[allow(dead_code)]
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f32>,
    pub valid_pixels: Vec<bool>,
    pub min: f32,
    pub max: f32,
    pub metadata: FitsMetadata,
}

#[derive(Debug, Clone, Default)]
pub struct FitsMetadata {
    pub object: Option<String>,
    pub ra: Option<f64>,
    pub dec: Option<f64>,
    pub exposure: Option<f64>,
    pub filter: Option<String>,
    pub date_obs: Option<String>,
    pub focal_len: Option<f64>,
    pub pixel_size: Option<f64>,
    pub pixel_scale_arcsec: Option<f64>,
    pub rotation_deg: Option<f64>,
    pub parity_flipped: Option<bool>,
    pub saturation_level: Option<f64>,
    pub gain_e_per_adu: Option<f64>,
    pub read_noise_e: Option<f64>,
    pub blank_value: Option<f64>,
    pub upstream_wcs: Option<UpstreamWcsHint>,
    pub panstarrs_pca: Vec<PcaCoefficient>,
    pub calibration_provenance: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct UpstreamWcsHint {
    pub crpix1: f64,
    pub crpix2: f64,
    pub crval1: f64,
    pub crval2: f64,
    pub cd1_1: f64,
    pub cd1_2: f64,
    pub cd2_1: f64,
    pub cd2_2: f64,
    pub source: &'static str,
}

#[derive(Debug, Clone)]
pub struct PcaCoefficient {
    pub axis: u8,
    pub x_order: u8,
    pub y_order: u8,
    pub value: f64,
}

fn read_metadata(fits: &mut FitsFile<FitsReader>) -> Result<FitsMetadata, String> {
    let object = internal::read_keyword_string(fits, "OBJECT").map_err(|e| e.to_string())?;
    let pointing_ra = read_optional_f64(fits, &["RA", "OBJCTRA"])?;
    let pointing_dec = read_optional_f64(fits, &["DEC", "OBJCTDEC"])?;
    let exposure = internal::read_keyword_f64(fits, "EXPTIME").map_err(|e| e.to_string())?;
    let filter = internal::read_keyword_string(fits, "FILTER").map_err(|e| e.to_string())?;
    let date_obs = internal::read_keyword_string(fits, "DATE-OBS").map_err(|e| e.to_string())?;
    let focal_len = read_optional_f64(fits, &["FOCALLEN", "FOCAL", "FOCLEN"])?;
    let pixel_size = read_optional_f64(fits, &["PIXSIZE1", "XPIXSZ", "PIXSIZE", "CCDXPIXE"])?;
    let saturation_level = read_optional_f64(fits, &["SATURATE", "SATLEVEL", "MAXADU", "DATAMAX"])?
        .filter(|value| value.is_finite());
    let gain_e_per_adu = read_optional_f64(fits, &["GAIN", "EGAIN"])?
        .filter(|value| value.is_finite() && *value > 0.0);
    let read_noise_e = read_optional_f64(fits, &["RDNOISE", "READNOIS", "RON"])?
        .filter(|value| value.is_finite() && *value >= 0.0);
    let blank_value = read_optional_f64(fits, &["BLANK"])?;
    let direct_scale = read_optional_f64(fits, &["PIXSCALE", "SECPIX", "SCALE"])?;
    let cd11 = read_optional_f64(fits, &["CD1_1"])?;
    let cd12 = read_optional_f64(fits, &["CD1_2"])?;
    let cd21 = read_optional_f64(fits, &["CD2_1"])?;
    let cd22 = read_optional_f64(fits, &["CD2_2"])?;
    let cdelt1 = read_optional_f64(fits, &["CDELT1"])?;
    let cdelt2 = read_optional_f64(fits, &["CDELT2"])?;
    let pc11 = read_optional_f64(fits, &["PC1_1", "PC001001"])?;
    let pc12 = read_optional_f64(fits, &["PC1_2", "PC001002"])?;
    let pc21 = read_optional_f64(fits, &["PC2_1", "PC002001"])?;
    let pc22 = read_optional_f64(fits, &["PC2_2", "PC002002"])?;
    let crota = read_optional_f64(fits, &["CROTA2", "CROTA1"])?;
    let matrix = linear_wcs_matrix(
        cd11, cd12, cd21, cd22, pc11, pc12, pc21, pc22, cdelt1, cdelt2, crota,
    );
    let (matrix_scale, rotation_deg, parity_flipped) = matrix
        .map(|(a, b, c, d, _)| matrix_properties(a, b, c, d))
        .unwrap_or((None, None, None));
    let optical_scale = focal_len.zip(pixel_size).and_then(|(focal, pixel)| {
        if focal > 0.0 && pixel > 0.0 {
            Some((pixel / 1_000.0 / focal).to_degrees() * 3_600.0)
        } else {
            None
        }
    });
    let pixel_scale_arcsec = direct_scale
        .filter(|value| value.is_finite() && *value > 0.0)
        .or(matrix_scale)
        .or(optical_scale);

    let crpix1 = read_optional_f64(fits, &["CRPIX1"])?;
    let crpix2 = read_optional_f64(fits, &["CRPIX2"])?;
    let crval1 = read_optional_f64(fits, &["CRVAL1"])?;
    let crval2 = read_optional_f64(fits, &["CRVAL2"])?;
    let upstream_wcs = match (crpix1, crpix2, crval1, crval2, matrix) {
        (Some(crpix1), Some(crpix2), Some(crval1), Some(crval2), Some((a, b, c, d, source)))
            if [crpix1, crpix2, crval1, crval2, a, b, c, d]
                .iter()
                .all(|value| value.is_finite()) =>
        {
            Some(UpstreamWcsHint {
                crpix1,
                crpix2,
                crval1: crval1.rem_euclid(360.0),
                crval2,
                cd1_1: a,
                cd1_2: b,
                cd2_1: c,
                cd2_2: d,
                source,
            })
        }
        _ => None,
    };
    // A chip CRVAL is a materially better catalogue-query centre than the
    // camera boresight. Pan-STARRS focal-plane chips can be >0.5 deg away.
    let ra = upstream_wcs.as_ref().map(|wcs| wcs.crval1).or(pointing_ra);
    let dec = upstream_wcs.as_ref().map(|wcs| wcs.crval2).or(pointing_dec);

    let mut panstarrs_pca = Vec::new();
    for axis in 1..=2 {
        for total_order in 2..=5 {
            for x_order in 0..=total_order {
                let y_order = total_order - x_order;
                let key = format!("PCA{axis}X{x_order}Y{y_order}");
                if let Ok(Some(value)) = internal::read_keyword_f64(fits, &key) {
                    if value.is_finite() {
                        panstarrs_pca.push(PcaCoefficient {
                            axis,
                            x_order,
                            y_order,
                            value,
                        });
                    }
                }
            }
        }
    }
    let mut calibration_provenance = Vec::new();
    for key in [
        "HIERARCH DETREND.MASK",
        "HIERARCH DETREND.NOISEMAP",
        "HIERARCH DETREND.DARK",
        "HIERARCH DETREND.FLAT",
        "HIERARCH DETREND.NONLIN",
        "HIERARCH DETREND.VIDEODARK",
    ] {
        if let Ok(Some(value)) = internal::read_keyword_string(fits, key) {
            calibration_provenance.push(format!("{key}={value}"));
        }
    }

    Ok(FitsMetadata {
        object,
        ra,
        dec,
        exposure,
        filter,
        date_obs,
        focal_len,
        pixel_size,
        pixel_scale_arcsec,
        rotation_deg,
        parity_flipped,
        saturation_level,
        gain_e_per_adu,
        read_noise_e,
        blank_value,
        upstream_wcs,
        panstarrs_pca,
        calibration_provenance,
    })
}

#[allow(clippy::too_many_arguments)]
fn linear_wcs_matrix(
    cd11: Option<f64>,
    cd12: Option<f64>,
    cd21: Option<f64>,
    cd22: Option<f64>,
    pc11: Option<f64>,
    pc12: Option<f64>,
    pc21: Option<f64>,
    pc22: Option<f64>,
    cdelt1: Option<f64>,
    cdelt2: Option<f64>,
    crota_deg: Option<f64>,
) -> Option<(f64, f64, f64, f64, &'static str)> {
    if let (Some(a), Some(b), Some(c), Some(d)) = (cd11, cd12, cd21, cd22) {
        if [a, b, c, d].iter().all(|value| value.is_finite()) {
            return Some((a, b, c, d, "CD"));
        }
    }
    if let (Some(x), Some(y)) = (cdelt1, cdelt2) {
        if let (Some(p11), Some(p12), Some(p21), Some(p22)) = (pc11, pc12, pc21, pc22) {
            return Some((x * p11, x * p12, y * p21, y * p22, "PC*CDELT"));
        }
        if let Some(angle) = crota_deg.filter(|value| value.is_finite()) {
            let angle = angle.to_radians();
            return Some((
                x * angle.cos(),
                -y * angle.sin(),
                x * angle.sin(),
                y * angle.cos(),
                "CDELT+CROTA",
            ));
        }
        return Some((x, 0.0, 0.0, y, "CDELT"));
    }
    None
}

fn matrix_properties(a: f64, b: f64, c: f64, d: f64) -> (Option<f64>, Option<f64>, Option<bool>) {
    let determinant = a * d - b * c;
    let scale = determinant.abs().sqrt() * 3_600.0;
    if scale.is_finite() && scale > 0.0 {
        (
            Some(scale),
            Some(c.atan2(a).to_degrees()),
            Some(determinant < 0.0),
        )
    } else {
        (None, None, None)
    }
}

fn read_pixels(fits: &mut FitsFile<FitsReader>, bitpix: BitPix) -> Result<Vec<f32>, String> {
    match bitpix {
        BitPix::U8 => {
            let (_, data): (_, Vec<u8>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data.into_iter().map(|v| v as f32).collect())
        }
        BitPix::I16 => {
            let (_, data): (_, Vec<i16>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data.into_iter().map(|v| v as f32).collect())
        }
        BitPix::I32 => {
            let (_, data): (_, Vec<i32>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data.into_iter().map(|v| v as f32).collect())
        }
        BitPix::I64 => {
            let (_, data): (_, Vec<i64>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data.into_iter().map(|v| v as f32).collect())
        }
        BitPix::F32 => {
            let (_, data): (_, Vec<f32>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data)
        }
        BitPix::F64 => {
            let (_, data): (_, Vec<f64>) = fits.read_hdu_with_data(0).map_err(|e| e.to_string())?;
            Ok(data.into_iter().map(|v| v as f32).collect())
        }
    }
}

pub fn load_fits(path: &str) -> Result<FitsData, String> {
    let mut fits = FitsFile::open(path).map_err(|e| format!("Failed to open FITS file: {}", e))?;

    log::debug!("[sky-eye] FITS file opened: {}", path);
    log::debug!("[sky-eye]   num_hdus = {}", fits.num_hdus());
    for i in 0..fits.num_hdus() {
        if let Some(info) = fits.hdu_info(i) {
            log::debug!(
                "[sky-eye]   HDU {}: header_size={}, data_size={}",
                i,
                info.header_size,
                info.data_size
            );
        }
    }

    let (dims, bitpix) = fits.get_image_info(0).map_err(|e| e.to_string())?;
    let width = dims.first().copied().unwrap_or(0) as u32;
    let height = dims.get(1).copied().unwrap_or(0) as u32;
    log::debug!(
        "[sky-eye]   HDU 0 dims={:?}, bitpix={:?}, width={}, height={}",
        dims,
        bitpix,
        width,
        height
    );

    let metadata = read_metadata(&mut fits)?;
    let bscale = read_optional_f64(&mut fits, &["BSCALE"])?.unwrap_or(1.0);
    let bzero = read_optional_f64(&mut fits, &["BZERO"])?.unwrap_or(0.0);
    if !bscale.is_finite() || !bzero.is_finite() {
        return Err("FITS BSCALE/BZERO must be finite".to_string());
    }
    let mut pixels = read_pixels(&mut fits, bitpix)?;
    // FITS BLANK is expressed in the stored integer domain, before BSCALE and
    // BZERO. Capture validity before converting unsigned-16 convention data.
    let valid_pixels: Vec<bool> = pixels
        .iter()
        .map(|pixel| {
            pixel.is_finite()
                && metadata
                    .blank_value
                    .is_none_or(|blank| (f64::from(*pixel) - blank).abs() > f64::EPSILON)
        })
        .collect();
    apply_linear_scaling(&mut pixels, bscale, bzero);
    log::debug!(
        "[sky-eye]   pixels.len()={}, first 5: {:?}",
        pixels.len(),
        pixels.iter().take(5).copied().collect::<Vec<_>>()
    );

    let mut min = f32::MAX;
    let mut max = f32::MIN;
    for (&p, valid) in pixels.iter().zip(&valid_pixels) {
        if !valid {
            continue;
        }
        if p < min {
            min = p;
        }
        if p > max {
            max = p;
        }
    }
    log::debug!("[sky-eye]   min={}, max={}", min, max);

    Ok(FitsData {
        path: path.to_string(),
        width,
        height,
        pixels,
        valid_pixels,
        min,
        max,
        metadata,
    })
}

fn apply_linear_scaling(pixels: &mut [f32], bscale: f64, bzero: f64) {
    if bscale == 1.0 && bzero == 0.0 {
        return;
    }
    for pixel in pixels {
        *pixel = (f64::from(*pixel) * bscale + bzero) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_linear_scaling, linear_wcs_matrix, load_fits, matrix_properties};
    use serde::Deserialize;
    use std::path::PathBuf;

    #[derive(Deserialize)]
    struct GoldenManifest {
        expected: GoldenExpected,
        frames: Vec<GoldenFrame>,
    }

    #[derive(Deserialize)]
    struct GoldenExpected {
        width: u32,
        height: u32,
        exposure_seconds: f64,
    }

    #[derive(Deserialize)]
    struct GoldenFrame {
        file: String,
        bytes: u64,
        sha256: String,
    }

    #[test]
    fn applies_fits_unsigned_sixteen_bit_convention() {
        let mut pixels = [-32_768.0, -32_761.0, -2_811.0, 32_767.0];
        apply_linear_scaling(&mut pixels, 1.0, 32_768.0);
        assert_eq!(pixels, [0.0, 7.0, 29_957.0, 65_535.0]);
    }

    #[test]
    fn applies_general_bscale_before_bzero() {
        let mut pixels = [1.0, 2.0];
        apply_linear_scaling(&mut pixels, 2.0, 10.0);
        assert_eq!(pixels, [12.0, 14.0]);
    }

    #[test]
    fn derives_scale_rotation_and_parity_from_cd_matrix() {
        let matrix = linear_wcs_matrix(
            Some(-0.000_25),
            Some(0.0),
            Some(0.0),
            Some(0.000_25),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let (scale, rotation, flipped) = matrix_properties(matrix.0, matrix.1, matrix.2, matrix.3);
        assert!((scale.unwrap() - 0.9).abs() < 1.0e-9);
        assert!((rotation.unwrap().abs() - 180.0).abs() < 1.0e-9);
        assert_eq!(flipped, Some(true));
    }

    #[test]
    fn derives_rotation_from_legacy_crota() {
        let matrix = linear_wcs_matrix(
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(7.13e-5),
            Some(7.13e-5),
            Some(81.5895),
        )
        .unwrap();
        let (_, rotation, _) = matrix_properties(matrix.0, matrix.1, matrix.2, matrix.3);
        assert!((rotation.unwrap() - 81.5895).abs() < 1.0e-8);
        assert_eq!(matrix.4, "CDELT+CROTA");
    }

    #[test]
    fn validates_panstarrs_golden_headers_when_configured() {
        let Ok(root) = std::env::var("SKYEYE_GOLDEN_DIR") else {
            return;
        };
        let manifest: GoldenManifest =
            serde_json::from_str(include_str!("../../tests/golden/panstarrs-chip.json"))
                .expect("golden manifest must be valid JSON");

        for expected in manifest.frames {
            let path = PathBuf::from(&root).join(&expected.file);
            let metadata = std::fs::metadata(&path).expect("golden FITS must exist");
            assert_eq!(
                metadata.len(),
                expected.bytes,
                "{} byte size",
                expected.file
            );
            assert_eq!(
                crate::project::sha256_file(&path).expect("golden hash"),
                expected.sha256,
                "{} checksum",
                expected.file
            );
            let fits = load_fits(path.to_str().expect("UTF-8 golden path")).expect("read golden");
            assert_eq!(fits.width, manifest.expected.width);
            assert_eq!(fits.height, manifest.expected.height);
            assert_eq!(fits.valid_pixels.len(), fits.pixels.len());
            assert!(fits.metadata.blank_value.is_some());
            assert!(fits.metadata.upstream_wcs.is_some());
            assert!(!fits.metadata.panstarrs_pca.is_empty());
            assert!(
                (fits.metadata.exposure.unwrap() - manifest.expected.exposure_seconds).abs()
                    < 1.0e-6
            );
        }
    }
}
