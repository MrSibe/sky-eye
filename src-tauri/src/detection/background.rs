pub struct Background {
    pub background: Vec<f32>,
    pub noise: f32,
}

/// Estimate background using 32x32 grid median + bilinear interpolation.
pub fn estimate_background(pixels: &[f32], width: u32, height: u32) -> Result<Background, String> {
    let grid: usize = 32;
    let ncols = ((width as f32) / grid as f32).ceil() as usize;
    let nrows = ((height as f32) / grid as f32).ceil() as usize;

    let mut grid_vals = vec![vec![]; nrows * ncols];
    for y in 0..height as usize {
        for x in 0..width as usize {
            let gi = (y / grid).min(nrows - 1);
            let gj = (x / grid).min(ncols - 1);
            let v = pixels[y * width as usize + x];
            if v.is_finite() {
                grid_vals[gi * ncols + gj].push(v);
            }
        }
    }

    let mut medians = Vec::with_capacity(nrows * ncols);
    for cell in &grid_vals {
        if cell.is_empty() {
            medians.push(0.0);
        } else {
            let mut sorted = cell.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            medians.push(sorted[sorted.len() / 2]);
        }
    }

    let mut background = Vec::with_capacity(pixels.len());
    for y in 0..height as usize {
        for x in 0..width as usize {
            let gx = (x as f64 / grid as f64) - 0.5;
            let gy = (y as f64 / grid as f64) - 0.5;
            let ix = gx.max(0.0).min((ncols - 1) as f64) as usize;
            let iy = gy.max(0.0).min((nrows - 1) as f64) as usize;
            let fx = gx - ix as f64;
            let fy = gy - iy as f64;

            let v00 = medians[iy * ncols + ix] as f64;
            let v10 = medians[iy * ncols + (ix + 1).min(ncols - 1)] as f64;
            let v01 = medians[(iy + 1).min(nrows - 1) * ncols + ix] as f64;
            let v11 = medians[(iy + 1).min(nrows - 1) * ncols + (ix + 1).min(ncols - 1)] as f64;

            let v = (1.0 - fx) * (1.0 - fy) * v00
                + fx * (1.0 - fy) * v10
                + (1.0 - fx) * fy * v01
                + fx * fy * v11;
            background.push(v as f32);
        }
    }

    let mut residuals: Vec<f64> = Vec::new();
    for i in 0..pixels.len() {
        if pixels[i].is_finite() {
            residuals.push((pixels[i] - background[i]) as f64);
        }
    }
    residuals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = residuals.len();
    let lo = n / 4;
    let hi = n * 3 / 4;
    let noise = if hi > lo && n > 0 {
        let slice = &residuals[lo..hi];
        let mean: f64 = slice.iter().sum::<f64>() / slice.len() as f64;
        let var: f64 = slice.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / slice.len() as f64;
        var.sqrt() as f32
    } else {
        1.0
    };

    Ok(Background { background, noise })
}
