mod centroid;
mod quality;
mod sep_backend;

pub use centroid::refine_astrometric_centroids;
pub use quality::{mark_saturated_sources, select_astrometry_sources};
pub use sep_backend::SepReducer;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BackgroundConfig {
    pub mesh_width: i64,
    pub mesh_height: i64,
    pub filter_width: i64,
    pub filter_height: i64,
    pub filter_threshold: f64,
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self {
            mesh_width: 64,
            mesh_height: 64,
            filter_width: 3,
            filter_height: 3,
            filter_threshold: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DetectionConfig {
    pub threshold_sigma: f32,
    pub min_area: i32,
    pub deblend_levels: i32,
    pub deblend_contrast: f64,
    pub clean: bool,
    pub clean_param: f64,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            threshold_sigma: 3.0,
            min_area: 5,
            deblend_levels: 32,
            deblend_contrast: 0.005,
            clean: true,
            clean_param: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BackgroundModel {
    pub map: Vec<f32>,
    pub global: f32,
    pub global_rms: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceMeasurement {
    pub x: f64,
    pub y: f64,
    pub peak: f32,
    pub flux: f64,
    pub fwhm: f64,
    pub ellipticity: f64,
    pub npix: u32,
    pub flags: i16,
    pub saturated: bool,
    pub snr: Option<f64>,
    pub x_error_px: Option<f64>,
    pub y_error_px: Option<f64>,
    pub centroid_refined: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ApertureConfig {
    pub radius: f64,
    pub annulus_inner: f64,
    pub annulus_outer: f64,
    pub subpixels: i32,
    pub sigma_clip: f64,
    pub clip_iterations: usize,
}

impl Default for ApertureConfig {
    fn default() -> Self {
        Self {
            radius: 5.0,
            annulus_inner: 8.0,
            annulus_outer: 12.0,
            subpixels: 5,
            sigma_clip: 3.0,
            clip_iterations: 3,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ApertureMeasurement {
    pub x: f64,
    pub y: f64,
    pub aperture_radius: f64,
    pub flux: f64,
    pub flux_error: f64,
    pub snr: Option<f64>,
    pub background_per_pixel: f64,
    pub aperture_area: f64,
    pub annulus_pixels: usize,
    pub flags: i16,
}

#[derive(Debug, Clone, Copy)]
pub struct ApertureRequest {
    pub x: f64,
    pub y: f64,
    pub noise_rms: f32,
    pub config: ApertureConfig,
}

#[derive(Debug, thiserror::Error)]
pub enum ReductionError {
    #[error("image dimensions must be positive")]
    EmptyImage,
    #[error("pixel count {actual} does not match {width} x {height}")]
    InvalidDimensions {
        actual: usize,
        width: u32,
        height: u32,
    },
    #[error("invalid reduction configuration: {0}")]
    InvalidConfig(&'static str),
    #[error("SEP operation {operation} failed with status {status}")]
    Sep {
        operation: &'static str,
        status: i32,
    },
    #[error("SEP returned an invalid null result for {0}")]
    NullResult(&'static str),
}

pub trait ReductionBackend {
    fn background(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        config: BackgroundConfig,
    ) -> Result<BackgroundModel, ReductionError>;

    fn detect(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        background: &BackgroundModel,
        config: DetectionConfig,
    ) -> Result<Vec<SourceMeasurement>, ReductionError>;

    fn aperture_photometry(
        &self,
        pixels: &[f32],
        width: u32,
        height: u32,
        request: ApertureRequest,
    ) -> Result<ApertureMeasurement, ReductionError>;
}

fn validate_image(pixels: &[f32], width: u32, height: u32) -> Result<(), ReductionError> {
    if width == 0 || height == 0 {
        return Err(ReductionError::EmptyImage);
    }
    let expected = width as usize * height as usize;
    if pixels.len() != expected {
        return Err(ReductionError::InvalidDimensions {
            actual: pixels.len(),
            width,
            height,
        });
    }
    Ok(())
}
