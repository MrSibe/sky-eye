use crate::mpcorb::OrbitRecord;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

const C_AU_PER_DAY: f64 = 173.144_632_684_669_3;
const AU_METERS: f64 = 149_597_870_700.0;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Observatory {
    pub longitude_deg_east: f64,
    pub latitude_deg: f64,
    pub altitude_m: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EphemerisPoint {
    pub designation: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub rate_ra_arcsec_min: f64,
    pub rate_dec_arcsec_min: f64,
    pub angular_speed_arcsec_min: f64,
    pub heliocentric_distance_au: f64,
    pub observer_distance_au: f64,
    pub predicted_mag: Option<f64>,
    pub quality: PropagationQuality,
    pub epoch_offset_days: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PropagationQuality {
    Current,
    Approximate,
}

pub fn propagate(
    record: &OrbitRecord,
    jd_utc: f64,
    station: Option<Observatory>,
) -> Result<EphemerisPoint, String> {
    let jd_tt = jd_utc + 69.184 / 86400.0;
    let (ra, dec, r, delta, mag) = position(record, jd_utc, jd_tt, station)?;
    let dt = 30.0 / 86400.0;
    let (ra0, dec0, _, _, _) = position(record, jd_utc - dt, jd_tt - dt, station)?;
    let (ra1, dec1, _, _, _) = position(record, jd_utc + dt, jd_tt + dt, station)?;
    let dra = wrap_deg(ra1 - ra0) * dec.to_radians().cos() * 3600.0;
    let ddec = (dec1 - dec0) * 3600.0;
    let rate_ra = dra;
    let rate_dec = ddec; // endpoints span one minute
    let offset = jd_tt - record.epoch_tt_jd;
    Ok(EphemerisPoint {
        designation: record.designation.clone(),
        ra_deg: ra,
        dec_deg: dec,
        rate_ra_arcsec_min: rate_ra,
        rate_dec_arcsec_min: rate_dec,
        angular_speed_arcsec_min: rate_ra.hypot(rate_dec),
        heliocentric_distance_au: r,
        observer_distance_au: delta,
        predicted_mag: mag,
        quality: if offset.abs() <= 30.0 {
            PropagationQuality::Current
        } else {
            PropagationQuality::Approximate
        },
        epoch_offset_days: offset,
    })
}

fn position(
    record: &OrbitRecord,
    jd_utc: f64,
    jd_tt: f64,
    station: Option<Observatory>,
) -> Result<(f64, f64, f64, f64, Option<f64>), String> {
    let ((earth, _), _) = erfars::ephemerides::Epv00(2_400_000.5, jd_tt - 2_400_000.5)
        .map_err(|_| "ERFA Earth ephemeris failed")?;
    let mut light = 0.0;
    let mut helio = [0.0; 3];
    let mut geo = [0.0; 3];
    for _ in 0..3 {
        helio = heliocentric(record, jd_tt - light);
        geo = [
            helio[0] - earth[0],
            helio[1] - earth[1],
            helio[2] - earth[2],
        ];
        if let Some(s) = station {
            let o = observer_equatorial(jd_utc, s);
            for k in 0..3 {
                geo[k] -= o[k];
            }
        }
        light = norm(geo) / C_AU_PER_DAY;
    }
    let delta = norm(geo);
    let r = norm(helio);
    let ra = geo[1].atan2(geo[0]).to_degrees().rem_euclid(360.0);
    let dec = (geo[2] / delta).asin().to_degrees();
    let sun_obj = [-helio[0], -helio[1], -helio[2]];
    let obs_obj = [-geo[0], -geo[1], -geo[2]];
    let phase = (dot(sun_obj, obs_obj) / (r * delta))
        .clamp(-1.0, 1.0)
        .acos();
    let mag = record
        .h
        .map(|h| hg_mag(h, record.g.unwrap_or(0.15), r, delta, phase));
    Ok((ra, dec, r, delta, mag))
}

fn heliocentric(o: &OrbitRecord, jd: f64) -> [f64; 3] {
    let m = (o.mean_anomaly_deg + o.mean_motion_deg_day * (jd - o.epoch_tt_jd))
        .to_radians()
        .rem_euclid(2.0 * PI);
    let mut eanom = m;
    for _ in 0..12 {
        let d = (eanom - o.eccentricity * eanom.sin() - m) / (1.0 - o.eccentricity * eanom.cos());
        eanom -= d;
        if d.abs() < 1e-13 {
            break;
        }
    }
    let x = o.semimajor_axis_au * (eanom.cos() - o.eccentricity);
    let y = o.semimajor_axis_au * (1.0 - o.eccentricity * o.eccentricity).sqrt() * eanom.sin();
    let (w, n, i) = (
        o.arg_perihelion_deg.to_radians(),
        o.ascending_node_deg.to_radians(),
        o.inclination_deg.to_radians(),
    );
    let (cw, sw, cn, sn, ci, si) = (w.cos(), w.sin(), n.cos(), n.sin(), i.cos(), i.sin());
    let ecl = [
        (cn * cw - sn * sw * ci) * x + (-cn * sw - sn * cw * ci) * y,
        (sn * cw + cn * sw * ci) * x + (-sn * sw + cn * cw * ci) * y,
        sw * si * x + cw * si * y,
    ];
    let eps = 23.439_291_111_f64.to_radians();
    [
        ecl[0],
        ecl[1] * eps.cos() - ecl[2] * eps.sin(),
        ecl[1] * eps.sin() + ecl[2] * eps.cos(),
    ]
}

fn observer_equatorial(jd: f64, s: Observatory) -> [f64; 3] {
    let lat = s.latitude_deg.to_radians();
    let f = 1.0 / 298.257_223_563;
    let a = 6_378_137.0;
    let n = a / (1.0 - (2.0 * f - f * f) * lat.sin().powi(2)).sqrt();
    let x = (n + s.altitude_m) * lat.cos();
    let z = ((1.0 - f).powi(2) * n + s.altitude_m) * lat.sin();
    let t = (jd - 2_451_545.0) / 36_525.0;
    let gmst = (280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545.0) + 0.000_387_933 * t * t
        - t * t * t / 38_710_000.0
        + s.longitude_deg_east)
        .to_radians();
    [
        x * gmst.cos() / AU_METERS,
        x * gmst.sin() / AU_METERS,
        z / AU_METERS,
    ]
}
fn hg_mag(h: f64, g: f64, r: f64, d: f64, a: f64) -> f64 {
    let t = (a / 2.0).tan();
    let p1 = (-3.33 * t.powf(0.63)).exp();
    let p2 = (-1.87 * t.powf(1.22)).exp();
    h + 5.0 * (r * d).log10() - 2.5 * ((1.0 - g) * p1 + g * p2).max(1e-12).log10()
}
fn norm(v: [f64; 3]) -> f64 {
    dot(v, v).sqrt()
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn wrap_deg(v: f64) -> f64 {
    (v + 180.0).rem_euclid(360.0) - 180.0
}
pub fn angular_distance_arcsec(a_ra: f64, a_dec: f64, b_ra: f64, b_dec: f64) -> f64 {
    let (a, b, c, d) = (
        a_ra.to_radians(),
        a_dec.to_radians(),
        b_ra.to_radians(),
        b_dec.to_radians(),
    );
    (b.sin() * d.sin() + b.cos() * d.cos() * (a - c).cos())
        .clamp(-1.0, 1.0)
        .acos()
        .to_degrees()
        * 3600.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn angular_wrap() {
        assert!(angular_distance_arcsec(359.999, 0.0, 0.001, 0.0) < 8.0);
    }
}
