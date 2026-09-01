use fitsio::{hdu::HduInfo, FileOpenMode, FitsFile};
use std::{
    collections::hash_map::DefaultHasher,
    ffi::CString,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};
use time::OffsetDateTime;

fn hdu_search_order(selected_hdu: usize) -> Vec<usize> {
    if selected_hdu == 0 {
        vec![0]
    } else {
        vec![selected_hdu, 0]
    }
}

fn read_keyword_string(
    fits: &mut FitsFile,
    selected_hdu: usize,
    key: &str,
) -> Result<Option<String>, String> {
    for index in hdu_search_order(selected_hdu) {
        let hdu = fits.hdu(index).map_err(|e| e.to_string())?;
        if let Ok(value) = hdu.read_key::<String>(fits, key) {
            let value = value.trim().trim_matches('\'').trim().to_string();
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn read_optional_f64(
    fits: &mut FitsFile,
    selected_hdu: usize,
    keys: &[&str],
    diagnostics: &mut Vec<String>,
) -> Result<Option<f64>, String> {
    for &key in keys {
        let Some(raw) = read_keyword_string(fits, selected_hdu, key)? else {
            continue;
        };
        match raw.parse::<f64>() {
            Ok(value) => return Ok(Some(value)),
            Err(_) => diagnostics.push(format!("{key} exists but is not numeric: {raw}")),
        }
    }
    Ok(None)
}

fn parse_sexagesimal(raw: &str, is_ra: bool) -> Option<f64> {
    if let Ok(value) = raw.trim().parse::<f64>() {
        return Some(if is_ra {
            value.rem_euclid(360.0)
        } else {
            value
        });
    }
    let normalized = raw
        .trim()
        .replace(['h', 'H', 'd', 'D', 'm', 'M', 's', 'S', ':'], " ");
    let parts = normalized
        .split_whitespace()
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.len() != 3 {
        return None;
    }
    let sign = if parts[0].is_sign_negative() {
        -1.0
    } else {
        1.0
    };
    let mut value = parts[0].abs() + parts[1].abs() / 60.0 + parts[2].abs() / 3600.0;
    value *= sign;
    if is_ra {
        value = (value * 15.0).rem_euclid(360.0);
    }
    Some(value)
}

fn read_coordinate(
    fits: &mut FitsFile,
    selected_hdu: usize,
    keys: &[&str],
    is_ra: bool,
    diagnostics: &mut Vec<String>,
) -> Result<Option<f64>, String> {
    for &key in keys {
        let Some(raw) = read_keyword_string(fits, selected_hdu, key)? else {
            continue;
        };
        match parse_sexagesimal(&raw, is_ra) {
            Some(value) if value.is_finite() && (is_ra || (-90.0..=90.0).contains(&value)) => {
                return Ok(Some(value));
            }
            _ => diagnostics.push(format!(
                "{key} exists but cannot be parsed as a coordinate: {raw}"
            )),
        }
    }
    Ok(None)
}

fn jd_to_rfc3339(jd: f64) -> Option<String> {
    if !jd.is_finite() {
        return None;
    }
    let nanos = ((jd - 2_440_587.5) * 86_400.0 * 1.0e9).round() as i128;
    OffsetDateTime::from_unix_timestamp_nanos(nanos)
        .ok()
        .and_then(|value| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
}

fn read_observation_time(
    fits: &mut FitsFile,
    selected_hdu: usize,
    diagnostics: &mut Vec<String>,
) -> Result<(Option<String>, String, Option<String>), String> {
    let timesys = read_keyword_string(fits, selected_hdu, "TIMESYS")?
        .unwrap_or_else(|| "UTC".to_string())
        .to_uppercase();
    let candidates = [
        ("DATE-AVG", "MJD-AVG", "average"),
        ("DATE-BEG", "MJD-BEG", "begin"),
        ("DATE-OBS", "MJD-OBS", "observation"),
    ];
    for (date_key, mjd_key, reference) in candidates {
        if let Some(mut value) = read_keyword_string(fits, selected_hdu, date_key)? {
            if !value.contains('T') && !value.contains(' ') {
                if let Some(time_obs) = read_keyword_string(fits, selected_hdu, "TIME-OBS")? {
                    value = format!("{value}T{time_obs}");
                }
            }
            if value.contains(' ') && !value.contains('T') {
                value = value.replacen(' ', "T", 1);
            }
            if timesys != "UTC" {
                diagnostics.push(format!(
                    "{date_key} uses TIMESYS={timesys}; UTC conversion is not yet available"
                ));
                return Ok((None, timesys, Some(reference.to_string())));
            }
            if crate::core::AstroTime::from_fits_utc(&value).is_err() {
                diagnostics.push(format!(
                    "{date_key} exists but is not a supported FITS timestamp: {value}"
                ));
            }
            return Ok((Some(value), timesys, Some(reference.to_string())));
        }
        if let Some(mjd) = read_optional_f64(fits, selected_hdu, &[mjd_key], diagnostics)? {
            if timesys != "UTC" {
                diagnostics.push(format!(
                    "{mjd_key} uses TIMESYS={timesys}; UTC conversion is not yet available"
                ));
                return Ok((None, timesys, Some(reference.to_string())));
            }
            return Ok((
                jd_to_rfc3339(mjd + 2_400_000.5),
                timesys,
                Some(reference.to_string()),
            ));
        }
    }
    if let Some(jd) = read_optional_f64(fits, selected_hdu, &["JD"], diagnostics)? {
        if timesys == "UTC" {
            return Ok((jd_to_rfc3339(jd), timesys, Some("observation".to_string())));
        }
        diagnostics.push(format!(
            "JD uses TIMESYS={timesys}; UTC conversion is not yet available"
        ));
    }
    Ok((None, timesys, None))
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
    pub selected_hdu: usize,
    pub image_hdu_count: usize,
    pub object: Option<String>,
    pub ra: Option<f64>,
    pub dec: Option<f64>,
    pub exposure: Option<f64>,
    pub filter: Option<String>,
    pub date_obs: Option<String>,
    pub timesys: String,
    pub time_reference: Option<String>,
    pub observation_midpoint_jd: Option<f64>,
    pub observation_midpoint_utc: Option<String>,
    pub diagnostics: Vec<String>,
    pub focal_len: Option<f64>,
    pub pixel_size: Option<f64>,
    pub pixel_scale_arcsec: Option<f64>,
    pub rotation_deg: Option<f64>,
    pub parity_flipped: Option<bool>,
    pub saturation_level: Option<f64>,
    pub gain_e_per_adu: Option<f64>,
    pub read_noise_e: Option<f64>,
    #[allow(dead_code)]
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

fn read_metadata(
    fits: &mut FitsFile,
    selected_hdu: usize,
    image_hdu_count: usize,
) -> Result<FitsMetadata, String> {
    let mut diagnostics = Vec::new();
    let object = read_keyword_string(fits, selected_hdu, "OBJECT")?;
    let pointing_ra = read_coordinate(
        fits,
        selected_hdu,
        &["RA", "OBJCTRA"],
        true,
        &mut diagnostics,
    )?;
    let pointing_dec = read_coordinate(
        fits,
        selected_hdu,
        &["DEC", "OBJCTDEC"],
        false,
        &mut diagnostics,
    )?;
    let exposure = read_optional_f64(
        fits,
        selected_hdu,
        &["EXPTIME", "EXPOSURE"],
        &mut diagnostics,
    )?;
    let filter = read_keyword_string(fits, selected_hdu, "FILTER")?;
    let (date_obs, timesys, time_reference) =
        read_observation_time(fits, selected_hdu, &mut diagnostics)?;
    let focal_len = read_optional_f64(
        fits,
        selected_hdu,
        &["FOCALLEN", "FOCAL", "FOCLEN"],
        &mut diagnostics,
    )?;
    let pixel_size = read_optional_f64(
        fits,
        selected_hdu,
        &["PIXSIZE1", "XPIXSZ", "PIXSIZE", "CCDXPIXE"],
        &mut diagnostics,
    )?;
    let saturation_level = read_optional_f64(
        fits,
        selected_hdu,
        &["SATURATE", "SATLEVEL", "MAXADU", "DATAMAX"],
        &mut diagnostics,
    )?
    .filter(|value| value.is_finite());
    let gain_e_per_adu =
        read_optional_f64(fits, selected_hdu, &["GAIN", "EGAIN"], &mut diagnostics)?
            .filter(|value| value.is_finite() && *value > 0.0);
    let read_noise_e = read_optional_f64(
        fits,
        selected_hdu,
        &["RDNOISE", "READNOIS", "RON"],
        &mut diagnostics,
    )?
    .filter(|value| value.is_finite() && *value >= 0.0);
    let blank_value = read_optional_f64(fits, selected_hdu, &["BLANK"], &mut diagnostics)?;
    let direct_scale = read_optional_f64(
        fits,
        selected_hdu,
        &["PIXSCALE", "SECPIX", "SCALE"],
        &mut diagnostics,
    )?;
    let cd11 = read_optional_f64(fits, selected_hdu, &["CD1_1"], &mut diagnostics)?;
    let cd12 = read_optional_f64(fits, selected_hdu, &["CD1_2"], &mut diagnostics)?;
    let cd21 = read_optional_f64(fits, selected_hdu, &["CD2_1"], &mut diagnostics)?;
    let cd22 = read_optional_f64(fits, selected_hdu, &["CD2_2"], &mut diagnostics)?;
    let cdelt1 = read_optional_f64(fits, selected_hdu, &["CDELT1"], &mut diagnostics)?;
    let cdelt2 = read_optional_f64(fits, selected_hdu, &["CDELT2"], &mut diagnostics)?;
    let pc11 = read_optional_f64(fits, selected_hdu, &["PC1_1", "PC001001"], &mut diagnostics)?;
    let pc12 = read_optional_f64(fits, selected_hdu, &["PC1_2", "PC001002"], &mut diagnostics)?;
    let pc21 = read_optional_f64(fits, selected_hdu, &["PC2_1", "PC002001"], &mut diagnostics)?;
    let pc22 = read_optional_f64(fits, selected_hdu, &["PC2_2", "PC002002"], &mut diagnostics)?;
    let crota = read_optional_f64(fits, selected_hdu, &["CROTA2", "CROTA1"], &mut diagnostics)?;
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

    let crpix1 = read_optional_f64(fits, selected_hdu, &["CRPIX1"], &mut diagnostics)?;
    let crpix2 = read_optional_f64(fits, selected_hdu, &["CRPIX2"], &mut diagnostics)?;
    let crval1 = read_optional_f64(fits, selected_hdu, &["CRVAL1"], &mut diagnostics)?;
    let crval2 = read_optional_f64(fits, selected_hdu, &["CRVAL2"], &mut diagnostics)?;
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
                if let Ok(Some(value)) =
                    read_optional_f64(fits, selected_hdu, &[&key], &mut diagnostics)
                {
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
        if let Ok(Some(value)) = read_keyword_string(fits, selected_hdu, key) {
            calibration_provenance.push(format!("{key}={value}"));
        }
    }

    Ok(FitsMetadata {
        selected_hdu,
        image_hdu_count,
        object,
        ra,
        dec,
        exposure,
        filter,
        date_obs,
        timesys,
        time_reference,
        observation_midpoint_jd: None,
        observation_midpoint_utc: None,
        diagnostics,
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

fn read_pixels_with_nulls(
    fits: &mut FitsFile,
    selected_hdu: usize,
    pixel_count: usize,
) -> Result<(Vec<f32>, Vec<bool>), String> {
    // Moving to the HDU before the raw call is essential; CFITSIO operates on
    // the file's current HDU. A harmless key read performs that move.
    let hdu = fits.hdu(selected_hdu).map_err(|e| e.to_string())?;
    let _ = hdu
        .read_key::<i64>(fits, "NAXIS")
        .map_err(|e| e.to_string())?;
    let mut pixels = vec![0.0_f32; pixel_count];
    let mut null_flags = vec![0_i8; pixel_count];
    let mut any_null = 0_i32;
    let mut status = 0_i32;
    unsafe {
        fitsio_sys::ffgpf(
            fits.as_raw(),
            fitsio_sys::TFLOAT as i32,
            1,
            pixel_count as i64,
            pixels.as_mut_ptr().cast(),
            null_flags.as_mut_ptr(),
            &mut any_null,
            &mut status,
        );
    }
    fitsio::errors::check_status(status).map_err(|e| e.to_string())?;
    let valid_pixels = pixels
        .iter()
        .zip(null_flags)
        .map(|(pixel, is_null)| is_null == 0 && pixel.is_finite())
        .collect();
    Ok((pixels, valid_pixels))
}

fn open_disk_fits(path: &Path) -> Result<FitsFile, String> {
    if !path.is_file() {
        return Err(format!(
            "FITS file does not exist or is not a file: {}",
            path.display()
        ));
    }
    let filename = path.to_str().ok_or_else(|| {
        format!(
            "FITS path cannot be represented as UTF-8: {}",
            path.display()
        )
    })?;
    let filename = CString::new(filename)
        .map_err(|_| format!("FITS path contains a NUL character: {}", path.display()))?;
    let mut raw = std::ptr::null_mut();
    let mut status = 0;
    unsafe {
        fitsio_sys::ffdkopn(
            &mut raw,
            filename.as_ptr(),
            FileOpenMode::READONLY as i32,
            &mut status,
        );
    }
    fitsio::errors::check_status(status)
        .map_err(|error| format!("Failed to open FITS file '{}': {error}", path.display()))?;
    unsafe { FitsFile::from_raw(raw, FileOpenMode::READONLY) }.map_err(|error| {
        format!(
            "Failed to initialize FITS file '{}': {error}",
            path.display()
        )
    })
}

fn stage_for_cfitsio(path: &Path) -> Result<PathBuf, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Failed to inspect FITS file '{}': {error}", path.display()))?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    let lower_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let suffix = if lower_name.ends_with(".fits.fz") {
        ".fits.fz"
    } else if lower_name.ends_with(".fit.fz") {
        ".fit.fz"
    } else if lower_name.ends_with(".fts.fz") {
        ".fts.fz"
    } else {
        ".fits"
    };
    let directory = std::env::temp_dir().join("sky-eye-cfitsio");
    std::fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create CFITSIO staging directory '{}': {error}",
            directory.display()
        )
    })?;
    let staged = directory.join(format!("{:016x}{suffix}", hasher.finish()));
    if !staged.is_file() && std::fs::hard_link(path, &staged).is_err() {
        std::fs::copy(path, &staged).map_err(|error| {
            format!(
                "Failed to stage FITS file '{}' for CFITSIO: {error}",
                path.display()
            )
        })?;
    }
    Ok(staged)
}

pub fn load_fits(path: &str) -> Result<FitsData, String> {
    load_fits_hdu(path, None)
}

pub fn load_fits_hdu(path: &str, requested_hdu: Option<usize>) -> Result<FitsData, String> {
    let path = Path::new(path);
    let (fits, staged) = match open_disk_fits(path) {
        Ok(fits) => (fits, None),
        Err(primary_error) => {
            let staged = stage_for_cfitsio(path).map_err(|fallback_error| {
                format!("{primary_error}; compatibility fallback failed: {fallback_error}")
            })?;
            let fits = open_disk_fits(&staged).map_err(|fallback_error| {
                format!("{primary_error}; compatibility fallback failed: {fallback_error}")
            })?;
            (fits, Some(staged))
        }
    };
    let result = read_open_fits(fits, path, requested_hdu);
    if let Some(staged) = staged {
        let _ = std::fs::remove_file(staged);
    }
    result
}

fn read_open_fits(
    mut fits: FitsFile,
    path: &Path,
    requested_hdu: Option<usize>,
) -> Result<FitsData, String> {
    let num_hdus = fits.num_hdus().map_err(|e| e.to_string())?;
    let mut image_hdus = Vec::new();
    for index in 0..num_hdus {
        let hdu = fits.hdu(index).map_err(|e| e.to_string())?;
        if let HduInfo::ImageInfo { shape, .. } = &hdu.info {
            if shape.len() == 2 && shape.iter().all(|dimension| *dimension > 0) {
                image_hdus.push((index, shape.clone()));
            }
        }
    }
    let selected = if let Some(requested) = requested_hdu {
        image_hdus.iter().find(|(index, _)| *index == requested)
    } else {
        image_hdus
            .iter()
            .find(|(index, _)| *index == 0)
            .or_else(|| image_hdus.first())
    };
    let (selected_hdu, shape) = selected.cloned().ok_or_else(|| {
        requested_hdu.map_or_else(
            || "FITS file has no non-empty two-dimensional image HDU".to_string(),
            |requested| format!("FITS HDU {requested} is no longer a two-dimensional image"),
        )
    })?;
    let height = shape[0] as u32;
    let width = shape[1] as u32;
    let mut metadata = read_metadata(&mut fits, selected_hdu, image_hdus.len())?;
    if image_hdus.len() > 1 {
        metadata.diagnostics.push(format!(
            "{} two-dimensional image HDUs found; HDU {} was selected",
            image_hdus.len(),
            selected_hdu
        ));
    }
    let (pixels, valid_pixels) =
        read_pixels_with_nulls(&mut fits, selected_hdu, width as usize * height as usize)?;
    log::debug!(
        "[sky-eye] FITS {} HDU {} dimensions={}x{} pixels={}",
        path.display(),
        selected_hdu,
        width,
        height,
        pixels.len()
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
    if min == f32::MAX {
        min = 0.0;
        max = 0.0;
    }

    Ok(FitsData {
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        pixels,
        valid_pixels,
        min,
        max,
        metadata,
    })
}

#[cfg(test)]
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
    use super::{
        apply_linear_scaling, jd_to_rfc3339, linear_wcs_matrix, load_fits, matrix_properties,
        parse_sexagesimal,
    };
    use serde::Deserialize;
    use std::path::PathBuf;

    #[test]
    fn opens_literal_windows_style_filename_characters() {
        use fitsio::{
            images::{ImageDescription, ImageType},
            FitsFile,
        };

        let directory =
            std::env::temp_dir().join(format!("sky-eye-fits-reader-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let plain = directory.join("source.fits");
        let literal = directory.join("object[001].fits");
        let description = ImageDescription {
            data_type: ImageType::Float,
            dimensions: &[2, 2],
        };
        {
            let mut file = FitsFile::create(&plain)
                .with_custom_primary(&description)
                .overwrite()
                .open()
                .unwrap();
            let hdu = file.primary_hdu().unwrap();
            hdu.write_image(&mut file, &[1.0_f32, 2.0, 3.0, 4.0])
                .unwrap();
        }
        std::fs::rename(&plain, &literal).unwrap();
        let loaded = load_fits(literal.to_str().unwrap()).unwrap();
        assert_eq!((loaded.width, loaded.height), (2, 2));
        assert_eq!(loaded.pixels, [1.0, 2.0, 3.0, 4.0]);
        std::fs::remove_file(&literal).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }

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
    fn parses_common_sexagesimal_object_coordinates() {
        assert!((parse_sexagesimal("12 34 56.7", true).unwrap() - 188.736_25).abs() < 1.0e-8);
        assert!((parse_sexagesimal("+12 34 56", false).unwrap() - 12.582_222_222).abs() < 1.0e-8);
        assert!((parse_sexagesimal("-12:34:56", false).unwrap() + 12.582_222_222).abs() < 1.0e-8);
    }

    #[test]
    fn converts_mjd_and_jd_without_losing_calendar_day() {
        assert_eq!(jd_to_rfc3339(2_451_545.0).unwrap(), "2000-01-01T12:00:00Z");
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
