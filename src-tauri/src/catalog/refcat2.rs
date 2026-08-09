use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
const ENDPOINT: &str = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync";
const TABLE: &str = "J/ApJ/867/105/refcat2";
#[derive(Debug, Clone, Deserialize)]
pub struct Refcat2Query {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub radius_deg: f64,
    pub max_rows: Option<u32>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Refcat2Star {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub gaia_g_mag: Option<f64>,
    pub gaia_g_error: Option<f64>,
    pub g_mag: Option<f64>,
    pub g_error: Option<f64>,
    pub r_mag: Option<f64>,
    pub r_error: Option<f64>,
    pub i_mag: Option<f64>,
    pub i_error: Option<f64>,
    pub z_mag: Option<f64>,
    pub z_error: Option<f64>,
    pub duplicate_variable: Option<i64>,
    pub isolation_1mag_arcsec: Option<f64>,
    pub isolation_10mag_arcsec: Option<f64>,
}

#[derive(Debug, Clone, Copy)]
pub struct Refcat2BandMapping {
    pub key: &'static str,
    pub label: &'static str,
    pub magnitude_column: &'static str,
    pub error_column: &'static str,
}

pub const REFCAT2_BAND_MAPPINGS: [Refcat2BandMapping; 5] = [
    Refcat2BandMapping {
        key: "G",
        label: "G (Gaia)",
        magnitude_column: "Gmag",
        error_column: "e_Gmag",
    },
    Refcat2BandMapping {
        key: "g",
        label: "g (Pan-STARRS)",
        magnitude_column: "gmag",
        error_column: "e_gmag",
    },
    Refcat2BandMapping {
        key: "r",
        label: "r (Pan-STARRS)",
        magnitude_column: "rmag",
        error_column: "e_rmag",
    },
    Refcat2BandMapping {
        key: "i",
        label: "i (Pan-STARRS)",
        magnitude_column: "imag",
        error_column: "e_imag",
    },
    Refcat2BandMapping {
        key: "z",
        label: "z (Pan-STARRS)",
        magnitude_column: "zmag",
        error_column: "e_zmag",
    },
];

pub fn band_values(star: &Refcat2Star, key: &str) -> Option<(Option<f64>, Option<f64>)> {
    match key {
        "G" => Some((star.gaia_g_mag, star.gaia_g_error)),
        "g" => Some((star.g_mag, star.g_error)),
        "r" => Some((star.r_mag, star.r_error)),
        "i" => Some((star.i_mag, star.i_error)),
        "z" => Some((star.z_mag, star.z_error)),
        _ => None,
    }
}

/// REFCAT2's `dupvar` value 2 means that Gaia did not publish a
/// variability classification. It is not a rejection flag. Values 1, 5 and
/// 6 identify variables or duplicate sources and must not be used as
/// photometric references.
pub fn usable_dupvar(flag: Option<i64>) -> bool {
    matches!(flag, Some(0 | 2))
}
#[derive(Debug, Clone, Serialize)]
pub struct Refcat2Result {
    pub catalog: String,
    pub stars: Vec<Refcat2Star>,
    pub response_sha256: String,
    pub adql: String,
}
#[derive(Clone, Default)]
pub struct Refcat2Client {
    http: reqwest::Client,
}
impl Refcat2Client {
    pub async fn query(&self, q: Refcat2Query) -> Result<Refcat2Result, String> {
        if !(0.0..360.0).contains(&q.ra_deg)
            || !(-90.0..=90.0).contains(&q.dec_deg)
            || !(0.0..=2.0).contains(&q.radius_deg)
        {
            return Err("invalid REFCAT2 cone".into());
        }
        let max = q.max_rows.unwrap_or(20_000).min(50_000);
        let adql = build_adql(&q, max);
        let form = [
            ("REQUEST", "doQuery"),
            ("LANG", "ADQL"),
            ("FORMAT", "json"),
            ("QUERY", adql.as_str()),
        ];
        let res = self
            .http
            .post(ENDPOINT)
            .timeout(Duration::from_secs(45))
            .form(&form)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let body = res.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "VizieR HTTP {status}: {}",
                tap_error_message(&body)
            ));
        }
        let stars = parse(&body)?;
        Ok(Refcat2Result {
            catalog: "ATLAS2".into(),
            stars,
            response_sha256: hex::encode(Sha256::digest(body.as_bytes())),
            adql,
        })
    }
}

fn build_adql(q: &Refcat2Query, max: u32) -> String {
    // TAPVizieR uses RA_ICRS/DE_ICRS rather than the fixed-width ReadMe
    // labels RAdeg/DEdeg. Quotes are also required to distinguish the Gaia
    // Gmag column from the Pan-STARRS gmag column.
    format!("SELECT TOP {max} \"RA_ICRS\",\"DE_ICRS\",\"Gmag\",\"e_Gmag\",\"gmag\",\"e_gmag\",\"rmag\",\"e_rmag\",\"imag\",\"e_imag\",\"zmag\",\"e_zmag\",\"dupvar\",\"r1\",\"r10\" FROM \"{TABLE}\" WHERE 1=CONTAINS(POINT('ICRS',\"RA_ICRS\",\"DE_ICRS\"),CIRCLE('ICRS',{:.10},{:.10},{:.10}))",q.ra_deg,q.dec_deg,q.radius_deg)
}

fn tap_error_message(body: &str) -> String {
    let marker = "value=\"ERROR\">";
    if let Some(start) = body.find(marker) {
        let message = &body[start + marker.len()..];
        if let Some(end) = message.find("</INFO>") {
            return message[..end]
                .replace("&quot;", "\"")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .trim()
                .to_string();
        }
    }
    body.split_whitespace()
        .take(40)
        .collect::<Vec<_>>()
        .join(" ")
}
#[derive(Deserialize)]
struct Tap {
    metadata: Vec<Col>,
    data: Vec<Vec<Value>>,
}
#[derive(Deserialize)]
struct Col {
    name: String,
}
fn parse(body: &str) -> Result<Vec<Refcat2Star>, String> {
    let t: Tap = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let col_exact = |n: &str| t.metadata.iter().position(|c| c.name == n);
    let col = |n: &str| {
        t.metadata
            .iter()
            .position(|c| c.name.eq_ignore_ascii_case(n))
    };
    let req = |n: &str| col(n).ok_or_else(|| format!("REFCAT2 missing {n}"));
    let ra = req("RA_ICRS")?;
    let de = req("DE_ICRS")?;
    let v =
        |row: &Vec<Value>, idx: Option<usize>| idx.and_then(|i| row.get(i)).and_then(Value::as_f64);
    t.data
        .iter()
        .map(|r| {
            Ok(Refcat2Star {
                ra_deg: v(r, Some(ra)).ok_or("bad RA")?,
                dec_deg: v(r, Some(de)).ok_or("bad Dec")?,
                gaia_g_mag: v(r, col_exact("Gmag")),
                gaia_g_error: v(r, col_exact("e_Gmag")),
                g_mag: v(r, col_exact("gmag")),
                g_error: v(r, col_exact("e_gmag")),
                r_mag: v(r, col("rmag")),
                r_error: v(r, col("e_rmag")),
                i_mag: v(r, col("imag")),
                i_error: v(r, col("e_imag")),
                z_mag: v(r, col("zmag")),
                z_error: v(r, col("e_zmag")),
                duplicate_variable: col("dupvar").and_then(|i| r.get(i)).and_then(Value::as_i64),
                isolation_1mag_arcsec: v(r, col("r1")),
                isolation_10mag_arcsec: v(r, col("r10")),
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct PhotometricSolution {
    pub band: String,
    pub zero_point: f64,
    pub color_term: Option<f64>,
    pub rms_mag: f64,
    pub reference_stars: usize,
    pub accepted: bool,
    pub reason: String,
}
pub fn robust_fit(samples: &[(f64, f64, f64)], band: &str) -> Result<PhotometricSolution, String> {
    robust_fit_with_options(samples, band, true, 8, 0.70)
}
pub fn robust_fit_with_options(
    samples: &[(f64, f64, f64)],
    band: &str,
    fit_color_term: bool,
    minimum_stars: usize,
    maximum_residual_mag: f64,
) -> Result<PhotometricSolution, String> {
    if samples.len() < 3 {
        return Err("not enough reference stars".into());
    }
    let use_color = fit_color_term
        && samples.len() >= 8
        && samples
            .iter()
            .map(|x| x.2)
            .fold(f64::INFINITY, f64::min)
            .is_finite()
        && samples
            .iter()
            .map(|x| x.2)
            .fold(f64::NEG_INFINITY, f64::max)
            - samples.iter().map(|x| x.2).fold(f64::INFINITY, f64::min)
            >= 0.5;
    let mut keep = vec![true; samples.len()];
    let mut zp = 0.;
    let mut c = 0.;
    for _ in 0..4 {
        let used: Vec<_> = samples
            .iter()
            .zip(&keep)
            .filter(|(_, k)| **k)
            .map(|(s, _)| *s)
            .collect();
        if used.len() < 3 {
            break;
        }
        if use_color {
            let n = used.len() as f64;
            let sx = used.iter().map(|x| x.2).sum::<f64>();
            let sy = used.iter().map(|x| x.0 - x.1).sum::<f64>();
            let sxx = used.iter().map(|x| x.2 * x.2).sum::<f64>();
            let sxy = used.iter().map(|x| x.2 * (x.0 - x.1)).sum::<f64>();
            c = (n * sxy - sx * sy) / (n * sxx - sx * sx).max(1e-12);
            zp = (sy - c * sx) / n;
        } else {
            zp = median(used.iter().map(|x| x.0 - x.1).collect());
        }
        let mut res: Vec<f64> = samples.iter().map(|x| x.0 - x.1 - zp - c * x.2).collect();
        let mad = median(res.iter().map(|x| x.abs()).collect()).max(0.005);
        let cutoff = (3.0 * 1.4826 * mad).min(maximum_residual_mag.max(0.01));
        for (i, r) in res.drain(..).enumerate() {
            keep[i] = r.abs() <= cutoff;
        }
    }
    let residuals: Vec<f64> = samples
        .iter()
        .zip(&keep)
        .filter(|(_, k)| **k)
        .map(|(x, _)| x.0 - x.1 - zp - c * x.2)
        .collect();
    let rms = (residuals.iter().map(|x| x * x).sum::<f64>() / residuals.len().max(1) as f64).sqrt();
    let n = residuals.len();
    Ok(PhotometricSolution {
        band: band.into(),
        zero_point: zp,
        color_term: use_color.then_some(c),
        rms_mag: rms,
        reference_stars: n,
        accepted: n >= minimum_stars,
        reason: if n >= minimum_stars {
            "accepted"
        } else {
            "fewer than the configured minimum usable reference stars"
        }
        .into(),
    })
}
fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fits_zp() {
        let s: Vec<_> = (0..12)
            .map(|i| {
                (
                    15.0 + i as f64 * 0.1,
                    -10.0 + i as f64 * 0.1,
                    i as f64 * 0.08,
                )
            })
            .collect();
        let x = robust_fit(&s, "r").unwrap();
        assert!((x.zero_point - 25.0).abs() < 1e-8);
        assert!(x.accepted);
    }

    #[test]
    fn keeps_gaia_uppercase_g_separate_from_panstarrs_lowercase_g() {
        let body = r#"{
          "metadata":[{"name":"RA_ICRS"},{"name":"DE_ICRS"},{"name":"Gmag"},{"name":"e_Gmag"},{"name":"gmag"},{"name":"e_gmag"}],
          "data":[[12.0,-3.0,16.1,0.01,16.7,0.02]]
        }"#;
        let stars = parse(body).unwrap();
        assert_eq!(stars[0].gaia_g_mag, Some(16.1));
        assert_eq!(stars[0].g_mag, Some(16.7));
    }

    #[test]
    fn accepts_unclassified_gaia_sources_but_rejects_variables_and_duplicates() {
        assert!(usable_dupvar(Some(0)));
        assert!(usable_dupvar(Some(2)));
        assert!(!usable_dupvar(Some(1)));
        assert!(!usable_dupvar(Some(5)));
        assert!(!usable_dupvar(Some(6)));
        assert!(!usable_dupvar(None));
    }

    #[test]
    fn tap_query_uses_real_quoted_vizier_columns() {
        let query = build_adql(
            &Refcat2Query {
                ra_deg: 3.05,
                dec_deg: -10.78,
                radius_deg: 0.1,
                max_rows: None,
            },
            100,
        );
        assert!(query.contains("\"RA_ICRS\",\"DE_ICRS\""));
        assert!(query.contains("\"Gmag\",\"e_Gmag\",\"gmag\",\"e_gmag\""));
        assert!(!query.contains("RAdeg"));
    }
}
