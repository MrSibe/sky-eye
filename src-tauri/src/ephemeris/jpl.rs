use super::{EphemerisPoint, Observatory, PropagationQuality};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::Duration,
};

const JPL_CACHE_ENTRIES: usize = 128;

#[derive(Default)]
struct JplCache {
    values: HashMap<String, Vec<EphemerisPoint>>,
    lru: VecDeque<String>,
}

pub struct JplClient {
    http: reqwest::Client,
    cache: Mutex<JplCache>,
}

impl Default for JplClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent(concat!("SkyEye/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("JPL HTTP client"),
            cache: Mutex::new(JplCache::default()),
        }
    }
}

#[derive(Deserialize)]
struct Signature {
    version: String,
}

#[derive(Deserialize)]
struct IdentificationResponse {
    signature: Signature,
    #[serde(default)]
    fields_second: Vec<String>,
    #[serde(default)]
    data_second_pass: Vec<Vec<Value>>,
    message: Option<String>,
}

impl JplClient {
    pub async fn identify_second_pass(
        &self,
        jd_utc: f64,
        center_ra_deg: f64,
        center_dec_deg: f64,
        radius_deg: f64,
        station: Observatory,
        timeout: Duration,
    ) -> Result<Vec<EphemerisPoint>, String> {
        let cache_key = format!(
            "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
            jd_utc.to_bits(),
            center_ra_deg.to_bits(),
            center_dec_deg.to_bits(),
            radius_deg.to_bits(),
            station.latitude_deg.to_bits(),
            station.longitude_deg_east.to_bits(),
            station.altitude_m.to_bits(),
        );
        if let Some(value) = self.cache_get(&cache_key)? {
            return Ok(value);
        }
        let ra_half_width =
            (radius_deg / center_dec_deg.to_radians().cos().abs().max(0.1)).min(30.0);
        let params = vec![
            ("lat", station.latitude_deg.to_string()),
            ("lon", station.longitude_deg_east.to_string()),
            ("alt", (station.altitude_m / 1000.0).to_string()),
            ("obs-time", format!("{jd_utc:.9}")),
            ("fov-ra-center", format_ra(center_ra_deg)),
            ("fov-dec-center", format_dec(center_dec_deg)),
            ("fov-ra-hwidth", ra_half_width.to_string()),
            ("fov-dec-hwidth", radius_deg.to_string()),
            ("two-pass", "true".to_string()),
            ("suppress-first-pass", "true".to_string()),
            ("req-elem", "false".to_string()),
            ("mag-required", "false".to_string()),
        ];
        let response = self
            .http
            .get("https://ssd-api.jpl.nasa.gov/sb_ident.api")
            .query(&params)
            .timeout(timeout)
            .send()
            .await
            .map_err(|error| format!("JPL SB Identification request failed: {error}"))?;
        let status = response.status();
        let body = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "JPL SB Identification returned HTTP {status}: {body}"
            ));
        }
        let payload: IdentificationResponse = serde_json::from_str(&body)
            .map_err(|error| format!("invalid JPL response: {error}"))?;
        if payload.signature.version != "1.1" {
            return Err(format!(
                "unsupported JPL SB Identification API version {}",
                payload.signature.version
            ));
        }
        if let Some(message) = payload.message {
            return Err(format!("JPL SB Identification: {message}"));
        }
        let field = |prefix: &str| {
            payload
                .fields_second
                .iter()
                .position(|name| name.starts_with(prefix))
                .ok_or_else(|| format!("JPL response is missing field {prefix}"))
        };
        let name_index = field("Object name")?;
        let ra_index = field("Astrometric RA")?;
        let dec_index = field("Astrometric Dec")?;
        let mag_index = payload
            .fields_second
            .iter()
            .position(|name| name.starts_with("Visual magnitude"));
        let points = payload
            .data_second_pass
            .into_iter()
            .map(|row| {
                let designation = cell(&row, name_index)?.to_string();
                let ra_deg = parse_angle(cell(&row, ra_index)?, true)
                    .ok_or_else(|| format!("invalid JPL RA for {designation}"))?;
                let dec_deg = parse_angle(cell(&row, dec_index)?, false)
                    .ok_or_else(|| format!("invalid JPL Dec for {designation}"))?;
                let predicted_mag = mag_index
                    .and_then(|index| cell(&row, index).ok())
                    .and_then(|value| value.parse::<f64>().ok());
                Ok(EphemerisPoint {
                    designation,
                    ra_deg,
                    dec_deg,
                    rate_ra_arcsec_min: 0.0,
                    rate_dec_arcsec_min: 0.0,
                    angular_speed_arcsec_min: 0.0,
                    heliocentric_distance_au: None,
                    observer_distance_au: None,
                    predicted_mag,
                    quality: PropagationQuality::OnlinePrecise,
                    epoch_offset_days: None,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        self.cache_insert(cache_key, points.clone())?;
        Ok(points)
    }

    fn cache_get(&self, key: &str) -> Result<Option<Vec<EphemerisPoint>>, String> {
        let mut cache = self.cache.lock().map_err(|error| error.to_string())?;
        let value = cache.values.get(key).cloned();
        if value.is_some() {
            cache.lru.retain(|entry| entry != key);
            cache.lru.push_back(key.to_string());
        }
        Ok(value)
    }

    fn cache_insert(&self, key: String, value: Vec<EphemerisPoint>) -> Result<(), String> {
        let mut cache = self.cache.lock().map_err(|error| error.to_string())?;
        cache.values.insert(key.clone(), value);
        cache.lru.retain(|entry| entry != &key);
        cache.lru.push_back(key);
        while cache.values.len() > JPL_CACHE_ENTRIES {
            if let Some(oldest) = cache.lru.pop_front() {
                cache.values.remove(&oldest);
            }
        }
        Ok(())
    }
}

fn cell(row: &[Value], index: usize) -> Result<&str, String> {
    row.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing JPL table cell {index}"))
}

fn format_ra(degrees: f64) -> String {
    let hours = degrees.rem_euclid(360.0) / 15.0;
    let h = hours.floor();
    let minutes = (hours - h) * 60.0;
    let m = minutes.floor();
    format!("{h:02.0}-{m:02.0}-{:06.3}", (minutes - m) * 60.0)
}

fn format_dec(degrees: f64) -> String {
    let prefix = if degrees.is_sign_negative() { "M" } else { "" };
    let absolute = degrees.abs();
    let d = absolute.floor();
    let minutes = (absolute - d) * 60.0;
    let m = minutes.floor();
    format!("{prefix}{d:02.0}-{m:02.0}-{:05.2}", (minutes - m) * 60.0)
}

fn parse_angle(value: &str, hours: bool) -> Option<f64> {
    let negative = value.trim_start().starts_with(['-', 'M']);
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_digit() || character == '.' {
                character
            } else {
                ' '
            }
        })
        .collect();
    let values = cleaned
        .split_whitespace()
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if values.len() < 3 {
        return None;
    }
    let mut result = values[0] + values[1] / 60.0 + values[2] / 3600.0;
    if negative {
        result = -result;
    }
    if hours {
        result = (result * 15.0).rem_euclid(360.0);
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_jpl_angles() {
        assert!((parse_angle("10:16:58.22", true).unwrap() - 154.242_583_333).abs() < 1e-8);
        assert!((parse_angle("-10 28'34.3\"", false).unwrap() + 10.476_194_444).abs() < 1e-8);
    }
}
