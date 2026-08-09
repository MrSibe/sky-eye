use super::{
    validate_image, ApertureMeasurement, ApertureRequest, BackgroundConfig, BackgroundModel,
    DetectionConfig, ReductionBackend, ReductionError, SourceMeasurement,
};
use sep_sys::{sep_bkg, sep_catalog, sep_image};
use std::ptr;

#[derive(Debug, Default, Clone, Copy)]
pub struct SepReducer;

struct BackgroundHandle(*mut sep_bkg);

impl Drop for BackgroundHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { sep_sys::sep_bkg_free(self.0) };
        }
    }
}

struct CatalogHandle(*mut sep_catalog);

impl Drop for CatalogHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { sep_sys::sep_catalog_free(self.0) };
        }
    }
}

fn image_descriptor(pixels: &[f32], width: u32, height: u32, noise: f64) -> sep_image {
    sep_image {
        data: pixels.as_ptr().cast(),
        noise: ptr::null(),
        mask: ptr::null(),
        segmap: ptr::null(),
        dtype: sep_sys::SEP_TFLOAT,
        ndtype: sep_sys::SEP_TFLOAT,
        mdtype: sep_sys::SEP_TBYTE,
        sdtype: sep_sys::SEP_TINT,
        segids: ptr::null_mut(),
        idcounts: ptr::null_mut(),
        numids: 0,
        w: i64::from(width),
        h: i64::from(height),
        noiseval: noise,
        noise_type: if noise > 0.0 {
            sep_sys::SEP_NOISE_STDDEV
        } else {
            sep_sys::SEP_NOISE_NONE
        },
        gain: 0.0,
        maskthresh: 0.0,
    }
}

impl ReductionBackend for SepReducer {
    fn background(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        config: BackgroundConfig,
    ) -> Result<BackgroundModel, ReductionError> {
        validate_image(pixels, width, height)?;
        if config.mesh_width <= 0 || config.mesh_height <= 0 {
            return Err(ReductionError::InvalidConfig(
                "background mesh must be positive",
            ));
        }
        if config.filter_width <= 0 || config.filter_height <= 0 {
            return Err(ReductionError::InvalidConfig(
                "background filter must be positive",
            ));
        }

        let image = image_descriptor(pixels, width, height, 0.0);
        let mut raw = ptr::null_mut();
        let status = unsafe {
            sep_sys::sep_background(
                &image,
                config.mesh_width.min(i64::from(width)),
                config.mesh_height.min(i64::from(height)),
                config.filter_width,
                config.filter_height,
                config.filter_threshold,
                &mut raw,
            )
        };
        if status != 0 {
            return Err(ReductionError::Sep {
                operation: "background",
                status,
            });
        }
        if raw.is_null() {
            return Err(ReductionError::NullResult("background"));
        }
        let handle = BackgroundHandle(raw);
        let mut map = vec![0.0f32; pixels.len()];
        let status = unsafe {
            sep_sys::sep_bkg_array(handle.0, map.as_mut_ptr().cast(), sep_sys::SEP_TFLOAT)
        };
        if status != 0 {
            return Err(ReductionError::Sep {
                operation: "background map",
                status,
            });
        }

        Ok(BackgroundModel {
            map,
            global: unsafe { sep_sys::sep_bkg_global(handle.0) },
            global_rms: unsafe { sep_sys::sep_bkg_globalrms(handle.0) },
        })
    }

    fn detect(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        background: &BackgroundModel,
        config: DetectionConfig,
    ) -> Result<Vec<SourceMeasurement>, ReductionError> {
        validate_image(pixels, width, height)?;
        validate_image(&background.map, width, height)?;
        if !config.threshold_sigma.is_finite() || config.threshold_sigma <= 0.0 {
            return Err(ReductionError::InvalidConfig(
                "detection threshold must be positive",
            ));
        }
        if config.min_area <= 0 || config.deblend_levels <= 0 {
            return Err(ReductionError::InvalidConfig(
                "min area and deblend levels must be positive",
            ));
        }
        if !background.global_rms.is_finite() || background.global_rms <= 0.0 {
            return Err(ReductionError::InvalidConfig(
                "background RMS must be positive",
            ));
        }

        let subtracted: Vec<f32> = pixels
            .iter()
            .zip(&background.map)
            .map(|(pixel, sky)| pixel - sky)
            .collect();
        let image = image_descriptor(&subtracted, width, height, f64::from(background.global_rms));
        let mut raw = ptr::null_mut();
        let status = unsafe {
            sep_sys::sep_extract(
                &image,
                config.threshold_sigma,
                sep_sys::SEP_THRESH_REL,
                config.min_area,
                ptr::null(),
                0,
                0,
                sep_sys::SEP_FILTER_CONV,
                config.deblend_levels,
                config.deblend_contrast,
                i32::from(config.clean),
                config.clean_param,
                &mut raw,
            )
        };
        if status != 0 {
            return Err(ReductionError::Sep {
                operation: "source extraction",
                status,
            });
        }
        if raw.is_null() {
            return Err(ReductionError::NullResult("source catalog"));
        }
        let handle = CatalogHandle(raw);
        let catalog = unsafe { &*handle.0 };
        let count = usize::try_from(catalog.nobj.max(0)).unwrap_or(0);
        if count == 0 {
            return Ok(Vec::new());
        }

        macro_rules! values {
            ($field:ident, $type:ty) => {{
                if catalog.$field.is_null() {
                    return Err(ReductionError::NullResult(stringify!($field)));
                }
                unsafe { std::slice::from_raw_parts(catalog.$field as *const $type, count) }
            }};
        }

        let xs = values!(x, f64);
        let ys = values!(y, f64);
        let peaks = values!(peak, f32);
        let fluxes = values!(flux, f32);
        let axes_a = values!(a, f32);
        let axes_b = values!(b, f32);
        let npix = values!(npix, i64);
        let flags = values!(flag, i16);

        let mut sources = Vec::with_capacity(count);
        for index in 0..count {
            let a = f64::from(axes_a[index].max(0.0));
            let b = f64::from(axes_b[index].max(0.0));
            let sigma = ((a * a + b * b) / 2.0).sqrt();
            sources.push(SourceMeasurement {
                x: xs[index],
                y: ys[index],
                peak: peaks[index],
                flux: f64::from(fluxes[index]),
                fwhm: 2.354_820_045 * sigma,
                ellipticity: if a > 0.0 {
                    (1.0 - b / a).clamp(0.0, 1.0)
                } else {
                    0.0
                },
                npix: u32::try_from(npix[index].max(0)).unwrap_or(u32::MAX),
                flags: flags[index],
                saturated: false,
                snr: None,
                x_error_px: None,
                y_error_px: None,
                centroid_refined: false,
            });
        }
        sources.sort_by(|left, right| right.flux.total_cmp(&left.flux));
        Ok(sources)
    }

    fn aperture_photometry(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        request: ApertureRequest,
    ) -> Result<ApertureMeasurement, ReductionError> {
        validate_image(pixels, width, height)?;
        let ApertureRequest {
            x,
            y,
            noise_rms,
            config,
        } = request;
        if !x.is_finite() || !y.is_finite() {
            return Err(ReductionError::InvalidConfig(
                "aperture position must be finite",
            ));
        }
        if config.radius <= 0.0
            || config.annulus_inner <= config.radius
            || config.annulus_outer <= config.annulus_inner
        {
            return Err(ReductionError::InvalidConfig(
                "aperture and annulus radii must be increasing and positive",
            ));
        }
        if config.subpixels <= 0 || config.sigma_clip <= 0.0 || config.clip_iterations == 0 {
            return Err(ReductionError::InvalidConfig(
                "subpixels, sigma clip, and iterations must be positive",
            ));
        }

        let annulus = annulus_values(
            pixels,
            width,
            height,
            x,
            y,
            config.annulus_inner,
            config.annulus_outer,
        );
        let clipped = sigma_clip(annulus, config.sigma_clip, config.clip_iterations);
        if clipped.len() < 8 {
            return Err(ReductionError::InvalidConfig(
                "background annulus contains too few usable pixels",
            ));
        }
        let background = median(&clipped);
        let robust_rms = robust_sigma(&clipped, background).max(f64::from(noise_rms));

        let image = image_descriptor(pixels, width, height, robust_rms);
        let mut raw_sum = 0.0;
        let mut raw_error = 0.0;
        let mut area = 0.0;
        let mut flags = 0i16;
        let status = unsafe {
            sep_sys::sep_sum_circle(
                &image,
                x,
                y,
                config.radius,
                0,
                config.subpixels,
                0,
                &mut raw_sum,
                &mut raw_error,
                &mut area,
                &mut flags,
            )
        };
        if status != 0 {
            return Err(ReductionError::Sep {
                operation: "aperture photometry",
                status,
            });
        }

        let flux = raw_sum - background * area;
        let background_error = robust_rms * area / (clipped.len() as f64).sqrt();
        let flux_error = raw_error.hypot(background_error);
        let snr = (flux_error > 0.0).then_some(flux / flux_error);
        Ok(ApertureMeasurement {
            x,
            y,
            aperture_radius: config.radius,
            flux,
            flux_error,
            snr,
            background_per_pixel: background,
            aperture_area: area,
            annulus_pixels: clipped.len(),
            flags,
        })
    }
}

fn annulus_values(
    pixels: &[f32],
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    inner: f64,
    outer: f64,
) -> Vec<f64> {
    let x0 = (x - outer).floor().max(0.0) as u32;
    let x1 = (x + outer).ceil().min(f64::from(width - 1)) as u32;
    let y0 = (y - outer).floor().max(0.0) as u32;
    let y1 = (y + outer).ceil().min(f64::from(height - 1)) as u32;
    let inner2 = inner * inner;
    let outer2 = outer * outer;
    let mut values = Vec::new();
    for py in y0..=y1 {
        for px in x0..=x1 {
            let radius2 = (f64::from(px) - x).powi(2) + (f64::from(py) - y).powi(2);
            if radius2 >= inner2 && radius2 <= outer2 {
                let value = f64::from(pixels[(py * width + px) as usize]);
                if value.is_finite() {
                    values.push(value);
                }
            }
        }
    }
    values
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn robust_sigma(values: &[f64], center: f64) -> f64 {
    let deviations: Vec<f64> = values.iter().map(|value| (value - center).abs()).collect();
    1.4826 * median(&deviations)
}

fn sigma_clip(mut values: Vec<f64>, sigma: f64, iterations: usize) -> Vec<f64> {
    for _ in 0..iterations {
        if values.len() < 8 {
            break;
        }
        let center = median(&values);
        let spread = robust_sigma(&values, center);
        if spread <= f64::EPSILON {
            break;
        }
        let previous_len = values.len();
        values.retain(|value| (*value - center).abs() <= sigma * spread);
        if values.len() == previous_len {
            break;
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gaussian_field(width: u32, height: u32, stars: &[(f64, f64, f64, f64)]) -> Vec<f32> {
        let mut pixels = vec![100.0; width as usize * height as usize];
        for y in 0..height {
            for x in 0..width {
                for &(cx, cy, amplitude, sigma) in stars {
                    let radius2 = (f64::from(x) - cx).powi(2) + (f64::from(y) - cy).powi(2);
                    pixels[(y * width + x) as usize] +=
                        (amplitude * (-radius2 / (2.0 * sigma * sigma)).exp()) as f32;
                }
                // Deterministic small-scale variation gives SEP a non-zero RMS.
                pixels[(y * width + x) as usize] += ((x * 17 + y * 31) % 7) as f32 - 3.0;
            }
        }
        pixels
    }

    #[test]
    fn finds_synthetic_gaussian_sources() {
        let reducer = SepReducer;
        let pixels = gaussian_field(
            128,
            128,
            &[(30.4, 41.7, 500.0, 1.8), (91.2, 77.6, 350.0, 2.1)],
        );
        let background = reducer
            .background(&pixels, 128, 128, BackgroundConfig::default())
            .unwrap();
        let sources = reducer
            .detect(&pixels, 128, 128, &background, DetectionConfig::default())
            .unwrap();

        assert!(sources.len() >= 2);
        assert!(sources
            .iter()
            .any(|star| (star.x - 30.4).abs() < 0.5 && (star.y - 41.7).abs() < 0.5));
        assert!(sources
            .iter()
            .any(|star| (star.x - 91.2).abs() < 0.5 && (star.y - 77.6).abs() < 0.5));
    }

    #[test]
    fn rejects_mismatched_dimensions_before_ffi() {
        let reducer = SepReducer;
        let result = reducer.background(&[0.0; 3], 2, 2, BackgroundConfig::default());
        assert!(matches!(
            result,
            Err(ReductionError::InvalidDimensions { .. })
        ));
    }

    #[test]
    fn aperture_photometry_recovers_gaussian_flux() {
        let reducer = SepReducer;
        let amplitude = 500.0;
        let sigma = 1.8;
        let pixels = gaussian_field(96, 96, &[(48.2, 47.7, amplitude, sigma)]);
        let measurement = reducer
            .aperture_photometry(
                &pixels,
                96,
                96,
                ApertureRequest {
                    x: 48.2,
                    y: 47.7,
                    noise_rms: 2.0,
                    config: super::super::ApertureConfig {
                        radius: 7.0,
                        annulus_inner: 10.0,
                        annulus_outer: 16.0,
                        ..super::super::ApertureConfig::default()
                    },
                },
            )
            .unwrap();
        let expected = amplitude * 2.0 * std::f64::consts::PI * sigma * sigma;
        assert!((measurement.flux - expected).abs() / expected < 0.03);
        assert!(measurement.snr.unwrap() > 20.0);
    }
}
