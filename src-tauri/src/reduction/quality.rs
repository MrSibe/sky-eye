use super::SourceMeasurement;

const GRID_COLUMNS: usize = 6;
const GRID_ROWS: usize = 6;
const SOURCES_PER_CELL_FIRST_PASS: usize = 2;

pub fn mark_saturated_sources(
    sources: &mut [SourceMeasurement],
    pixels: &[f32],
    width: u32,
    height: u32,
    saturation_level: Option<f64>,
) -> usize {
    if pixels.len() != width as usize * height as usize {
        return 0;
    }
    let mut saturated_count = 0;
    for source in sources {
        let center_x = source.x.round() as i32;
        let center_y = source.y.round() as i32;
        let radius = (source.fwhm * 0.75).ceil().clamp(2.0, 5.0) as i32;
        let mut samples = Vec::new();
        for y in (center_y - radius).max(0)..=(center_y + radius).min(height as i32 - 1) {
            for x in (center_x - radius).max(0)..=(center_x + radius).min(width as i32 - 1) {
                let value = pixels[y as usize * width as usize + x as usize];
                if value.is_finite() {
                    samples.push(value);
                }
            }
        }
        let Some(local_maximum) = samples.iter().copied().max_by(f32::total_cmp) else {
            continue;
        };
        let reaches_header_limit = saturation_level.is_some_and(|limit| {
            let margin = limit.abs().max(1.0) * 0.005;
            f64::from(local_maximum) >= limit - margin
        });
        let plateau_epsilon = (local_maximum.abs() * 1.0e-6).max(0.25);
        let plateau_pixels = samples
            .iter()
            .filter(|value| local_maximum - **value <= plateau_epsilon)
            .count();
        source.saturated = reaches_header_limit || plateau_pixels >= 4;
        if source.saturated {
            saturated_count += 1;
        }
    }
    saturated_count
}

/// Selects a conservative, spatially distributed source list for plate solving.
///
/// The raw SEP catalogue deliberately remains sensitive for photometry and moving
/// object work. Plate solving needs the opposite trade-off: isolated, round,
/// PSF-like sources distributed over the frame.
pub fn select_astrometry_sources(
    sources: &[SourceMeasurement],
    width: u32,
    height: u32,
    limit: usize,
) -> Vec<SourceMeasurement> {
    if sources.is_empty() || width == 0 || height == 0 || limit == 0 {
        return Vec::new();
    }

    let mut fwhms: Vec<f64> = sources
        .iter()
        .filter(|source| basic_source_quality(source, width, height))
        .map(|source| source.fwhm)
        .collect();
    let median_fwhm = median(&mut fwhms).unwrap_or(3.0);

    let mut deviations: Vec<f64> = fwhms
        .iter()
        .map(|fwhm| (fwhm - median_fwhm).abs())
        .collect();
    let robust_sigma = median(&mut deviations).unwrap_or(0.0) * 1.4826;
    let spread = robust_sigma.max(median_fwhm * 0.18).max(0.25);
    let minimum_fwhm = (median_fwhm - 3.0 * spread).max(0.7);
    let maximum_fwhm = (median_fwhm + 3.0 * spread).min(15.0);

    let mut candidates: Vec<&SourceMeasurement> = sources
        .iter()
        .filter(|source| {
            basic_source_quality(source, width, height)
                && source.ellipticity <= 0.40
                && source.fwhm >= minimum_fwhm
                && source.fwhm <= maximum_fwhm
                && source.npix >= 5
                && !source.saturated
                && f64::from(source.npix) <= (12.0 * source.fwhm * source.fwhm).max(40.0)
        })
        .collect();

    // Penalise elongated objects so a bright trail fragment does not outrank a
    // slightly fainter stellar PSF.
    candidates.sort_by(|left, right| {
        let left_score = left.flux / (1.0 + 5.0 * left.ellipticity);
        let right_score = right.flux / (1.0 + 5.0 * right.ellipticity);
        right_score.total_cmp(&left_score)
    });
    let shape_quality_count = candidates.len();

    let neighbour_radius = (0.9 * median_fwhm).clamp(2.0, 8.0);
    let neighbour_radius_squared = neighbour_radius * neighbour_radius;
    let mut selected: Vec<&SourceMeasurement> = Vec::with_capacity(limit);
    let mut cell_counts = [0_usize; GRID_COLUMNS * GRID_ROWS];

    // First pass prevents a bright star cluster or satellite trail in one part
    // of the image from consuming the complete matcher input.
    for candidate in &candidates {
        let cell = grid_cell(candidate.x, candidate.y, width, height);
        if cell_counts[cell] >= SOURCES_PER_CELL_FIRST_PASS
            || has_close_neighbour(candidate, &selected, neighbour_radius_squared)
        {
            continue;
        }
        selected.push(candidate);
        cell_counts[cell] += 1;
        if selected.len() == limit {
            break;
        }
    }

    // Sparse fields may not fill the target count in the balanced pass. Fill
    // remaining slots without the cell cap, while retaining close-source NMS.
    if selected.len() < limit {
        for candidate in candidates {
            if selected
                .iter()
                .any(|chosen| std::ptr::eq(*chosen, candidate))
                || has_close_neighbour(candidate, &selected, neighbour_radius_squared)
            {
                continue;
            }
            selected.push(candidate);
            if selected.len() == limit {
                break;
            }
        }
    }

    log::debug!(
        "[sky-eye][sources] astrometry selection: raw={} shape_quality={} selected={} median_fwhm={:.2}px range={:.2}..{:.2}px nms={:.2}px",
        sources.len(),
        shape_quality_count,
        selected.len(),
        median_fwhm,
        minimum_fwhm,
        maximum_fwhm,
        neighbour_radius,
    );

    selected.into_iter().cloned().collect()
}

fn basic_source_quality(source: &SourceMeasurement, width: u32, height: u32) -> bool {
    source.x.is_finite()
        && source.y.is_finite()
        && source.flux.is_finite()
        && source.peak.is_finite()
        && source.flux > 0.0
        && source.peak > 0.0
        && source.x >= 3.0
        && source.y >= 3.0
        && source.x < (f64::from(width) - 3.0).max(0.0)
        && source.y < (f64::from(height) - 3.0).max(0.0)
        && source.fwhm.is_finite()
        && source.fwhm > 0.4
        && source.fwhm < 30.0
        && source.ellipticity.is_finite()
        && source.ellipticity >= 0.0
        && source.ellipticity < 0.8
        && source.flags & sep_sys::SEP_OBJ_TRUNC == 0
        && source.centroid_refined
}

fn grid_cell(x: f64, y: f64, width: u32, height: u32) -> usize {
    let column = ((x / f64::from(width)) * GRID_COLUMNS as f64)
        .floor()
        .clamp(0.0, (GRID_COLUMNS - 1) as f64) as usize;
    let row = ((y / f64::from(height)) * GRID_ROWS as f64)
        .floor()
        .clamp(0.0, (GRID_ROWS - 1) as f64) as usize;
    row * GRID_COLUMNS + column
}

fn has_close_neighbour(
    candidate: &SourceMeasurement,
    selected: &[&SourceMeasurement],
    radius_squared: f64,
) -> bool {
    selected.iter().any(|chosen| {
        let dx = candidate.x - chosen.x;
        let dy = candidate.y - chosen.y;
        dx * dx + dy * dy < radius_squared
    })
}

fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    Some(if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) * 0.5
    } else {
        values[middle]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(x: f64, y: f64, flux: f64, fwhm: f64, ellipticity: f64) -> SourceMeasurement {
        SourceMeasurement {
            x,
            y,
            peak: flux as f32,
            flux,
            fwhm,
            ellipticity,
            npix: 30,
            flags: 0,
            saturated: false,
            snr: Some(50.0),
            x_error_px: Some(0.05),
            y_error_px: Some(0.05),
            centroid_refined: true,
        }
    }

    #[test]
    fn rejects_trails_and_suppresses_split_detections() {
        let sources = vec![
            source(100.0, 100.0, 1_000.0, 3.0, 0.1),
            source(101.0, 100.5, 800.0, 3.1, 0.1),
            source(400.0, 400.0, 900.0, 3.0, 0.75),
            source(800.0, 800.0, 700.0, 3.2, 0.05),
        ];

        let selected = select_astrometry_sources(&sources, 1_000, 1_000, 60);
        assert_eq!(selected.len(), 2);
        assert!(selected.iter().any(|item| item.x == 100.0));
        assert!(selected.iter().any(|item| item.x == 800.0));
    }

    #[test]
    fn marks_flat_topped_sources_as_saturated() {
        let mut pixels = vec![0.0; 21 * 21];
        for (x, y) in [(10, 10), (10, 11), (11, 10), (11, 11)] {
            pixels[y * 21 + x] = 1_000.0;
        }
        let mut sources = vec![source(10.5, 10.5, 4_000.0, 3.0, 0.05)];
        assert_eq!(
            mark_saturated_sources(&mut sources, &pixels, 21, 21, None),
            1
        );
        assert!(sources[0].saturated);
    }
}
