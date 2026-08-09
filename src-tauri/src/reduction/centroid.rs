use super::{BackgroundModel, SourceMeasurement};

/// Refines SEP's moment centroid with a Gaussian window, following the same
/// practical split used by SCAMP: detection finds candidates, while a stable
/// windowed centroid supplies astrometric positions.
pub fn refine_astrometric_centroids(
    sources: &mut [SourceMeasurement],
    pixels: &[f32],
    valid_pixels: &[bool],
    width: u32,
    height: u32,
    background: &BackgroundModel,
    gain_e_per_adu: Option<f64>,
) {
    if pixels.len() != width as usize * height as usize
        || valid_pixels.len() != pixels.len()
        || background.map.len() != pixels.len()
    {
        return;
    }

    for source in sources {
        if source.saturated || !source.x.is_finite() || !source.y.is_finite() {
            continue;
        }
        let sigma = (source.fwhm / 2.354_820_045).clamp(0.7, 6.0);
        let radius = (sigma * 3.0).ceil().clamp(3.0, 14.0) as i32;
        let mut x = source.x;
        let mut y = source.y;
        let mut accepted = false;

        for _ in 0..6 {
            let x0 = (x.floor() as i32 - radius).max(0);
            let x1 = (x.ceil() as i32 + radius).min(width as i32 - 1);
            let y0 = (y.floor() as i32 - radius).max(0);
            let y1 = (y.ceil() as i32 + radius).min(height as i32 - 1);
            let mut sum_w = 0.0;
            let mut sum_x = 0.0;
            let mut sum_y = 0.0;
            for py in y0..=y1 {
                for px in x0..=x1 {
                    let index = py as usize * width as usize + px as usize;
                    if !valid_pixels[index] {
                        continue;
                    }
                    let signal = f64::from(pixels[index] - background.map[index]).max(0.0);
                    if signal == 0.0 || !signal.is_finite() {
                        continue;
                    }
                    let dx = f64::from(px) - x;
                    let dy = f64::from(py) - y;
                    let window = (-(dx * dx + dy * dy) / (2.0 * sigma * sigma)).exp();
                    let weight = signal * window;
                    sum_w += weight;
                    sum_x += weight * f64::from(px);
                    sum_y += weight * f64::from(py);
                }
            }
            if sum_w <= 0.0 {
                break;
            }
            let next_x = sum_x / sum_w;
            let next_y = sum_y / sum_w;
            let shift = (next_x - x).hypot(next_y - y);
            x = next_x;
            y = next_y;
            accepted = true;
            if shift < 1.0e-4 {
                break;
            }
        }

        if !accepted || (x - source.x).hypot(y - source.y) > sigma.max(1.5) {
            continue;
        }
        let area = f64::from(source.npix.max(1));
        let source_variance = gain_e_per_adu
            .filter(|gain| *gain > 0.0)
            .map_or(source.flux.abs(), |gain| source.flux.abs() / gain);
        let noise_variance = area * f64::from(background.global_rms).powi(2);
        let flux_error = (source_variance + noise_variance).sqrt();
        let snr = (flux_error > 0.0).then_some(source.flux / flux_error);
        let centroid_error = snr
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| (source.fwhm / (2.354_820_045 * value)).clamp(0.02, 2.0));
        source.x = x;
        source.y = y;
        source.snr = snr;
        source.x_error_px = centroid_error;
        source.y_error_px = centroid_error;
        source.centroid_refined = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reduction::SourceMeasurement;

    #[test]
    fn refines_a_subpixel_gaussian_centroid() {
        let width = 41u32;
        let height = 39u32;
        let truth = (19.37, 17.72);
        let mut pixels = vec![100.0f32; width as usize * height as usize];
        for py in 0..height {
            for px in 0..width {
                let r2 = (f64::from(px) - truth.0).powi(2) + (f64::from(py) - truth.1).powi(2);
                pixels[(py * width + px) as usize] +=
                    (800.0 * (-r2 / (2.0 * 1.5f64.powi(2))).exp()) as f32;
            }
        }
        let background = BackgroundModel {
            map: vec![100.0; pixels.len()],
            global: 100.0,
            global_rms: 2.0,
        };
        let mut sources = vec![SourceMeasurement {
            x: 19.0,
            y: 18.0,
            peak: 800.0,
            flux: 10_000.0,
            fwhm: 3.53,
            ellipticity: 0.0,
            npix: 40,
            flags: 0,
            saturated: false,
            snr: None,
            x_error_px: None,
            y_error_px: None,
            centroid_refined: false,
        }];
        refine_astrometric_centroids(
            &mut sources,
            &pixels,
            &vec![true; pixels.len()],
            width,
            height,
            &background,
            Some(1.0),
        );
        assert!((sources[0].x - truth.0).abs() < 0.08);
        assert!((sources[0].y - truth.1).abs() < 0.08);
        assert!(sources[0].centroid_refined);
    }
}
