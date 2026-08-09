use crate::astrometry::matcher::{AstrometricMatch, AstrometricSolution};
use crate::astrometry::quality::{
    evaluate_astrometric_quality, AstrometricQuality, ReductionStatus,
};
use crate::astrometry::wcs::Wcs;
use crate::reduction::SourceMeasurement;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PlateSolveResult {
    pub run_id: Option<String>,
    pub success: bool,
    pub status: ReductionStatus,
    pub failure_code: Option<String>,
    pub wcs: Option<Wcs>,
    pub num_matched: u32,
    pub num_catalog: u32,
    pub residual_rms: Option<f64>,
    pub backend: Option<String>,
    pub message: String,
    pub matches: Vec<AstrometricMatch>,
    pub quality: Option<AstrometricQuality>,
}

pub fn missing_hint(message: &str) -> PlateSolveResult {
    PlateSolveResult {
        run_id: None,
        success: false,
        status: ReductionStatus::Rejected,
        failure_code: Some("missing_hint".into()),
        wcs: None,
        num_matched: 0,
        num_catalog: 0,
        residual_rms: None,
        backend: None,
        message: message.to_string(),
        matches: Vec::new(),
        quality: None,
    }
}

pub fn match_failed(num_catalog: u32, message: String) -> PlateSolveResult {
    PlateSolveResult {
        run_id: None,
        success: false,
        status: ReductionStatus::Rejected,
        failure_code: Some("match_failed".into()),
        wcs: None,
        num_matched: 0,
        num_catalog,
        residual_rms: None,
        backend: Some("triangle invariants + robust TAN/CD".to_string()),
        message: format!("归算失败：{message}"),
        matches: Vec::new(),
        quality: None,
    }
}

pub fn solved(
    num_catalog: u32,
    solution: AstrometricSolution,
    sources: &[SourceMeasurement],
) -> PlateSolveResult {
    let quality = evaluate_astrometric_quality(
        &solution.matches,
        sources,
        solution.wcs.image_width,
        solution.wcs.image_height,
    );
    let accepted = quality.status == ReductionStatus::Accepted;
    let message = match quality.status {
        ReductionStatus::Accepted => format!(
            "归算通过：匹配 {} 颗参考星，RMS {:.3} arcsec，P95 {:.3} arcsec。",
            solution.matches.len(),
            quality.residual_rms_arcsec,
            quality.residual_p95_arcsec
        ),
        ReductionStatus::ReviewRequired => format!(
            "归算需要复核：匹配 {} 颗参考星，RMS {:.3} arcsec；{}",
            solution.matches.len(),
            quality.residual_rms_arcsec,
            quality.reasons.join("；")
        ),
        ReductionStatus::Rejected => format!("归算被拒绝：{}", quality.reasons.join("；")),
    };
    PlateSolveResult {
        run_id: None,
        success: accepted,
        status: quality.status,
        failure_code: (!accepted).then(|| {
            if quality.distortion_suspected {
                "distortion_suspected"
            } else {
                "quality_gate"
            }
            .into()
        }),
        wcs: Some(solution.wcs),
        num_matched: solution.matches.len() as u32,
        num_catalog,
        residual_rms: Some(solution.rms_arcsec),
        backend: Some(
            "extended Delaunay / hinted pair voting + iterative robust TAN/CD".to_string(),
        ),
        message,
        matches: solution.matches,
        quality: Some(quality),
    }
}
