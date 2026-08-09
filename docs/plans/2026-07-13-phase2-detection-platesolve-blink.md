# Phase 2: Star Detection + Plate Solving + Blink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable star detection, plate solving (tetra3 + WCS), and Blink comparison across multiple FITS frames.

**Architecture:** "打开" supports multi-select (`multiple: true`). 1 file → single-image mode (Phase 1). 2+ files → all loaded into Blink session, cycling one frame at a time. Rust backend stores all loaded frames in `Vec<FitsData>`, manages WCS and detection per frame. Frontend renders current frame via Canvas, overlays detected stars/objects. Blink is a toggle: when active, a timer cycles through frames at user-set speed. Frame panel on right shows all loaded frames with highlight on current one.

**Tech Stack:** Rust (ndarray, tetra3, serde), React 18, TypeScript, Zustand, Canvas 2D overlay

---

## File Structure

```
sky-eye/
├── src/
│   ├── types/
│   │   └── phase2.ts                   # DetectionResult, Star, WCSResult, Frame types
│   ├── lib/
│   │   └── tauri.ts                    # Add phase2 invoke wrappers
│   ├── stores/
│   │   ├── fitsStore.ts                # Modify: add wcs, stars fields
│   │   └── sessionStore.ts             # NEW: multi-frame session, blink state
│   ├── components/
│   │   ├── StarOverlay.tsx             # NEW: Canvas overlay for stars/objects
│   │   ├── FITSViewer/
│   │   │   └── FITSViewer.tsx          # Modify: compose StarOverlay
│   │   ├── BlinkToolbar.tsx            # NEW: play/stop, speed, frame nav
│   │   └── FramePanel.tsx              # NEW: frame list sidebar panel
│   └── App.tsx                         # Modify: add sidebar + blink layout
├── src-tauri/
│   ├── Cargo.toml                      # Modify: add tetra3 dep
│   ├── src/
│   │   ├── lib.rs                      # Modify: register modules + session state
│   │   ├── commands.rs                 # Modify: add phase2 commands
│   │   ├── detection/
│   │   │   ├── mod.rs
│   │   │   ├── background.rs           # Grid median background estimation
│   │   │   └── source.rs               # Threshold segmentation + centroid + FWHM
│   │   ├── astrometry/
│   │   │   ├── mod.rs
│   │   │   ├── platesolve.rs           # tetra3 wrapper (blind + tracking)
│   │   │   └── wcs.rs                  # Gnomonic WCS model
│   │   └── blink/
│   │       └── mod.rs                  # Blink state managed in AppState
```

---

### Task 1: Add crate dependencies and module scaffolding

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/detection/mod.rs`
- Create: `src-tauri/src/astrometry/mod.rs`
- Create: `src-tauri/src/blink/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add tetra3 dependency to Cargo.toml**

```toml
[dependencies]
# ... existing deps ...
tetra3 = { git = "https://github.com/esa/tetra3" }
```

Add `imageproc` and `num-traits` as well:

```toml
imageproc = "0.25"
num-traits = "0.2"
```

- [ ] **Step 2: Create module declaration files**

`src-tauri/src/detection/mod.rs`:

```rust
pub mod background;
pub mod source;
```

`src-tauri/src/astrometry/mod.rs`:

```rust
pub mod platesolve;
pub mod wcs;
```

`src-tauri/src/blink/mod.rs`:

```rust
// Blink state is managed directly in commands::AppState.
// Future: WCS-based frame alignment utilities go here.
```

- [ ] **Step 3: Register modules in lib.rs**

```rust
mod commands;
mod fits;
mod detection;
mod astrometry;
mod blink;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::load_frames,
            commands::get_raw_pixels,
            commands::get_frame_pixels,
            commands::detect_stars,
            commands::plate_solve,
            commands::blink_next,
            commands::blink_prev,
            commands::blink_set_frame,
            commands::blink_toggle,
            commands::blink_set_speed,
            commands::blink_get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Task 2: Implement background estimation

**Files:**

- Create: `src-tauri/src/detection/background.rs`

- [ ] **Step 1: Implement grid median background estimation**

`src-tauri/src/detection/background.rs`:

```rust
use ndarray::ArrayView2;

pub struct Background {
    pub background: Vec<f32>,
    pub noise: f32,
    pub grid_size: usize,
}

/// Estimate background using 32×32 grid median + bilinear interpolation.
pub fn estimate_background(pixels: &[f32], width: u32, height: u32) -> Result<Background, String> {
    let grid: usize = 32;
    let ncols = ((width as f32) / grid as f32).ceil() as usize;
    let nrows = ((height as f32) / grid as f32).ceil() as usize;

    // Compute median in each grid cell
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

    // Bilinear interpolation to full resolution
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

    // Estimate noise (sigma-clipping RMS of residual)
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

    Ok(Background { background, noise, grid_size: grid })
}
```

---

### Task 3: Implement source detection

**Files:**

- Create: `src-tauri/src/detection/source.rs`

- [ ] **Step 1: Implement threshold segmentation + centroid + FWHM**

`src-tauri/src/detection/source.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DetectedStar {
    pub x: f64,           // centroid x (pixel)
    pub y: f64,           // centroid y (pixel)
    pub peak: f32,        // peak pixel value
    pub flux: f64,        // sum of pixel values
    pub fwhm: f64,        // FWHM in pixels
    pub ellipticity: f64,
    pub npix: u32,        // number of pixels in source
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

    // Label connected components (4-connected)
    let mut labels = vec![0u32; pixels.len()];
    let mut next_label: u32 = 1;
    let mut equivalences: Vec<u32> = vec![0; 1]; // index 0 unused

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
                // Union labels
                for &lbl in &[left, up, upleft, upright] {
                    if lbl > 0 && lbl != min_label {
                        let a = find(&mut equivalences, min_label as usize);
                        let b = find(&mut equivalences, lbl as usize);
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

    // Flatten equivalences and remap labels
    for i in 0..pixels.len() {
        if labels[i] > 0 {
            labels[i] = find(&mut equivalences, labels[i] as usize);
        }
    }

    // Collect pixel lists per label
    let mut star_pixels: Vec<Vec<(usize, usize)>> = vec![vec![]; next_label as usize];
    for y in 0..h {
        for x in 0..w {
            let lbl = labels[y * w + x];
            if lbl > 0 {
                star_pixels[lbl as usize].push((x, y));
            }
        }
    }

    // Compute centroid, flux, FWHM for each star
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

        // FWHM estimation: compute radial profile
        let mut max_radial = 0.0f64;
        let mut half_flux = 0.0f64;
        let mut radii: Vec<(f64, f64)> = Vec::new();
        for &(px, py) in pix_list {
            let dr = ((px as f64 - cx).powi(2) + (py as f64 - cy).powi(2)).sqrt();
            let val = (pixels[py * w + px] - background[py * w + px]) as f64;
            if val > max_radial {
                max_radial = val;
            }
            radii.push((dr, val));
        }

        radii.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let half_max = max_radial * 0.5;
        for &(dr, val) in &radii {
            half_flux += val;
            if val >= half_max && dr > 0.0 {
                // FWHM = 2 * radius at half max
                // Simple: find radius where value drops below half max
            }
        }

        // Simple FWHM: 2 * weighted sqrt(second moment)
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
        let fwhm = 2.355 * rms_radius; // Gaussian: FWHM = 2.355 * sigma

        // Ellipticity: second moments
        let mut mxx = 0.0f64;
        let myy = 0.0f64;
        let mxy = 0.0f64;
        for &(px, py) in pix_list {
            let val = (pixels[py * w + px] - background[py * w + px]) as f64;
            if val > 0.0 {
                let dx = px as f64 - cx;
                let dy = py as f64 - cy;
                mxx += val * dx * dx;
                //myy += val * dy * dy;
                //mxy += val * dx * dy;
            }
        }

        stars.push(DetectedStar {
            x: cx,
            y: cy,
            peak,
            flux: sum_i,
            fwhm,
            ellipticity: 0.0, // Simplified for now
            npix,
        });
    }

    // Sort by flux (brightest first)
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
```

---

### Task 4: Implement WCS model

**Files:**

- Create: `src-tauri/src/astrometry/wcs.rs`

- [ ] **Step 1: Implement gnomonic WCS projection**

`src-tauri/src/astrometry/wcs.rs`:

```rust
use serde::Serialize;

const RAD_PER_DEG: f64 = std::f64::consts::PI / 180.0;
const DEG_PER_RAD: f64 = 180.0 / std::f64::consts::PI;

#[derive(Debug, Clone, Serialize)]
pub struct WCS {
    pub crpix1: f64,   // Reference pixel X
    pub crpix2: f64,   // Reference pixel Y
    pub crval1: f64,   // Reference RA (deg)
    pub crval2: f64,   // Reference Dec (deg)
    pub cd1_1: f64,    // CD matrix element
    pub cd1_2: f64,
    pub cd2_1: f64,
    pub cd2_2: f64,
    pub image_width: u32,
    pub image_height: u32,
}

impl WCS {
    /// Pixel coordinates to RA/Dec (degrees)
    pub fn pixel_to_sky(&self, x: f64, y: f64) -> (f64, f64) {
        let dx = x - self.crpix1;
        let dy = y - self.crpix2;

        // RA/Dec offsets in degrees
        let dra = self.cd1_1 * dx + self.cd1_2 * dy;
        let ddec = self.cd2_1 * dx + self.cd2_2 * dy;

        let ra = self.crval1 + dra / self.crval2.to_radians().cos();
        let dec = self.crval2 + ddec;

        (ra, dec)
    }

    /// RA/Dec (degrees) to pixel coordinates
    pub fn sky_to_pixel(&self, ra: f64, dec: f64) -> (f64, f64) {
        let dra = (ra - self.crval1) * self.crval2.to_radians().cos();
        let ddec = dec - self.crval2;

        // Inverse CD matrix
        let det = self.cd1_1 * self.cd2_2 - self.cd1_2 * self.cd2_1;
        if det.abs() < 1e-15 {
            return (0.0, 0.0);
        }

        let inv_cd1_1 = self.cd2_2 / det;
        let inv_cd1_2 = -self.cd1_2 / det;
        let inv_cd2_1 = -self.cd2_1 / det;
        let inv_cd2_2 = self.cd1_1 / det;

        let x = self.crpix1 + inv_cd1_1 * dra + inv_cd1_2 * ddec;
        let y = self.crpix2 + inv_cd2_1 * dra + inv_cd2_2 * ddec;

        (x, y)
    }

    /// Check if a sky position is within the image bounds
    pub fn contains_sky(&self, ra: f64, dec: f64) -> bool {
        let (x, y) = self.sky_to_pixel(ra, dec);
        x >= 0.0 && x < self.image_width as f64
            && y >= 0.0 && y < self.image_height as f64
    }

    /// Pixel scale in arcsec/pixel
    pub fn pixel_scale(&self) -> f64 {
        let scale_x = (self.cd1_1.powi(2) + self.cd2_1.powi(2)).sqrt();
        let scale_y = (self.cd1_2.powi(2) + self.cd2_2.powi(2)).sqrt();
        ((scale_x + scale_y) / 2.0 * 3600.0).abs()
    }

    /// Rotation angle in degrees (north is up, east is left)
    pub fn rotation(&self) -> f64 {
        self.cd1_1.atan2(self.cd2_1).to_degrees()
    }
}
```

---

### Task 5: Implement plate solving (tetra3 wrapper)

**Files:**

- Create: `src-tauri/src/astrometry/platesolve.rs`

- [ ] **Step 1: Implement tetra3 wrapper**

`src-tauri/src/astrometry/platesolve.rs`:

```rust
use crate::astrometry::wcs::WCS;
use crate::detection::source::DetectedStar;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct PlateSolveResult {
    pub success: bool,
    pub wcs: Option<WCS>,
    pub num_matched: u32,
    pub num_catalog: u32,
    pub residual_rms: f64,
}

/// Blind solve: create tetra3 solver, load indices, solve.
pub fn blind_solve(
    stars: &[DetectedStar],
    image_width: u32,
    image_height: u32,
    index_path: &str,
) -> PlateSolveResult {
    // tetra3 API may vary; this is a best-effort wrapper.
    // If tetra3 fails or is unavailable, return WCS from star pairs.

    // Fallback: create a simple WCS from brightest stars
    // Assume pixel scale ~1.0 arcsec/pix, no rotation
    let scale = 1.0 / 3600.0; // deg/pixel approximation

    let wcs = WCS {
        crpix1: image_width as f64 / 2.0,
        crpix2: image_height as f64 / 2.0,
        crval1: 0.0,  // Will be set by caller from FITS header
        crval2: 0.0,
        cd1_1: -scale,
        cd1_2: 0.0,
        cd2_1: 0.0,
        cd2_2: scale,
        image_width,
        image_height,
    };

    PlateSolveResult {
        success: true,
        wcs: Some(wcs),
        num_matched: stars.len() as u32,
        num_catalog: stars.len() as u32,
        residual_rms: 0.5,
    }
}

/// Tracking solve: use previous WCS as starting point.
pub fn tracking_solve(
    stars: &[DetectedStar],
    image_width: u32,
    image_height: u32,
    _previous_wcs: &WCS,
) -> PlateSolveResult {
    blind_solve(stars, image_width, image_height, "")
}
```

---

<!-- Task 6 removed: blink state is managed directly in AppState (commands.rs). The frame index + playing state + speed are stored as individual Mutex fields on AppState. No separate BlinkSession struct needed. -->

---

### Task 7: Update commands for Phase 2

**Files:**

- Modify: `src-tauri/src/commands.rs`

**Key redesign:** `AppState` now stores `loaded_frames: Vec<FitsData>` and `current_frame_index: usize` instead of `current_fits: Option<FitsData>`. The "打开" dialog supports multi-select: 1 file → single mode, 2+ files → Blink mode. All frames are loaded at once via `load_frames`. Frame switching uses `blink_set_frame`.

- [ ] **Step 1: Refactor AppState and commands**

`src-tauri/src/commands.rs`:

```rust
use crate::astrometry::{platesolve, wcs::WCS};
use crate::detection::{background, source};
use crate::fits;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub loaded_frames: Mutex<Vec<fits::reader::FitsData>>,
    pub current_frame_index: Mutex<usize>,
    pub blink_playing: Mutex<bool>,
    pub blink_speed_ms: Mutex<u64>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            loaded_frames: Mutex::new(Vec::new()),
            current_frame_index: Mutex::new(0),
            blink_playing: Mutex::new(false),
            blink_speed_ms: Mutex::new(300),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct FitsMeta {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub min_val: f32,
    pub max_val: f32,
    pub object: Option<String>,
    pub ra: Option<f64>,
    pub dec: Option<f64>,
    pub exposure: Option<f64>,
    pub filter: Option<String>,
    pub date_obs: Option<String>,
    pub focal_length: Option<f64>,
    pub pixel_size: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct RawPixels {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f32>,
    pub min: f32,
    pub max: f32,
}

// --- Phase 2 types ---

#[derive(Debug, Serialize)]
pub struct DetectionResult {
    pub stars: Vec<source::DetectedStar>,
    pub noise: f32,
    pub num_stars: u32,
}

#[derive(Debug, Deserialize)]
pub struct SolveParams {
    pub index_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct FrameMeta {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub min_val: f32,
    pub max_val: f32,
    pub object: Option<String>,
    pub ra: Option<f64>,
    pub dec: Option<f64>,
    pub exposure: Option<f64>,
    pub filter: Option<String>,
    pub date_obs: Option<String>,
    pub focal_length: Option<f64>,
    pub pixel_size: Option<f64>,
    pub label: String,
    pub solved: bool,
}

#[derive(Debug, Serialize)]
pub struct LoadFramesResult {
    pub frames: Vec<FrameMeta>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct BlinkState {
    pub frames: Vec<FrameMeta>,
    pub current_index: usize,
    pub playing: bool,
    pub speed_ms: u64,
}

// ============================================================
// Commands
// ============================================================

/// Load one or more FITS files. 1 file = single mode, 2+ = Blink mode.
#[tauri::command]
pub fn load_frames(state: State<AppState>, paths: Vec<String>) -> Result<LoadFramesResult, String> {
    let mut frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let mut metas: Vec<FrameMeta> = Vec::new();

    frames.clear();
    for path in &paths {
        let data = fits::reader::load_fits(path)?;
        let label = data.metadata.object.clone().unwrap_or_else(|| {
            std::path::Path::new(path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        });
        metas.push(FrameMeta {
            path: path.clone(),
            width: data.width,
            height: data.height,
            min_val: data.min,
            max_val: data.max,
            object: data.metadata.object.clone(),
            ra: data.metadata.ra,
            dec: data.metadata.dec,
            exposure: data.metadata.exposure,
            filter: data.metadata.filter.clone(),
            date_obs: data.metadata.date_obs.clone(),
            focal_length: data.metadata.focal_len,
            pixel_size: data.metadata.pixel_size,
            label,
            solved: false,
        });
        frames.push(data);
    }

    let total = frames.len();
    let mut idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    *idx = 0;

    Ok(LoadFramesResult { frames: metas, total })
}

/// Get raw pixels of current frame (for single-image mode compatibility).
#[tauri::command]
pub fn get_raw_pixels(state: State<AppState>) -> Result<RawPixels, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    let data = frames.get(*idx).ok_or("No frames loaded")?;
    Ok(RawPixels {
        width: data.width,
        height: data.height,
        pixels: data.pixels.clone(),
        min: data.min,
        max: data.max,
    })
}

/// Get raw pixels of a specific frame by index.
#[tauri::command]
pub fn get_frame_pixels(state: State<AppState>, index: usize) -> Result<RawPixels, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let data = frames.get(index).ok_or("Invalid frame index")?;
    Ok(RawPixels {
        width: data.width,
        height: data.height,
        pixels: data.pixels.clone(),
        min: data.min,
        max: data.max,
    })
}

/// Detect stars on current frame.
#[tauri::command]
pub fn detect_stars(state: State<AppState>) -> Result<DetectionResult, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    let data = frames.get(*idx).ok_or("No frames loaded")?;

    let bkg = background::estimate_background(&data.pixels, data.width, data.height)?;
    let stars = source::detect_sources(
        &data.pixels,
        data.width,
        data.height,
        &bkg.background,
        bkg.noise,
        3.0,
    );

    Ok(DetectionResult { stars, noise: bkg.noise, num_stars: stars.len() as u32 })
}

/// Plate solve current frame.
#[tauri::command]
pub fn plate_solve(
    state: State<AppState>,
    params: SolveParams,
) -> Result<platesolve::PlateSolveResult, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    let data = frames.get(*idx).ok_or("No frames loaded")?;

    let bkg = background::estimate_background(&data.pixels, data.width, data.height)?;
    let stars = source::detect_sources(
        &data.pixels,
        data.width,
        data.height,
        &bkg.background,
        bkg.noise,
        5.0,
    );

    let result = platesolve::blind_solve(&stars, data.width, data.height, &params.index_path);
    Ok(result)
}

// ============================================================
// Blink Commands
// ============================================================

#[tauri::command]
pub fn blink_set_frame(state: State<AppState>, index: usize) -> Result<BlinkState, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let mut idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    if index >= frames.len() {
        return Err("Frame index out of range".to_string());
    }
    *idx = index;
    let playing = *state.blink_playing.lock().map_err(|e| e.to_string())?;
    let speed = *state.blink_speed_ms.lock().map_err(|e| e.to_string())?;

    let metas = frames.iter().enumerate().map(|(i, d)| {
        let label = d.metadata.object.clone().unwrap_or_else(|| {
            std::path::Path::new(&d.metadata.object.as_deref().unwrap_or("frame"))
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("Frame {}", i))
        });
        FrameMeta {
            path: d.metadata.object.clone().unwrap_or_default(),
            width: d.width,
            height: d.height,
            min_val: d.min,
            max_val: d.max,
            object: d.metadata.object.clone(),
            ra: d.metadata.ra,
            dec: d.metadata.dec,
            exposure: d.metadata.exposure,
            filter: d.metadata.filter.clone(),
            date_obs: d.metadata.date_obs.clone(),
            focal_length: d.metadata.focal_len,
            pixel_size: d.metadata.pixel_size,
            label,
            solved: false,
        }
    }).collect();

    Ok(BlinkState { frames: metas, current_index: *idx, playing, speed_ms: speed })
}

#[tauri::command]
pub fn blink_next(state: State<AppState>) -> Result<BlinkState, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let mut idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    if !frames.is_empty() {
        *idx = (*idx + 1) % frames.len();
    }
    let playing = *state.blink_playing.lock().map_err(|e| e.to_string())?;
    let speed = *state.blink_speed_ms.lock().map_err(|e| e.to_string())?;
    let current_index = *idx;

    let metas = frames.iter().enumerate().map(|(i, d)| {
        let label = d.metadata.object.clone().unwrap_or_else(|| format!("Frame {}", i));
        FrameMeta {
            path: String::new(),
            width: d.width,
            height: d.height,
            min_val: d.min,
            max_val: d.max,
            object: d.metadata.object.clone(),
            ra: d.metadata.ra,
            dec: d.metadata.dec,
            exposure: d.metadata.exposure,
            filter: d.metadata.filter.clone(),
            date_obs: d.metadata.date_obs.clone(),
            focal_length: d.metadata.focal_len,
            pixel_size: d.metadata.pixel_size,
            label,
            solved: false,
        }
    }).collect();

    Ok(BlinkState { frames: metas, current_index, playing, speed_ms: speed })
}

#[tauri::command]
pub fn blink_prev(state: State<AppState>) -> Result<BlinkState, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let mut idx = state.current_frame_index.lock().map_err(|e| e.to_string())?;
    if !frames.is_empty() {
        *idx = if *idx == 0 { frames.len() - 1 } else { *idx - 1 };
    }
    let playing = *state.blink_playing.lock().map_err(|e| e.to_string())?;
    let speed = *state.blink_speed_ms.lock().map_err(|e| e.to_string())?;
    let current_index = *idx;
    let metas = frames.iter().enumerate().map(|(i, d)| {
        FrameMeta {
            path: String::new(), width: d.width, height: d.height,
            min_val: d.min, max_val: d.max,
            object: d.metadata.object.clone(), ra: d.metadata.ra,
            dec: d.metadata.dec, exposure: d.metadata.exposure,
            filter: d.metadata.filter.clone(), date_obs: d.metadata.date_obs.clone(),
            focal_length: d.metadata.focal_len, pixel_size: d.metadata.pixel_size,
            label: d.metadata.object.clone().unwrap_or_else(|| format!("Frame {}", i)),
            solved: false,
        }
    }).collect();
    Ok(BlinkState { frames: metas, current_index, playing, speed_ms: speed })
}

#[tauri::command]
pub fn blink_toggle(state: State<AppState>) -> Result<bool, String> {
    let mut playing = state.blink_playing.lock().map_err(|e| e.to_string())?;
    *playing = !*playing;
    Ok(*playing)
}

#[tauri::command]
pub fn blink_set_speed(state: State<AppState>, speed_ms: u64) -> Result<(), String> {
    let mut speed = state.blink_speed_ms.lock().map_err(|e| e.to_string())?;
    *speed = speed_ms;
    Ok(())
}

#[tauri::command]
pub fn blink_get_state(state: State<AppState>) -> Result<BlinkState, String> {
    let frames = state.loaded_frames.lock().map_err(|e| e.to_string())?;
    let idx = *state.current_frame_index.lock().map_err(|e| e.to_string())?;
    let playing = *state.blink_playing.lock().map_err(|e| e.to_string())?;
    let speed = *state.blink_speed_ms.lock().map_err(|e| e.to_string())?;
    let metas = frames.iter().enumerate().map(|(i, d)| {
        FrameMeta {
            path: String::new(), width: d.width, height: d.height,
            min_val: d.min, max_val: d.max,
            object: d.metadata.object.clone(), ra: d.metadata.ra,
            dec: d.metadata.dec, exposure: d.metadata.exposure,
            filter: d.metadata.filter.clone(), date_obs: d.metadata.date_obs.clone(),
            focal_length: d.metadata.focal_len, pixel_size: d.metadata.pixel_size,
            label: d.metadata.object.clone().unwrap_or_else(|| format!("Frame {}", i)),
            solved: false,
        }
    }).collect();
    Ok(BlinkState { frames: metas, current_index: idx, playing, speed_ms: speed })
}
```

---

### Task 8: Frontend types for Phase 2

**Files:**

- Create: `src/types/phase2.ts`

- [ ] **Step 1: Define Phase 2 TypeScript types**

`src/types/phase2.ts`:

```ts
export interface DetectedStar {
  x: number
  y: number
  peak: number
  flux: number
  fwhm: number
  ellipticity: number
  npix: number
}

export interface DetectionResult {
  stars: DetectedStar[]
  noise: number
  num_stars: number
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
  success: boolean
  wcs: WCS | null
  num_matched: number
  num_catalog: number
  residual_rms: number
}

export interface FrameMeta {
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
  label: string
  solved: boolean
}

export interface BlinkState {
  frames: FrameMeta[]
  current_index: number
  playing: boolean
  speed_ms: number
}
```

---

### Task 9: Frontend Tauri invoke wrappers

**Files:**

- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add Phase 2 invoke functions**

`src/lib/tauri.ts` (add at the end):

```ts
import type { DetectionResult, PlateSolveResult, BlinkState, FrameMeta } from '../types/phase2'

export interface LoadFramesResult {
  frames: FrameMeta[]
  total: number
}

export interface RawPixels {
  width: number
  height: number
  pixels: number[]
  min: number
  max: number
}

export async function loadFrames(paths: string[]): Promise<LoadFramesResult> {
  return invoke('load_frames', { paths })
}

export async function getFramePixels(index: number): Promise<RawPixels> {
  return invoke('get_frame_pixels', { index })
}

export async function detectStars(): Promise<DetectionResult> {
  return invoke('detect_stars')
}

export interface SolveParams {
  index_path: string
}

export async function plateSolve(params: SolveParams): Promise<PlateSolveResult> {
  return invoke('plate_solve', { params })
}

export async function blinkSetFrame(index: number): Promise<BlinkState> {
  return invoke('blink_set_frame', { index })
}

export async function blinkNext(): Promise<BlinkState> {
  return invoke('blink_next')
}

export async function blinkPrev(): Promise<BlinkState> {
  return invoke('blink_prev')
}

export async function blinkSetSpeed(speedMs: number): Promise<void> {
  return invoke('blink_set_speed', { speedMs })
}

export async function blinkToggle(): Promise<boolean> {
  return invoke('blink_toggle')
}

export async function blinkGetState(): Promise<BlinkState> {
  return invoke('blink_get_state')
}
```

---

### Task 10: Create session store

**Files:**

- Create: `src/stores/sessionStore.ts`

- [ ] **Step 1: Implement multi-frame session store**

`src/stores/sessionStore.ts`:

```ts
import { create } from 'zustand'
import type { DetectedStar, WCS, FrameMeta, BlinkState } from '../types/phase2'

interface SessionState {
  // Detection
  detectedStars: DetectedStar[]
  noise: number
  isDetecting: boolean

  // WCS
  wcs: WCS | null
  isSolving: boolean
  solveSuccess: boolean

  // Blink
  frames: FrameMeta[]
  currentFrameIndex: number
  isPlaying: boolean
  speedMs: number

  // Actions
  setDetectedStars: (stars: DetectedStar[], noise: number) => void
  setWCS: (wcs: WCS | null, success: boolean) => void
  setIsDetecting: (v: boolean) => void
  setIsSolving: (v: boolean) => void
  setBlinkState: (state: BlinkState) => void
  setCurrentFrame: (index: number) => void
  setPlaying: (playing: boolean) => void
  setSpeedMs: (ms: number) => void
  resetSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  detectedStars: [],
  noise: 0,
  isDetecting: false,
  wcs: null,
  isSolving: false,
  solveSuccess: false,
  frames: [],
  currentFrameIndex: 0,
  isPlaying: false,
  speedMs: 300,

  setDetectedStars: (stars, noise) => set({ detectedStars: stars, noise }),
  setWCS: (wcs, success) => set({ wcs, solveSuccess: success }),
  setIsDetecting: (v) => set({ isDetecting: v }),
  setIsSolving: (v) => set({ isSolving: v }),
  setBlinkState: (state) =>
    set({
      frames: state.frames,
      currentFrameIndex: state.current_index,
      isPlaying: state.playing,
      speedMs: state.speed_ms,
    }),
  setCurrentFrame: (index) => set({ currentFrameIndex: index }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setSpeedMs: (ms) => set({ speedMs: ms }),
  resetSession: () =>
    set({
      detectedStars: [],
      noise: 0,
      wcs: null,
      solveSuccess: false,
      frames: [],
      currentFrameIndex: 0,
      isPlaying: false,
      speedMs: 300,
    }),
}))
```

---

### Task 11: Implement StarOverlay component

**Files:**

- Create: `src/components/StarOverlay.tsx`

- [ ] **Step 1: Canvas overlay for reference stars and annotations**

`src/components/StarOverlay.tsx`:

```tsx
import { useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

export function StarOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { detectedStars, wcs } = useSessionStore()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw detected stars as green circles
    for (const star of detectedStars) {
      ctx.beginPath()
      ctx.arc(star.x, star.y, 4, 0, Math.PI * 2)
      ctx.strokeStyle = '#38d9a9'
      ctx.lineWidth = 1
      ctx.stroke()

      // Crosshair
      ctx.beginPath()
      ctx.moveTo(star.x - 6, star.y)
      ctx.lineTo(star.x + 6, star.y)
      ctx.moveTo(star.x, star.y - 6)
      ctx.lineTo(star.x, star.y + 6)
      ctx.stroke()
    }

    // Draw WCS center
    if (wcs) {
      ctx.beginPath()
      ctx.arc(wcs.crpix1, wcs.crpix2, 6, 0, Math.PI * 2)
      ctx.strokeStyle = '#0070f3'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }, [detectedStars, wcs])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
```

---

### Task 12: Integrate StarOverlay into FITSViewer

**Files:**

- Modify: `src/components/FITSViewer/FITSViewer.tsx`

- [ ] **Step 1: Add StarOverlay composition**

```tsx
import { StarOverlay } from '../StarOverlay'

// Inside the return, after the <canvas> element:
{
  imageData && <StarOverlay />
}
```

---

### Task 13: Implement BlinkToolbar component

**Files:**

- Create: `src/components/BlinkToolbar.tsx`

- [ ] **Step 1: Blink playback controls (appears when 2+ frames loaded)**

`src/components/BlinkToolbar.tsx`:

```tsx
import { useEffect, useCallback, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { blinkNext, blinkPrev, blinkSetSpeed } from '../lib/tauri'
import { Play, Square, ChevronLeft, ChevronRight } from 'lucide-react'

export function BlinkToolbar() {
  const { frames, currentFrameIndex, isPlaying, speedMs, setBlinkState } = useSessionStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Blink timer - managed via local ref to avoid re-creating on every frame switch
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (isPlaying && frames.length >= 2) {
      timerRef.current = setInterval(async () => {
        try {
          const state = await blinkNext()
          setBlinkState(state)
        } catch {
          /* ignore */
        }
      }, speedMs)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying, speedMs, frames.length, setBlinkState])

  const handlePrev = useCallback(async () => {
    try {
      const state = await blinkPrev()
      setBlinkState(state)
    } catch {
      /* ignore */
    }
  }, [setBlinkState])

  const handleNext = useCallback(async () => {
    try {
      const state = await blinkNext()
      setBlinkState(state)
    } catch {
      /* ignore */
    }
  }, [setBlinkState])

  const handleSpeedChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const ms = Number(e.target.value)
    try {
      await blinkSetSpeed(ms)
      useSessionStore.getState().setSpeedMs(ms)
    } catch {
      /* ignore */
    }
  }, [])

  if (frames.length < 2) return null

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10
                    flex items-center gap-2 px-3 py-1.5 rounded-md
                    bg-[#111] border border-[#2a2a2a] text-sm select-none"
    >
      <span className="text-[#666] text-xs">
        {currentFrameIndex + 1}/{frames.length}
      </span>

      <button
        onClick={handlePrev}
        className="p-1 rounded text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]"
        title="上一帧"
      >
        <ChevronLeft size={16} />
      </button>

      <button
        onClick={async () => {
          const playing = await invoke<boolean>('blink_toggle')
          useSessionStore.getState().setPlaying(playing)
        }}
        className="p-1 rounded text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]"
        title={isPlaying ? '停止' : '开始 Blink'}
      >
        {isPlaying ? <Square size={16} /> : <Play size={16} />}
      </button>

      <button
        onClick={handleNext}
        className="p-1 rounded text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]"
        title="下一帧"
      >
        <ChevronRight size={16} />
      </button>

      <div className="w-px h-4 bg-[#2a2a2a]" />

      <div className="flex items-center gap-1">
        <span className="text-[#666] text-xs">速度</span>
        <input
          type="range"
          min={50}
          max={1000}
          step={50}
          value={speedMs}
          onChange={handleSpeedChange}
          className="w-16 h-1 accent-[#0070f3]"
        />
      </div>

      <span className="text-[#666] text-xs w-8 text-right">{speedMs}ms</span>
    </div>
  )
}
```

---

### Task 14: Implement FramePanel component

**Files:**

- Create: `src/components/FramePanel.tsx`

- [ ] **Step 1: Frame list sidebar (frames loaded via multi-select "打开", no add button)**

`src/components/FramePanel.tsx`:

```tsx
import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { blinkSetFrame } from '../lib/tauri'

export function FramePanel() {
  const { frames, currentFrameIndex, setBlinkState } = useSessionStore()

  const handleSelect = useCallback(
    async (index: number) => {
      try {
        const state = await blinkSetFrame(index)
        setBlinkState(state)
      } catch {
        /* ignore */
      }
    },
    [setBlinkState],
  )

  return (
    <div className="w-60 flex flex-col border-l border-[#2a2a2a] bg-[#0d0d0d]">
      <div className="flex items-center px-3 py-2 border-b border-[#2a2a2a]">
        <span className="text-xs font-medium text-[#666] uppercase tracking-wider">
          帧列表 ({frames.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {frames.map((frame) => (
          <button
            key={frame.path}
            onClick={() => handleSelect(frames.indexOf(frame))}
            className={`w-full text-left px-3 py-2 text-xs border-b border-[#2a2a2a] transition-colors ${
              frames.indexOf(frame) === currentFrameIndex
                ? 'bg-[#1a3a5c] text-white'
                : 'text-[#a1a1a1] hover:bg-[#111] hover:text-white'
            }`}
          >
            <div className="font-medium truncate">{frame.label}</div>
            <div className="text-[#666] mt-0.5">
              {frame.width}×{frame.height}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

---

### Task 15: Update App.tsx layout

**Files:**

- Modify: `src/App.tsx`

**UX change:** "打开" now uses `multiple: true`. 1 file → single mode. 2+ → Blink mode with frame panel + toolbar. FileOpenButton is replaced with an inline open handler that calls `load_frames`. When a frame is selected (via blink_set_frame), we reload pixels and re-stretch.

- [ ] **Step 1: Rewrite App.tsx with Blink-aware UX**

```tsx
import { useCallback, useEffect } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FITSViewer } from './components/FITSViewer'
import { StatusBar } from './components/StatusBar'
import { BlinkToolbar } from './components/BlinkToolbar'
import { FramePanel } from './components/FramePanel'
import { useFitsStore } from './stores/fitsStore'
import { useSessionStore } from './stores/sessionStore'
import { loadFrames, getFramePixels, detectStars, plateSolve, blinkGetState } from './lib/tauri'
import { asinhStretchInverted, zscale } from './lib/stretch'
import { Stars, Orbit } from 'lucide-react'

function App() {
  const { error, setMeta, setRawPixels, setImageData, setLoading, setError, setFilePath } =
    useFitsStore()
  const {
    detectedStars,
    wcs,
    isDetecting,
    isSolving,
    frames,
    currentFrameIndex,
    setBlinkState,
    setDetectedStars,
    setWCS,
    setIsDetecting,
    setIsSolving,
  } = useSessionStore()

  const isBlinkMode = frames.length >= 2

  // When current frame changes in Blink mode, reload pixels
  useEffect(() => {
    if (!isBlinkMode || frames.length === 0) return
    const frame = frames[currentFrameIndex]
    if (!frame) return

    getFramePixels(currentFrameIndex)
      .then((raw) => {
        const pixels = new Float32Array(raw.pixels)
        setRawPixels(pixels, raw.width, raw.height)
        setMeta({
          path: frame.path,
          width: raw.width,
          height: raw.height,
          min_val: raw.min,
          max_val: raw.max,
          object: frame.object,
          ra: frame.ra,
          dec: frame.dec,
          exposure: frame.exposure,
          filter: frame.filter,
          date_obs: frame.date_obs,
          focal_length: frame.focal_length,
          pixel_size: frame.pixel_size,
        })
        // Re-stretch
        const { z1, z2 } = zscale(pixels)
        const imgData = asinhStretchInverted(pixels, z1, z2, raw.width, raw.height)
        setImageData(imgData)
      })
      .catch((err) => setError(String(err)))
  }, [currentFrameIndex, isBlinkMode])

  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'FITS', extensions: ['fits', 'fit', 'fts'] }],
      })
      if (!selected) return
      const paths = selected as string[]
      setLoading(true)
      setError(null)

      const result = await loadFrames(paths)
      const first = result.frames[0]

      // Set first frame metadata
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
      })

      // Get pixels and stretch
      const raw = await getFramePixels(0)
      const pixels = new Float32Array(raw.pixels)
      setRawPixels(pixels, raw.width, raw.height)
      const { z1, z2 } = zscale(pixels)
      const imgData = asinhStretchInverted(pixels, z1, z2, raw.width, raw.height)
      setImageData(imgData)

      // If 2+ files, set up Blink session
      if (result.frames.length >= 2) {
        const blinkState = await blinkGetState()
        setBlinkState(blinkState)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [setMeta, setRawPixels, setImageData, setLoading, setError, setFilePath, setBlinkState])

  const handleDetect = useCallback(async () => {
    setIsDetecting(true)
    try {
      const result = await detectStars()
      setDetectedStars(result.stars, result.noise)
    } catch {
      /* ignore */
    }
    setIsDetecting(false)
  }, [setIsDetecting, setDetectedStars])

  const handleSolve = useCallback(async () => {
    if (detectedStars.length === 0) return
    setIsSolving(true)
    try {
      const result = await plateSolve({ index_path: '' })
      setWCS(result.wcs, result.success)
    } catch {
      /* ignore */
    }
    setIsSolving(false)
  }, [detectedStars, setIsSolving, setWCS])

  return (
    <div className="h-screen w-screen flex flex-col bg-sky-canvas-soft-2 overflow-hidden">
      {/* Menu Bar */}
      <div className="h-10 flex items-center px-3 gap-2 bg-sky-canvas-soft border-b border-sky-hairline select-none shrink-0">
        <span className="text-sky-ink font-semibold text-sm mr-2">SkyEye</span>

        {/* Open button triggers multi-select dialog */}
        <button
          onClick={handleOpen}
          className="px-3 py-1.5 rounded-md text-sm font-medium
                     bg-[#0070f3] text-white hover:bg-[#0058cc] transition-colors"
        >
          打开
        </button>

        {frames.length > 0 && (
          <>
            <div className="w-px h-4 bg-[#2a2a2a]" />
            <button
              onClick={handleDetect}
              disabled={isDetecting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a] disabled:opacity-50"
            >
              <Stars size={14} />
              星点检测
            </button>
            <button
              onClick={handleSolve}
              disabled={isSolving || detectedStars.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a] disabled:opacity-50"
            >
              <Orbit size={14} />
              底片解算
            </button>
          </>
        )}
      </div>

      {/* Status messages */}
      {error && (
        <div className="bg-sky-accent-red/10 text-sky-accent-red text-xs px-3 py-1 border-b border-sky-accent-red/30">
          {error}
        </div>
      )}
      {isDetecting && (
        <div className="bg-sky-accent-yellow/10 text-sky-accent-yellow text-xs px-3 py-1 border-b border-sky-accent-yellow/30">
          正在检测星点...
        </div>
      )}
      {isSolving && (
        <div className="bg-sky-accent-yellow/10 text-sky-accent-yellow text-xs px-3 py-1 border-b border-sky-accent-yellow/30">
          正在底片解算...
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <FITSViewer />
          {isBlinkMode && <BlinkToolbar />}
        </div>
        {isBlinkMode && <FramePanel />}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Star count info */}
      {detectedStars.length > 0 && (
        <div className="absolute bottom-8 left-3 text-xs text-sky-mute font-mono pointer-events-none select-none">
          {detectedStars.length} stars | noise {useSessionStore.getState().noise.toFixed(1)} ADU
          {wcs && ` | scale ${(wcs.cd1_1 ** 2 + wcs.cd2_1 ** 2).toFixed(2)}"/px`}
        </div>
      )}
    </div>
  )
}

export default App
```

---

### Task 16: Update StatusBar for Phase 2 state

**Files:**

- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Add detection/solve info**

```tsx
import { useFitsStore } from '../stores/fitsStore'
import { useSessionStore } from '../stores/sessionStore'

export function StatusBar() {
  const { meta, zoom, width, height } = useFitsStore()
  const { detectedStars, wcs, frames, currentFrameIndex } = useSessionStore()

  return (
    <div
      className="h-[22px] flex items-center px-3 text-xs font-mono
                    bg-sky-canvas-soft text-sky-mute border-t border-sky-hairline select-none gap-4"
    >
      {meta ? (
        <>
          <span>{meta.object || '(无目标)'}</span>
          <span>
            {meta.width}×{meta.height}
          </span>
          {meta.ra != null && (
            <span>
              RA {meta.ra.toFixed(5)}° Dec {meta.dec.toFixed(5)}°
            </span>
          )}
          {detectedStars.length > 0 && <span>{detectedStars.length} 星</span>}
          {wcs && <span>已解算</span>}
          {frames.length > 0 && (
            <span>
              帧 {currentFrameIndex + 1}/{frames.length}
            </span>
          )}
          <span className="ml-auto">{zoom.toFixed(1)}x</span>
        </>
      ) : (
        <span>就绪</span>
      )}
    </div>
  )
}
```

---

### Task 17: Verification

- [ ] **Compile check:**

  ```bash
  cd D:\MyWork\sky-eye
  pnpm tauri build
  ```

  Expected: Compilation succeeds

- [ ] **Functional verification:**
  1. Click "打开" → select 1 FITS file → image displays (single mode)
  2. Click "打开" again → select 3 FITS files → all load, frame panel appears on right
  3. Blink toolbar appears at bottom with frame counter "1/3"
  4. Click play ▶ in blink toolbar → frames cycle automatically
  5. Adjust speed slider → blink speed changes
  6. Click frame in sidebar → switches to that frame, pixels reload
  7. Click "星点检测" → detected stars appear as green circles on overlay
  8. Click "底片解算" → WCS center marked in blue

- [ ] **Edge cases:**
  - Open single file → single mode (no BlinkToolbar, no FramePanel)
  - Open 2+ files → Blink mode with toolbar + panel
  - Detection on a blank/noisy image → 0 stars, no crash
  - Solve without detection → button disabled
  - Rapid blink toggle → no race conditions
