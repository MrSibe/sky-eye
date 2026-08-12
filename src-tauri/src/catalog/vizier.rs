use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const VIZIER_TAP_SYNC: &str = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync";
const GAIA_DR3_TABLE: &str = "I/355/gaiadr3";
// TAPVizieR exposes very large catalogues through a dedicated schema. The
// unqualified legacy table identifier is no longer resolved by the service.
const GAIA_DR3_TAP_SCHEMA: &str = "large_tables";
const GAIA_REFERENCE_EPOCH: f64 = 2016.0;
const J2000_JD: f64 = 2_451_545.0;

#[derive(Debug, Clone, Deserialize)]
pub struct GaiaQuery {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub radius_deg: f64,
    pub observation_jd: Option<f64>,
    pub max_rows: Option<u32>,
}

impl GaiaQuery {
    fn validate(&self) -> Result<(), CatalogError> {
        if !self.ra_deg.is_finite() || !(0.0..360.0).contains(&self.ra_deg) {
            return Err(CatalogError::InvalidQuery("RA must be in [0, 360) degrees"));
        }
        if !self.dec_deg.is_finite() || !(-90.0..=90.0).contains(&self.dec_deg) {
            return Err(CatalogError::InvalidQuery(
                "Dec must be in [-90, 90] degrees",
            ));
        }
        if !self.radius_deg.is_finite()
            || !(0.0..=2.0).contains(&self.radius_deg)
            || self.radius_deg == 0.0
        {
            return Err(CatalogError::InvalidQuery(
                "cone radius must be in (0, 2] degrees",
            ));
        }
        if self.max_rows.unwrap_or(5_000) == 0 || self.max_rows.unwrap_or(5_000) > 50_000 {
            return Err(CatalogError::InvalidQuery("max_rows must be in [1, 50000]"));
        }
        if self.observation_jd.is_some_and(|jd| !jd.is_finite()) {
            return Err(CatalogError::InvalidQuery("observation JD must be finite"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GaiaSource {
    /// String is intentional: Gaia DR3 identifiers exceed JavaScript's exact
    /// integer range and would lose precision when serialized as JSON numbers.
    pub source_id: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub catalog_ra_deg: f64,
    pub catalog_dec_deg: f64,
    pub pm_ra_mas_per_year: Option<f64>,
    pub pm_dec_mas_per_year: Option<f64>,
    pub ra_error_mas: Option<f64>,
    pub dec_error_mas: Option<f64>,
    pub pm_ra_error_mas_per_year: Option<f64>,
    pub pm_dec_error_mas_per_year: Option<f64>,
    pub ra_dec_correlation: Option<f64>,
    pub parallax_mas: Option<f64>,
    pub parallax_error_mas: Option<f64>,
    pub ruwe: Option<f64>,
    pub duplicated_source: bool,
    pub astrometric_params_solved: Option<i64>,
    pub propagated_ra_error_mas: Option<f64>,
    pub propagated_dec_error_mas: Option<f64>,
    pub g_mag: Option<f32>,
    pub epoch_year: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GaiaQueryResult {
    pub catalog: &'static str,
    pub endpoint: &'static str,
    pub query: GaiaQuerySummary,
    pub sources: Vec<GaiaSource>,
    pub cached: bool,
    pub adql: String,
    pub response_sha256: String,
    pub queried_unix: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GaiaQuerySummary {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub radius_deg: f64,
    pub epoch_year: f64,
    pub max_rows: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("invalid Gaia query: {0}")]
    InvalidQuery(&'static str),
    #[error("VizieR TAP request failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("VizieR TAP returned HTTP {status}: {preview}")]
    HttpStatus { status: u16, preview: String },
    #[error("VizieR TAP request was cancelled")]
    Cancelled,
    #[error("VizieR TAP JSON is missing required Gaia column {0}")]
    MissingColumn(&'static str),
    #[error("invalid VizieR TAP row {row}: {reason}")]
    InvalidRow { row: usize, reason: String },
    #[error("invalid VizieR TAP JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CacheKey {
    ra_microdeg: i64,
    dec_microdeg: i64,
    radius_microdeg: i64,
    epoch_milliyear: i64,
    max_rows: u32,
}

impl CacheKey {
    fn new(query: &GaiaQuery) -> Self {
        let epoch = observation_epoch(query.observation_jd);
        Self {
            ra_microdeg: (query.ra_deg * 1_000_000.0).round() as i64,
            dec_microdeg: (query.dec_deg * 1_000_000.0).round() as i64,
            radius_microdeg: (query.radius_deg * 1_000_000.0).round() as i64,
            epoch_milliyear: (epoch * 1_000.0).round() as i64,
            max_rows: query.max_rows.unwrap_or(5_000),
        }
    }
}

#[derive(Clone)]
pub struct VizierClient {
    http: reqwest::Client,
    cache: Arc<Mutex<HashMap<CacheKey, GaiaQueryResult>>>,
}

impl Default for VizierClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::new(),
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl VizierClient {
    pub async fn query_gaia(
        &self,
        query: GaiaQuery,
        cancellation: CancellationToken,
    ) -> Result<GaiaQueryResult, CatalogError> {
        query.validate()?;
        let key = CacheKey::new(&query);
        if let Some(mut result) = self.cache.lock().await.get(&key).cloned() {
            result.cached = true;
            return Ok(result);
        }

        let max_rows = query.max_rows.unwrap_or(5_000);
        let adql = build_gaia_adql(&query, max_rows);
        let rows = [
            ("REQUEST", "doQuery"),
            ("LANG", "ADQL"),
            ("FORMAT", "json"),
            ("QUERY", adql.as_str()),
        ];
        let request = self
            .http
            .post(VIZIER_TAP_SYNC)
            .timeout(Duration::from_secs(30))
            .form(&rows)
            .send();

        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(CatalogError::Cancelled),
            response = request => response?,
        };
        let status = response.status();
        let response_url = response.url().to_string();
        let body = tokio::select! {
            _ = cancellation.cancelled() => return Err(CatalogError::Cancelled),
            body = response.text() => body?,
        };
        debug_vizier_response(&response_url, status.as_u16(), &adql, &body);
        if !status.is_success() {
            return Err(CatalogError::HttpStatus {
                status: status.as_u16(),
                preview: response_preview(&body, 512),
            });
        }

        let epoch_year = observation_epoch(query.observation_jd);
        let sources = parse_gaia_json(&body, epoch_year).map_err(|error| {
            log::error!(
                "[sky-eye][VizieR TAP] parse failed: {error}\n[sky-eye][VizieR TAP] response preview:\n{}",
                response_preview(&body, 16 * 1024)
            );
            error
        })?;
        let result = GaiaQueryResult {
            catalog: GAIA_DR3_TABLE,
            endpoint: VIZIER_TAP_SYNC,
            query: GaiaQuerySummary {
                ra_deg: query.ra_deg,
                dec_deg: query.dec_deg,
                radius_deg: query.radius_deg,
                epoch_year,
                max_rows,
            },
            sources,
            cached: false,
            adql,
            response_sha256: hex::encode(Sha256::digest(body.as_bytes())),
            queried_unix: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        self.cache.lock().await.insert(key, result.clone());
        Ok(result)
    }
}

fn build_gaia_adql(query: &GaiaQuery, max_rows: u32) -> String {
    format!(
        "SELECT TOP {max_rows} Source, RA_ICRS, DE_ICRS, e_RA_ICRS, e_DE_ICRS, \
         pmRA, pmDE, e_pmRA, e_pmDE, RADEcor, Plx, e_Plx, RUWE, Dup, Solved, Gmag \
         FROM \"{GAIA_DR3_TAP_SCHEMA}\".\"{GAIA_DR3_TABLE}\" \
         WHERE Gmag IS NOT NULL AND 1=CONTAINS(POINT('ICRS', RA_ICRS, DE_ICRS), \
         CIRCLE('ICRS', {:.10}, {:.10}, {:.10})) ORDER BY Gmag ASC",
        query.ra_deg, query.dec_deg, query.radius_deg
    )
}

fn observation_epoch(jd: Option<f64>) -> f64 {
    jd.map_or(GAIA_REFERENCE_EPOCH, |value| {
        2000.0 + (value - J2000_JD) / 365.25
    })
}

#[derive(Debug, Deserialize)]
struct TapJson {
    metadata: Vec<TapColumn>,
    data: Vec<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
struct TapColumn {
    name: String,
}

fn parse_gaia_json(body: &str, epoch_year: f64) -> Result<Vec<GaiaSource>, CatalogError> {
    let response: TapJson = serde_json::from_str(body)?;
    let column = |name: &'static str| {
        response
            .metadata
            .iter()
            .position(|column| column.name.eq_ignore_ascii_case(name))
            .ok_or(CatalogError::MissingColumn(name))
    };
    let optional_column = |name: &str| {
        response
            .metadata
            .iter()
            .position(|column| column.name.eq_ignore_ascii_case(name))
    };
    let source_column = column("Source")?;
    let ra_column = column("RA_ICRS")?;
    let dec_column = column("DE_ICRS")?;
    let pm_ra_column = column("pmRA")?;
    let pm_dec_column = column("pmDE")?;
    let g_column = column("Gmag")?;
    let ra_error_column = optional_column("e_RA_ICRS");
    let dec_error_column = optional_column("e_DE_ICRS");
    let pm_ra_error_column = optional_column("e_pmRA");
    let pm_dec_error_column = optional_column("e_pmDE");
    let ra_dec_corr_column = optional_column("RADEcor");
    let parallax_column = optional_column("Plx");
    let parallax_error_column = optional_column("e_Plx");
    let ruwe_column = optional_column("RUWE");
    let duplicated_column = optional_column("Dup");
    let solved_column = optional_column("Solved");

    response
        .data
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let value = |column: usize| row.get(column).unwrap_or(&Value::Null);
            let required_f64 = |name: &str, column: usize| {
                value(column)
                    .as_f64()
                    .ok_or_else(|| CatalogError::InvalidRow {
                        row: index + 1,
                        reason: format!("{name} is not a number"),
                    })
            };
            let source_id = match value(source_column) {
                Value::Number(number) => number.to_string(),
                Value::String(text) if !text.is_empty() => text.clone(),
                _ => {
                    return Err(CatalogError::InvalidRow {
                        row: index + 1,
                        reason: "Source is not an integer or string".to_string(),
                    });
                }
            };
            let catalog_ra = required_f64("RA_ICRS", ra_column)?;
            let catalog_dec = required_f64("DE_ICRS", dec_column)?;
            let pm_ra = value(pm_ra_column).as_f64();
            let pm_dec = value(pm_dec_column).as_f64();
            let optional_f64 =
                |column: Option<usize>| column.and_then(|column| value(column).as_f64());
            let ra_error = optional_f64(ra_error_column);
            let dec_error = optional_f64(dec_error_column);
            let pm_ra_error = optional_f64(pm_ra_error_column);
            let pm_dec_error = optional_f64(pm_dec_error_column);
            let (ra_deg, dec_deg) =
                propagate_position(catalog_ra, catalog_dec, pm_ra, pm_dec, epoch_year);
            let years = epoch_year - GAIA_REFERENCE_EPOCH;
            let propagated_ra_error_mas =
                ra_error.map(|error| error.hypot(pm_ra_error.unwrap_or(0.0) * years.abs()));
            let propagated_dec_error_mas =
                dec_error.map(|error| error.hypot(pm_dec_error.unwrap_or(0.0) * years.abs()));
            Ok(GaiaSource {
                source_id,
                ra_deg,
                dec_deg,
                catalog_ra_deg: catalog_ra,
                catalog_dec_deg: catalog_dec,
                pm_ra_mas_per_year: pm_ra,
                pm_dec_mas_per_year: pm_dec,
                ra_error_mas: ra_error,
                dec_error_mas: dec_error,
                pm_ra_error_mas_per_year: pm_ra_error,
                pm_dec_error_mas_per_year: pm_dec_error,
                ra_dec_correlation: optional_f64(ra_dec_corr_column),
                parallax_mas: optional_f64(parallax_column),
                parallax_error_mas: optional_f64(parallax_error_column),
                ruwe: optional_f64(ruwe_column),
                duplicated_source: duplicated_column
                    .and_then(|column| value(column).as_bool())
                    .unwrap_or(false),
                astrometric_params_solved: solved_column.and_then(|column| value(column).as_i64()),
                propagated_ra_error_mas,
                propagated_dec_error_mas,
                g_mag: value(g_column).as_f64().map(|value| value as f32),
                epoch_year,
            })
        })
        .collect()
}

fn propagate_position(
    ra_deg: f64,
    dec_deg: f64,
    pm_ra: Option<f64>,
    pm_dec: Option<f64>,
    epoch_year: f64,
) -> (f64, f64) {
    let years = epoch_year - GAIA_REFERENCE_EPOCH;
    let ra = ra_deg.to_radians();
    let dec = dec_deg.to_radians();
    let direction = [dec.cos() * ra.cos(), dec.cos() * ra.sin(), dec.sin()];
    let p = [-ra.sin(), ra.cos(), 0.0];
    let q = [-dec.sin() * ra.cos(), -dec.sin() * ra.sin(), dec.cos()];
    let mas_to_rad = std::f64::consts::PI / (180.0 * 3_600_000.0);
    let delta_ra = pm_ra.unwrap_or(0.0) * years * mas_to_rad;
    let delta_dec = pm_dec.unwrap_or(0.0) * years * mas_to_rad;
    let mut propagated = [
        direction[0] + p[0] * delta_ra + q[0] * delta_dec,
        direction[1] + p[1] * delta_ra + q[1] * delta_dec,
        direction[2] + p[2] * delta_ra + q[2] * delta_dec,
    ];
    let norm = (propagated[0].powi(2) + propagated[1].powi(2) + propagated[2].powi(2)).sqrt();
    propagated
        .iter_mut()
        .for_each(|component| *component /= norm);
    let propagated_ra = propagated[1]
        .atan2(propagated[0])
        .to_degrees()
        .rem_euclid(360.0);
    let propagated_dec = propagated[2].asin().to_degrees();
    (propagated_ra, propagated_dec)
}

fn response_preview(body: &str, max_chars: usize) -> String {
    let mut preview: String = body.chars().take(max_chars).collect();
    if body.chars().count() > max_chars {
        preview.push_str("\n... [truncated]");
    }
    preview
}

#[cfg(debug_assertions)]
fn debug_vizier_response(url: &str, status: u16, adql: &str, body: &str) {
    log::debug!(
        "[sky-eye][VizieR TAP] response\nURL: {url}\nHTTP: {status}\nADQL: {adql}\nBytes: {}\n--- body (first 16 KiB) ---\n{}\n--- end body ---",
        body.len(),
        response_preview(body, 16 * 1024)
    );
}

#[cfg(not(debug_assertions))]
fn debug_vizier_response(_url: &str, _status: u16, _adql: &str, _body: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "metadata": [
        {"name":"Source","datatype":"LONG"},
        {"name":"RA_ICRS","datatype":"DOUBLE","unit":"deg"},
        {"name":"DE_ICRS","datatype":"DOUBLE","unit":"deg"},
        {"name":"pmRA","datatype":"DOUBLE","unit":"mas/yr"},
        {"name":"pmDE","datatype":"DOUBLE","unit":"mas/yr"},
        {"name":"Gmag","datatype":"DOUBLE","unit":"mag"}
      ],
      "data": [
        [2427494801073181184,3.021862006,-11.45276601287,-0.825,-28.487,18.322544],
        [987654321,11.0,21.0,null,null,15.1]
      ]
    }"#;

    #[test]
    fn parses_tap_json_without_losing_source_id_precision() {
        let sources = parse_gaia_json(SAMPLE, 2026.0).unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].source_id, "2427494801073181184");
        assert_ne!(sources[0].ra_deg, sources[0].catalog_ra_deg);
        assert!((sources[1].ra_deg - sources[1].catalog_ra_deg).abs() < 1.0e-12);
    }

    #[test]
    fn builds_bounded_adql_cone_query() {
        let query = GaiaQuery {
            ra_deg: 3.05999,
            dec_deg: -11.370018,
            radius_deg: 0.5,
            observation_jd: None,
            max_rows: Some(10_000),
        };
        let adql = build_gaia_adql(&query, 10_000);
        assert!(adql.contains("TOP 10000"));
        assert!(adql.contains("FROM \"large_tables\".\"I/355/gaiadr3\""));
        assert!(adql.contains("CIRCLE('ICRS', 3.0599900000, -11.3700180000, 0.5000000000)"));
    }

    #[test]
    fn rejects_unsafe_cone_sizes() {
        let query = GaiaQuery {
            ra_deg: 1.0,
            dec_deg: 2.0,
            radius_deg: 5.0,
            observation_jd: None,
            max_rows: None,
        };
        assert!(matches!(
            query.validate(),
            Err(CatalogError::InvalidQuery(_))
        ));
    }
}
