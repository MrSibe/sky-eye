use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct StorageLayout {
    pub root: PathBuf,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub mpcorb_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub settings_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StationConfig {
    pub mpc_code: String,
    pub name: String,
    pub longitude_deg_east: Option<f64>,
    pub latitude_deg: Option<f64>,
    pub altitude_m: Option<f64>,
    pub telescope: Option<String>,
    pub aperture_m: Option<f64>,
    pub focal_ratio: Option<f64>,
    pub detector: String,
    pub observer_names: Vec<String>,
    pub measurer_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct InstrumentConfig {
    pub focal_length_mm: Option<f64>,
    pub focal_length_tolerance_percent: f64,
    pub pixel_width_um: Option<f64>,
    pub pixel_height_um: Option<f64>,
    pub position_angle_deg: Option<f64>,
    pub position_angle_tolerance_deg: f64,
    pub pointing_tolerance_arcmin: f64,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub auto_rotate_pierside: bool,
    pub saturation_adu: Option<f64>,
}

impl Default for InstrumentConfig {
    fn default() -> Self {
        Self {
            focal_length_mm: Some(1800.0),
            focal_length_tolerance_percent: 1.0,
            pixel_width_um: Some(23.0),
            pixel_height_um: Some(27.0),
            position_angle_deg: Some(0.0),
            position_angle_tolerance_deg: 10.0,
            pointing_tolerance_arcmin: 5.0,
            flip_horizontal: true,
            flip_vertical: false,
            auto_rotate_pierside: false,
            saturation_adu: Some(60_000.0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TimeConfig {
    pub date_obs_reference: String,
    pub exposure_unit: String,
    pub utc_offset_hours: f64,
    pub shutter_delay_seconds: f64,
    pub precision_seconds: f64,
    pub check_after_loading: bool,
}

impl Default for TimeConfig {
    fn default() -> Self {
        Self {
            date_obs_reference: "start".into(),
            exposure_unit: "seconds".into(),
            utc_offset_hours: 0.0,
            shutter_delay_seconds: 0.0,
            precision_seconds: 1.0,
            check_after_loading: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ReductionConfig {
    pub astrometry_catalog: String,
    pub detection_sigma: f64,
    pub minimum_fwhm_px: f64,
    pub maximum_psf_fit_rms: f64,
    pub centroid_search_radius_px: f64,
    pub centroid_method: String,
    pub plate_model: String,
    pub catalog_bright_limit_mag: f64,
    pub catalog_faint_limit_mag: f64,
    pub maximum_reference_stars: u32,
    pub initial_match_radius_px: f64,
    pub astrometric_residual_limit_arcsec: f64,
    pub alignment_reference_stars: u32,
}

impl Default for ReductionConfig {
    fn default() -> Self {
        Self {
            astrometry_catalog: "Gaia3".into(),
            detection_sigma: 4.0,
            minimum_fwhm_px: 0.70,
            maximum_psf_fit_rms: 0.20,
            centroid_search_radius_px: 0.75,
            centroid_method: "psf".into(),
            plate_model: "linear".into(),
            catalog_bright_limit_mag: 10.0,
            catalog_faint_limit_mag: 18.0,
            maximum_reference_stars: 50,
            initial_match_radius_px: 2.0,
            astrometric_residual_limit_arcsec: 0.50,
            alignment_reference_stars: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PhotometryConfig {
    pub catalog: String,
    pub reference_band: String,
    pub aperture_mode: String,
    pub aperture_fwhm_multiplier: f64,
    pub fixed_aperture_radius_px: f64,
    pub aperture_gap_px: f64,
    pub sky_annulus_inner_fwhm: f64,
    pub sky_annulus_outer_fwhm: f64,
    pub minimum_reference_stars: u32,
    pub maximum_catalog_error_mag: f64,
    pub maximum_residual_mag: f64,
    pub fit_color_term: bool,
}

impl Default for PhotometryConfig {
    fn default() -> Self {
        Self {
            catalog: "ATLAS2".into(),
            reference_band: "r".into(),
            aperture_mode: "fixed".into(),
            aperture_fwhm_multiplier: 1.5,
            fixed_aperture_radius_px: 4.0,
            aperture_gap_px: 1.0,
            sky_annulus_inner_fwhm: 2.5,
            sky_annulus_outer_fwhm: 4.0,
            minimum_reference_stars: 8,
            maximum_catalog_error_mag: 0.10,
            maximum_residual_mag: 0.50,
            fit_color_term: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ReportConfig {
    pub default_format: String,
    pub band: String,
    pub include_magnitude: bool,
    pub position_precision_1e6_deg: bool,
    pub magnitude_precision_hundredth: bool,
    pub allow_artificial_satellites: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct ReportBandMapping {
    pub code: &'static str,
    pub label: &'static str,
}

pub const REPORT_BAND_MAPPINGS: [ReportBandMapping; 11] = [
    ReportBandMapping {
        code: "C",
        label: "Clear / None",
    },
    ReportBandMapping {
        code: "U",
        label: "U (Johnson)",
    },
    ReportBandMapping {
        code: "B",
        label: "B (Johnson)",
    },
    ReportBandMapping {
        code: "V",
        label: "V (Johnson)",
    },
    ReportBandMapping {
        code: "R",
        label: "R (Cousins)",
    },
    ReportBandMapping {
        code: "I",
        label: "I (Cousins)",
    },
    ReportBandMapping {
        code: "u",
        label: "u (Sloan)",
    },
    ReportBandMapping {
        code: "g",
        label: "g (Sloan)",
    },
    ReportBandMapping {
        code: "r",
        label: "r (Sloan)",
    },
    ReportBandMapping {
        code: "i",
        label: "i (Sloan)",
    },
    ReportBandMapping {
        code: "z",
        label: "z (Sloan)",
    },
];

impl Default for ReportConfig {
    fn default() -> Self {
        Self {
            default_format: "ades2022_psv".into(),
            band: "R".into(),
            include_magnitude: true,
            position_precision_1e6_deg: false,
            magnitude_precision_hundredth: false,
            allow_artificial_satellites: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DataConfig {
    pub mpcorb_auto_update: bool,
    pub mpcorb_max_age_hours: u32,
    pub known_object_mba_limit_mag: f64,
    pub known_object_tno_limit_mag: f64,
    pub known_object_magnitude_offset: f64,
}

impl Default for DataConfig {
    fn default() -> Self {
        Self {
            mpcorb_auto_update: true,
            mpcorb_max_age_hours: 24,
            known_object_mba_limit_mag: 22.0,
            known_object_tno_limit_mag: 20.0,
            known_object_magnitude_offset: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub station: StationConfig,
    pub submitter: String,
    pub instrument: InstrumentConfig,
    pub time: TimeConfig,
    pub reduction: ReductionConfig,
    pub photometry: PhotometryConfig,
    pub report: ReportConfig,
    pub data: DataConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            station: StationConfig {
                mpc_code: "XXX".into(),
                name: String::new(),
                longitude_deg_east: Some(-14.0),
                latitude_deg: Some(48.0),
                altitude_m: Some(800.0),
                telescope: None,
                aperture_m: None,
                focal_ratio: None,
                detector: String::new(),
                observer_names: Vec::new(),
                measurer_names: Vec::new(),
            },
            submitter: String::new(),
            instrument: InstrumentConfig::default(),
            time: TimeConfig::default(),
            reduction: ReductionConfig::default(),
            photometry: PhotometryConfig::default(),
            report: ReportConfig::default(),
            data: DataConfig::default(),
        }
    }
}

pub fn layout(app: &tauri::AppHandle) -> Result<StorageLayout, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_dir = root.join("config");
    let data_dir = root.join("data");
    Ok(StorageLayout {
        settings_file: config_dir.join("settings.json"),
        mpcorb_dir: data_dir.join("mpcorb"),
        cache_dir: root.join("cache"),
        exports_dir: root.join("exports"),
        logs_dir: root.join("logs"),
        root,
        config_dir,
        data_dir,
    })
}

pub fn initialize(app: &tauri::AppHandle) -> Result<StorageLayout, String> {
    let paths = layout(app)?;
    for directory in [
        &paths.root,
        &paths.config_dir,
        &paths.data_dir,
        &paths.mpcorb_dir,
        &paths.cache_dir,
        &paths.exports_dir,
        &paths.logs_dir,
    ] {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    if !paths.settings_file.exists() {
        save_config(app, &AppConfig::default())?;
    }
    Ok(paths)
}

pub fn load_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let paths = initialize(app)?;
    let bytes = fs::read(&paths.settings_file).map_err(|e| e.to_string())?;
    let config: AppConfig =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid config/settings.json: {e}"))?;
    // Pre-release development schemas are reset in memory, not migrated or
    // rewritten. The v1 file is written only after an explicit user save.
    if config.schema_version != 1 {
        return Ok(AppConfig::default());
    }
    validate(&config)?;
    Ok(config)
}

pub fn save_config(app: &tauri::AppHandle, value: &AppConfig) -> Result<(), String> {
    validate(value)?;
    let paths = layout(app)?;
    fs::create_dir_all(&paths.config_dir).map_err(|e| e.to_string())?;
    let temporary = paths.config_dir.join(".settings.json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let backup = paths.config_dir.join("settings.json.previous");
    if paths.settings_file.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&paths.settings_file, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, &paths.settings_file) {
        if backup.exists() {
            let _ = fs::rename(&backup, &paths.settings_file);
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

fn validate(value: &AppConfig) -> Result<(), String> {
    if value.schema_version != 1 {
        return Err("unsupported settings schema version".into());
    }
    if !value.station.mpc_code.is_empty()
        && (value.station.mpc_code.len() != 3 || !value.station.mpc_code.is_ascii())
    {
        return Err("MPC station code must be empty or exactly 3 ASCII characters".into());
    }
    if value
        .station
        .longitude_deg_east
        .is_some_and(|x| !(-180.0..=180.0).contains(&x))
        || value
            .station
            .latitude_deg
            .is_some_and(|x| !(-90.0..=90.0).contains(&x))
    {
        return Err("station coordinates are out of range".into());
    }
    if !matches!(
        value.time.date_obs_reference.as_str(),
        "start" | "midpoint" | "end"
    ) || !matches!(
        value.time.exposure_unit.as_str(),
        "seconds" | "milliseconds" | "minutes"
    ) {
        return Err("invalid FITS time interpretation settings".into());
    }
    if !(1.0..=20.0).contains(&value.reduction.detection_sigma)
        || value.reduction.catalog_bright_limit_mag > value.reduction.catalog_faint_limit_mag
        || !matches!(
            value.reduction.plate_model.as_str(),
            "linear" | "quadratic" | "cubic"
        )
    {
        return Err("invalid reduction settings".into());
    }
    if !matches!(
        value.photometry.reference_band.as_str(),
        "G" | "g" | "r" | "i" | "z"
    ) || !matches!(
        value.photometry.aperture_mode.as_str(),
        "adaptive" | "fixed"
    ) || !(0.5..=5.0).contains(&value.photometry.aperture_fwhm_multiplier)
        || value.photometry.sky_annulus_inner_fwhm >= value.photometry.sky_annulus_outer_fwhm
        || value.photometry.minimum_reference_stars < 3
    {
        return Err("invalid photometry settings".into());
    }
    if !REPORT_BAND_MAPPINGS
        .iter()
        .any(|mapping| mapping.code == value.report.band)
    {
        return Err("unsupported MPC/ADES report band".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        validate(&AppConfig::default()).unwrap();
    }

    #[test]
    fn defaults_follow_astrometrica_reference_profile() {
        let config = AppConfig::default();

        assert_eq!(config.station.mpc_code, "XXX");
        assert_eq!(config.station.longitude_deg_east, Some(-14.0));
        assert_eq!(config.station.latitude_deg, Some(48.0));
        assert_eq!(config.station.altitude_m, Some(800.0));
        assert!(config.station.observer_names.is_empty());
        assert!(config.station.measurer_names.is_empty());

        assert_eq!(config.instrument.focal_length_mm, Some(1800.0));
        assert_eq!(config.instrument.pixel_width_um, Some(23.0));
        assert_eq!(config.instrument.pixel_height_um, Some(27.0));
        assert_eq!(config.instrument.position_angle_deg, Some(0.0));
        assert_eq!(config.instrument.position_angle_tolerance_deg, 10.0);
        assert!(config.instrument.flip_horizontal);
        assert!(!config.instrument.flip_vertical);
        assert_eq!(config.instrument.saturation_adu, Some(60_000.0));

        assert_eq!(config.time.precision_seconds, 1.0);
        assert!(config.time.check_after_loading);
        assert_eq!(config.reduction.detection_sigma, 4.0);
        assert_eq!(config.reduction.minimum_fwhm_px, 0.70);
        assert_eq!(config.reduction.maximum_psf_fit_rms, 0.20);
        assert_eq!(config.reduction.centroid_search_radius_px, 0.75);
        assert_eq!(config.reduction.plate_model, "linear");
        assert_eq!(config.reduction.catalog_bright_limit_mag, 10.0);
        assert_eq!(config.reduction.catalog_faint_limit_mag, 18.0);
        assert_eq!(config.reduction.maximum_reference_stars, 50);
        assert_eq!(config.reduction.initial_match_radius_px, 2.0);
        assert_eq!(config.reduction.astrometric_residual_limit_arcsec, 0.50);
        assert_eq!(config.reduction.alignment_reference_stars, 30);

        assert_eq!(config.photometry.reference_band, "r");
        assert_eq!(config.photometry.fixed_aperture_radius_px, 4.0);
        assert_eq!(config.photometry.maximum_residual_mag, 0.50);
        assert_eq!(config.report.band, "R");
        assert!(config.report.include_magnitude);
        assert!(!config.report.position_precision_1e6_deg);
        assert!(!config.report.magnitude_precision_hundredth);
    }
}
