use ndarray::Array2;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime, UtcOffset};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FrameId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TimeScale {
    Utc,
    Tai,
    Tt,
    Ut1,
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
    pub fn from_utc_rfc3339(value: &str) -> Result<Self, String> {
        let datetime = OffsetDateTime::parse(value, &Rfc3339)
            .map_err(|error| format!("invalid UTC timestamp: {error}"))?
            .to_offset(UtcOffset::UTC);
        Self::from_utc_components(
            datetime.year(),
            datetime.month() as u8,
            datetime.day(),
            datetime.hour(),
            datetime.minute(),
            f64::from(datetime.second()) + f64::from(datetime.nanosecond()) / 1.0e9,
        )
    }

    pub fn from_utc_components(
        year: i32,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: f64,
    ) -> Result<Self, String> {
        let ((jd1, jd2), warning) = erfars::timescales::Dtf2d(
            true,
            year,
            i32::from(month),
            i32::from(day),
            i32::from(hour),
            i32::from(minute),
            second,
        )
        .map_err(|status| format!("ERFA rejected UTC fields (status {status})"))?;
        if warning != 0 {
            log::warn!("ERFA UTC conversion warning {warning} for {year:04}-{month:02}-{day:02}");
        }
        Ok(Self {
            jd1,
            jd2,
            scale: TimeScale::Utc,
        })
    }

    pub fn from_fits_utc(value: &str) -> Result<Self, String> {
        Self::from_utc_rfc3339(value).or_else(|_| Self::from_utc_rfc3339(&format!("{value}Z")))
    }

    pub fn to_tai(self) -> Result<Self, String> {
        if self.scale != TimeScale::Utc {
            return Err("UTC to TAI conversion requires a UTC input".to_string());
        }
        let ((jd1, jd2), warning) = erfars::timescales::Utctai(self.jd1, self.jd2)
            .map_err(|status| format!("ERFA UTC to TAI failed (status {status})"))?;
        if warning != 0 {
            log::warn!("ERFA leap-second table warning {warning} during UTC to TAI conversion");
        }
        Ok(Self {
            jd1,
            jd2,
            scale: TimeScale::Tai,
        })
    }

    pub fn to_tt(self) -> Result<Self, String> {
        let tai = if self.scale == TimeScale::Utc {
            self.to_tai()?
        } else {
            self
        };
        if tai.scale != TimeScale::Tai {
            return Err("TAI to TT conversion requires UTC or TAI input".to_string());
        }
        let (jd1, jd2) = erfars::timescales::Taitt(tai.jd1, tai.jd2);
        Ok(Self {
            jd1,
            jd2,
            scale: TimeScale::Tt,
        })
    }

    pub fn to_ut1(self, dut1_seconds: f64) -> Result<Self, String> {
        if self.scale != TimeScale::Utc || !dut1_seconds.is_finite() {
            return Err("UTC to UT1 requires UTC input and finite DUT1".to_string());
        }
        let ((jd1, jd2), warning) = erfars::timescales::Utcut1(self.jd1, self.jd2, dut1_seconds)
            .map_err(|status| format!("ERFA UTC to UT1 failed (status {status})"))?;
        if warning != 0 {
            log::warn!("ERFA UTC to UT1 warning {warning}");
        }
        Ok(Self {
            jd1,
            jd2,
            scale: TimeScale::Ut1,
        })
    }

    pub fn midpoint(self, exposure_seconds: f64) -> Self {
        let jd2 = self.jd2 + exposure_seconds / 172_800.0;
        let carry = jd2.floor();
        Self {
            jd1: self.jd1 + carry,
            jd2: jd2 - carry,
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
        assert!((time.julian_date() - 2_440_587.5).abs() < 1e-9);
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

    #[test]
    fn erfa_handles_leap_second_and_timescale_chain() {
        let utc = AstroTime::from_utc_components(2016, 12, 31, 23, 59, 60.0).unwrap();
        let tai = utc.to_tai().unwrap();
        let tt = tai.to_tt().unwrap();
        let tt_minus_tai_seconds = ((tt.jd1 - tai.jd1) + (tt.jd2 - tai.jd2)) * 86_400.0;
        assert!((tt_minus_tai_seconds - 32.184).abs() < 1.0e-9);
    }
}
