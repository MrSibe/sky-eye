use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Wcs {
    pub crpix1: f64,
    pub crpix2: f64,
    pub crval1: f64,
    pub crval2: f64,
    pub cd1_1: f64,
    pub cd1_2: f64,
    pub cd2_1: f64,
    pub cd2_2: f64,
    pub image_width: u32,
    pub image_height: u32,
}

#[allow(dead_code)]
impl Wcs {
    pub fn pixel_to_sky(&self, x: f64, y: f64) -> (f64, f64) {
        let dx = x - self.crpix1;
        let dy = y - self.crpix2;

        let xi = (self.cd1_1 * dx + self.cd1_2 * dy).to_radians();
        let eta = (self.cd2_1 * dx + self.cd2_2 * dy).to_radians();
        let ra0 = self.crval1.to_radians();
        let dec0 = self.crval2.to_radians();
        let denominator = dec0.cos() - eta * dec0.sin();
        let ra = ra0 + xi.atan2(denominator);
        let dec =
            (dec0.sin() + eta * dec0.cos()).atan2((denominator * denominator + xi * xi).sqrt());

        (ra.to_degrees().rem_euclid(360.0), dec.to_degrees())
    }

    pub fn sky_to_pixel(&self, ra: f64, dec: f64) -> (f64, f64) {
        let ra = ra.to_radians();
        let dec = dec.to_radians();
        let ra0 = self.crval1.to_radians();
        let dec0 = self.crval2.to_radians();
        let dra = ra - ra0;
        let projection_denominator = dec.sin() * dec0.sin() + dec.cos() * dec0.cos() * dra.cos();
        if projection_denominator <= 0.0 {
            return (f64::NAN, f64::NAN);
        }
        let xi = dec.cos() * dra.sin() / projection_denominator;
        let eta =
            (dec.sin() * dec0.cos() - dec.cos() * dec0.sin() * dra.cos()) / projection_denominator;
        let xi = xi.to_degrees();
        let eta = eta.to_degrees();

        let det = self.cd1_1 * self.cd2_2 - self.cd1_2 * self.cd2_1;
        if det.abs() < 1e-15 {
            return (f64::NAN, f64::NAN);
        }

        let inv_cd1_1 = self.cd2_2 / det;
        let inv_cd1_2 = -self.cd1_2 / det;
        let inv_cd2_1 = -self.cd2_1 / det;
        let inv_cd2_2 = self.cd1_1 / det;

        let x = self.crpix1 + inv_cd1_1 * xi + inv_cd1_2 * eta;
        let y = self.crpix2 + inv_cd2_1 * xi + inv_cd2_2 * eta;

        (x, y)
    }

    pub fn contains_sky(&self, ra: f64, dec: f64) -> bool {
        let (x, y) = self.sky_to_pixel(ra, dec);
        x >= 0.0 && x < self.image_width as f64 && y >= 0.0 && y < self.image_height as f64
    }

    pub fn pixel_scale(&self) -> f64 {
        let scale_x = (self.cd1_1.powi(2) + self.cd2_1.powi(2)).sqrt();
        let scale_y = (self.cd1_2.powi(2) + self.cd2_2.powi(2)).sqrt();
        ((scale_x + scale_y) / 2.0 * 3600.0).abs()
    }

    pub fn rotation(&self) -> f64 {
        self.cd1_1.atan2(self.cd2_1).to_degrees()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_wcs() -> Wcs {
        Wcs {
            crpix1: 1024.0,
            crpix2: 768.0,
            crval1: 359.9,
            crval2: 45.0,
            cd1_1: -0.8 / 3600.0,
            cd1_2: 0.1 / 3600.0,
            cd2_1: 0.1 / 3600.0,
            cd2_2: 0.8 / 3600.0,
            image_width: 2048,
            image_height: 1536,
        }
    }

    #[test]
    fn tan_projection_round_trips_pixels() {
        let wcs = test_wcs();
        for (x, y) in [(0.0, 0.0), (1024.0, 768.0), (1900.25, 1200.75)] {
            let (ra, dec) = wcs.pixel_to_sky(x, y);
            let (roundtrip_x, roundtrip_y) = wcs.sky_to_pixel(ra, dec);
            assert!((roundtrip_x - x).abs() < 0.05);
            assert!((roundtrip_y - y).abs() < 0.05);
        }
    }

    #[test]
    fn right_ascension_wraps_at_zero() {
        let wcs = test_wcs();
        let (ra, _) = wcs.pixel_to_sky(0.0, 768.0);
        assert!((0.0..360.0).contains(&ra));
    }
}
