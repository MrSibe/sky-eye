use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DetectedStar {
    pub x: f64,
    pub y: f64,
    pub peak: f32,
    pub flux: f64,
    pub fwhm: f64,
    pub ellipticity: f64,
    pub npix: u32,
}

pub fn detect_sources(
    pixels: &[f32],
    width: u32,
    height: u32,
    background: &[f32],
    noise: f32,
    threshold_sigma: f32,
) -> Vec<DetectedStar> {
    let w = width as usize;
    let h = height as usize;
    let threshold = noise * threshold_sigma;

    let mut labels = vec![0u32; pixels.len()];
    let mut next_label: u32 = 1;
    let mut equivalences: Vec<u32> = vec![0; 1];

    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let idx = y * w + x;
            let val = pixels[idx] - background[idx];
            if val <= threshold {
                continue;
            }

            let left = labels[idx - 1];
            let up = labels[idx - w];
            let upleft = labels[idx - w - 1];
            let upright = labels[idx - w + 1];

            let mut min_label = 0u32;
            for &lbl in &[left, up, upleft, upright] {
                if lbl > 0 && (min_label == 0 || lbl < min_label) {
                    min_label = lbl;
                }
            }

            if min_label > 0 {
                labels[idx] = min_label;
                for &lbl in &[left, up, upleft, upright] {
                    if lbl > 0 && lbl != min_label {
                        let a = find(&mut equivalences, min_label as usize) as usize;
                        let b = find(&mut equivalences, lbl as usize) as usize;
                        if a != b {
                            equivalences[a] = equivalences[a].min(b as u32);
                            equivalences[b] = equivalences[a];
                        }
                    }
                }
            } else {
                labels[idx] = next_label;
                equivalences.push(next_label);
                next_label += 1;
            }
        }
    }

    for i in 0..pixels.len() {
        if labels[i] > 0 {
            labels[i] = find(&mut equivalences, labels[i] as usize);
        }
    }

    let mut star_pixels: Vec<Vec<(usize, usize)>> = vec![vec![]; next_label as usize];
    for y in 0..h {
        for x in 0..w {
            let lbl = labels[y * w + x];
            if lbl > 0 {
                star_pixels[lbl as usize].push((x, y));
            }
        }
    }

    let mut stars = Vec::new();
    for (lbl, pix_list) in star_pixels.iter().enumerate() {
        if lbl == 0 {
            continue;
        }
        let npix = pix_list.len() as u32;
        if npix < 3 || npix > 10000 {
            continue;
        }

        let mut sum_i = 0.0f64;
        let mut sum_ix = 0.0f64;
        let mut sum_iy = 0.0f64;
        let mut peak = f32::MIN;

        for &(px, py) in pix_list {
            let val = (pixels[py * w + px] - background[py * w + px]) as f64;
            if val > 0.0 {
                sum_i += val;
                sum_ix += val * px as f64;
                sum_iy += val * py as f64;
            }
            let raw = pixels[py * w + px];
            if raw > peak {
                peak = raw;
            }
        }

        if sum_i <= 0.0 {
            continue;
        }

        let cx = sum_ix / sum_i;
        let cy = sum_iy / sum_i;

        let mut sum_w = 0.0f64;
        let mut sum_wr2 = 0.0f64;
        for &(px, py) in pix_list {
            let val = (pixels[py * w + px] - background[py * w + px]) as f64;
            if val > 0.0 {
                let dr2 = (px as f64 - cx).powi(2) + (py as f64 - cy).powi(2);
                sum_w += val;
                sum_wr2 += val * dr2;
            }
        }
        let rms_radius = (sum_wr2 / sum_w).sqrt();
        let fwhm = 2.355 * rms_radius;

        stars.push(DetectedStar {
            x: cx,
            y: cy,
            peak,
            flux: sum_i,
            fwhm,
            ellipticity: 0.0,
            npix,
        });
    }

    stars.sort_by(|a, b| b.flux.partial_cmp(&a.flux).unwrap());
    stars
}

fn find(equiv: &mut Vec<u32>, mut x: usize) -> u32 {
    while equiv[x] != x as u32 {
        equiv[x] = equiv[equiv[x] as usize];
        x = equiv[x] as usize;
    }
    equiv[x]
}
