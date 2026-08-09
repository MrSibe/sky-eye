use ndarray::Array2;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const UNIX_EPOCH_JD: f64 = 2_440_587.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FrameId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TimeScale {
    Utc,
    Tai,
    Tt,
}

/// A split Julian Date. Keeping the integer-sized and fractional parts separate
/// preserves precision when exposure midpoints are added later.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AstroTime {
    pub jd1: f64,
    pub jd2: f64,
    pub scale: TimeScale,
}

impl AstroTime {
    pub fn from_utc_rfc3339(value: &str) -> Result<Self, time::error::Parse> {
        let datetime = OffsetDateTime::parse(value, &Rfc3339)?;
        let unix_seconds =
            datetime.unix_timestamp() as f64 + f64::from(datetime.nanosecond()) / 1_000_000_000.0;
        let jd = UNIX_EPOCH_JD + unix_seconds / 86_400.0;
        let jd1 = jd.floor();
        Ok(Self {
            jd1,
            jd2: jd - jd1,
            scale: TimeScale::Utc,
        })
    }

    pub fn from_fits_utc(value: &str) -> Result<Self, time::error::Parse> {
        Self::from_utc_rfc3339(value).or_else(|_| Self::from_utc_rfc3339(&format!("{value}Z")))
    }

    pub fn midpoint(self, exposure_seconds: f64) -> Self {
        let total = self.jd1 + self.jd2 + exposure_seconds / 172_800.0;
        let jd1 = total.floor();
        Self {
            jd1,
            jd2: total - jd1,
            scale: self.scale,
        }
    }

    pub fn julian_date(self) -> f64 {
        self.jd1 + self.jd2
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationState {
    Raw,
    DarkCorrected,
    FlatCorrected,
    FullyCalibrated,
}

#[derive(Debug, Clone)]
pub struct ImageFrame {
    pub id: FrameId,
    pub pixels: Array2<f32>,
    pub observation_start: Option<AstroTime>,
    pub exposure_seconds: Option<f64>,
    pub calibration: CalibrationState,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MeasurementUncertainty {
    pub x_px: Option<f64>,
    pub y_px: Option<f64>,
    pub ra_arcsec: Option<f64>,
    pub dec_arcsec: Option<f64>,
    pub magnitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Measurement {
    pub frame_id: FrameId,
    pub x: f64,
    pub y: f64,
    pub ra_deg: Option<f64>,
    pub dec_deg: Option<f64>,
    pub flux: f64,
    pub snr: Option<f64>,
    pub fwhm_px: Option<f64>,
    pub magnitude: Option<f64>,
    pub uncertainties: MeasurementUncertainty,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_epoch_maps_to_expected_jd() {
        let time = AstroTime::from_utc_rfc3339("1970-01-01T00:00:00Z").unwrap();
        assert!((time.julian_date() - UNIX_EPOCH_JD).abs() < 1e-9);
    }

    #[test]
    fn midpoint_adds_half_the_exposure() {
        let start = AstroTime::from_utc_rfc3339("2000-01-01T12:00:00Z").unwrap();
        let midpoint = start.midpoint(120.0);
        assert!((midpoint.julian_date() - start.julian_date() - 60.0 / 86_400.0).abs() < 1e-9);
    }

    #[test]
    fn fits_utc_accepts_timestamp_without_zone_suffix() {
        let time = AstroTime::from_fits_utc("2000-01-01T12:00:00").unwrap();
        assert!((time.julian_date() - 2_451_545.0).abs() < 1e-9);
    }
}
