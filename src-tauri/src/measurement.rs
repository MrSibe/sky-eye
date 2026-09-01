use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMeasurement {
    pub id: String,
    pub frame_index: usize,
    pub frame_path: String,
    pub wcs_run_id: Option<String>,
    pub midpoint_utc: Option<String>,
    pub midpoint_jd: Option<f64>,
    pub x: f64,
    pub y: f64,
    pub ra_deg: Option<f64>,
    pub dec_deg: Option<f64>,
    pub ra_uncertainty_arcsec: Option<f64>,
    pub dec_uncertainty_arcsec: Option<f64>,
    pub flux: f64,
    pub flux_error: f64,
    pub snr: Option<f64>,
    pub fwhm_px: Option<f64>,
    pub ellipticity: Option<f64>,
    pub aperture_radius_px: f64,
    pub flags: Vec<String>,
    pub magnitude: Option<f64>,
    pub magnitude_error: Option<f64>,
    pub band: Option<String>,
    pub photometric_catalog: Option<String>,
    pub designation: String,
    pub match_status: MatchStatus,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub stale_reason: Option<String>,
    pub provenance: serde_json::Value,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchStatus {
    Unmatched,
    NoLocalMatch,
    Probable,
    Ambiguous,
    Confirmed,
}
#[derive(Debug, Deserialize)]
pub struct MeasureTargetRequest {
    pub frame_index: usize,
    pub x: f64,
    pub y: f64,
}

pub fn normalize_tracklet_designation(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("请填写可疑目标名称（MPC trkSub）".into());
    }
    if value.len() > 7 {
        return Err("MPC trkSub 最多 7 个字符".into());
    }
    if !value.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("MPC trkSub 只能包含 ASCII 字母和数字，不能包含空格或符号".into());
    }

    let upper = value.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    let all_digits = bytes.iter().all(u8::is_ascii_digit);
    let packed_number = bytes.len() == 5
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..].iter().all(u8::is_ascii_digit);
    let packed_provisional = bytes.len() == 7
        && matches!(bytes[0], b'I'..=b'L')
        && bytes[1].is_ascii_digit()
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_alphabetic()
        && bytes[4].is_ascii_alphanumeric()
        && bytes[5].is_ascii_digit()
        && bytes[6].is_ascii_alphabetic();
    let unpacked_provisional = matches!(bytes.len(), 6 | 7)
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4].is_ascii_alphabetic()
        && bytes[5].is_ascii_alphabetic()
        && bytes[6..].iter().all(u8::is_ascii_digit);
    if all_digits || packed_number || packed_provisional || unpacked_provisional {
        return Err("trkSub 不能使用或仿照 MPC 的永久编号、临时编号或 packed designation".into());
    }
    Ok(value.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackletPoint {
    pub measurement_id: String,
    pub jd_utc: f64,
    pub ra_deg: f64,
    pub dec_deg: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct CandidateMatch {
    pub designation: String,
    pub residuals_arcsec: Vec<f64>,
    pub max_residual_arcsec: f64,
    pub mean_speed_arcsec_min: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct TrackletMatchResult {
    pub status: MatchStatus,
    pub candidates: Vec<CandidateMatch>,
    pub reason: String,
    pub database_sha256: String,
    pub database_stale: bool,
}

#[cfg(test)]
mod tests {
    use super::normalize_tracklet_designation;

    #[test]
    fn accepts_observer_assigned_tracklet_names() {
        assert_eq!(
            normalize_tracklet_designation("  P21Eetc ").as_deref(),
            Ok("P21Eetc")
        );
        assert_eq!(
            normalize_tracklet_designation("SKY001").as_deref(),
            Ok("SKY001")
        );
        assert_eq!(normalize_tracklet_designation("X").as_deref(), Ok("X"));
    }

    #[test]
    fn rejects_missing_non_ascii_and_overlong_tracklet_names() {
        assert!(normalize_tracklet_designation("").is_err());
        assert!(normalize_tracklet_designation("SKY 01").is_err());
        assert!(normalize_tracklet_designation("目标1").is_err());
        assert!(normalize_tracklet_designation("SKYEYE01").is_err());
    }

    #[test]
    fn rejects_mpc_designation_shapes() {
        for value in [
            "1", "00001", "620127", "~0023", "K23A00B", "2023AB", "2023AB1",
        ] {
            assert!(normalize_tracklet_designation(value).is_err(), "{value}");
        }
    }
}
