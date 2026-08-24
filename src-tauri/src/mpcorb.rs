use flate2::read::GzDecoder;
use reqwest::{
    header::{ACCEPT_ENCODING, IF_MODIFIED_SINCE, IF_NONE_MATCH},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncWriteExt;

pub const MPC_DATA_PAGE: &str = "https://www.minorplanetcenter.net/data";
pub const MPCORB_URL: &str = "https://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz";
pub const PARSER_VERSION: &str = "skyeye-mpcorb-2";
const MIN_RECORD_COUNT: usize = 100_000;
const MAX_COMPRESSED_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitRecord {
    pub packed_designation: String,
    pub designation: String,
    pub h: Option<f64>,
    pub g: Option<f64>,
    pub epoch_tt_jd: f64,
    pub mean_anomaly_deg: f64,
    pub arg_perihelion_deg: f64,
    pub ascending_node_deg: f64,
    pub inclination_deg: f64,
    pub eccentricity: f64,
    pub mean_motion_deg_day: f64,
    pub semimajor_axis_au: f64,
    pub uncertainty: Option<String>,
    pub observations: Option<u32>,
    pub oppositions: Option<u32>,
    pub arc: Option<String>,
    pub rms_arcsec: Option<f64>,
    pub neo: bool,
    pub pha: bool,
    pub last_observation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MpcorbManifest {
    pub source_page: String,
    pub download_url: String,
    pub downloaded_unix: u64,
    pub sha256: String,
    pub compressed_file: String,
    pub index_file: String,
    pub record_count: usize,
    pub parser_version: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredIndex {
    parser_version: String,
    source_sha256: String,
    records: Vec<OrbitRecord>,
}

impl MpcorbManifest {
    pub fn age_seconds(&self) -> u64 {
        now_unix().saturating_sub(self.downloaded_unix)
    }
    pub fn stale(&self) -> bool {
        self.age_seconds() > 86_400
    }
    pub fn too_stale_for_no_match(&self) -> bool {
        self.age_seconds() > 7 * 86_400
    }
}

pub fn parse_mpcorb(text: &str) -> Result<Vec<OrbitRecord>, String> {
    parse_mpcorb_reader(Cursor::new(text.as_bytes()))
}

fn parse_mpcorb_reader<R: BufRead>(reader: R) -> Result<Vec<OrbitRecord>, String> {
    let mut records = Vec::new();
    let mut in_records = false;
    let mut bad = 0usize;
    for line in reader.lines() {
        let line = line.map_err(|e| format!("failed reading MPCORB: {e}"))?;
        if !in_records {
            if line.starts_with("----------") {
                in_records = true;
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        match parse_record(&line) {
            Ok(record) => records.push(record),
            Err(_) => bad += 1,
        }
    }
    if !in_records {
        return Err("MPCORB header separator is missing".into());
    }
    if records.is_empty() {
        return Err("MPCORB contains no valid orbit records".into());
    }
    if bad > records.len() / 20 + 10 {
        return Err(format!(
            "MPCORB validation rejected {bad} malformed records"
        ));
    }
    Ok(records)
}

pub fn parse_record(line: &str) -> Result<OrbitRecord, String> {
    if !line.is_ascii() || line.len() < 103 {
        return Err("truncated or non-ASCII record".into());
    }
    let field = |start: usize, end: usize| -> &str { line.get(start..end).unwrap_or("").trim() };
    let required = |start, end, name: &str| -> Result<f64, String> {
        field(start, end)
            .parse()
            .map_err(|_| format!("invalid {name}"))
    };
    let packed = field(0, 7).to_string();
    if packed.is_empty() {
        return Err("missing packed designation".into());
    }
    let epoch = unpack_epoch(field(20, 25))?;
    let e = required(70, 79, "eccentricity")?;
    let a = required(92, 103, "semimajor axis")?;
    if !(0.0..1.0).contains(&e) || !(0.01..=1_000.0).contains(&a) {
        return Err("non-elliptic or implausible orbit".into());
    }
    // MPC defines this as a four-hexdigit bit field (Fortran z4.4), not decimal.
    let flags = u32::from_str_radix(field(161, 165), 16).unwrap_or(0);
    let readable = field(166, 194)
        .trim_matches(|c| c == '(' || c == ')')
        .trim();
    Ok(OrbitRecord {
        packed_designation: packed.clone(),
        designation: if readable.is_empty() {
            packed
        } else {
            readable.to_string()
        },
        h: field(8, 13).parse().ok(),
        g: field(14, 19).parse().ok(),
        epoch_tt_jd: epoch,
        mean_anomaly_deg: required(26, 35, "M")?,
        arg_perihelion_deg: required(37, 46, "perihelion")?,
        ascending_node_deg: required(48, 57, "node")?,
        inclination_deg: required(59, 68, "inclination")?,
        eccentricity: e,
        mean_motion_deg_day: required(80, 91, "mean motion")?,
        semimajor_axis_au: a,
        uncertainty: {
            let v = field(105, 106);
            (!v.is_empty()).then(|| v.to_string())
        },
        observations: field(117, 122).parse().ok(),
        oppositions: field(123, 126).parse().ok(),
        arc: {
            let v = field(127, 136);
            (!v.is_empty()).then(|| v.to_string())
        },
        rms_arcsec: field(137, 141).parse().ok(),
        neo: flags & (1 << 11) != 0,
        pha: flags & (1 << 15) != 0,
        last_observation: {
            let v = field(194, 202);
            (!v.is_empty()).then(|| v.to_string())
        },
    })
}

pub fn unpack_epoch(value: &str) -> Result<f64, String> {
    let b = value.as_bytes();
    if b.len() != 5 {
        return Err("invalid packed epoch width".into());
    }
    let century = match b[0] {
        b'I' => 1800,
        b'J' => 1900,
        b'K' => 2000,
        b'L' => 2100,
        _ => return Err("invalid packed epoch century".into()),
    };
    let year = century
        + std::str::from_utf8(&b[1..3])
            .ok()
            .and_then(|s| s.parse::<i32>().ok())
            .ok_or("invalid epoch year")?;
    let month = packed_digit(b[3]).ok_or("invalid epoch month")?;
    let day = packed_digit(b[4]).ok_or("invalid epoch day")?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err("invalid packed epoch date".into());
    }
    Ok(gregorian_jd(year, month, day))
}

fn packed_digit(c: u8) -> Option<u32> {
    match c {
        b'0'..=b'9' => Some((c - b'0') as u32),
        b'A'..=b'V' => Some((c - b'A' + 10) as u32),
        _ => None,
    }
}
fn gregorian_jd(mut y: i32, mut m: u32, d: u32) -> f64 {
    if m <= 2 {
        y -= 1;
        m += 12;
    }
    let a = (y as f64 / 100.0).floor();
    let b = 2.0 - a + (a / 4.0).floor();
    (365.25 * (y + 4716) as f64).floor() + (30.6001 * (m + 1) as f64).floor() + d as f64 + b
        - 1524.5
}
fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn load_active_manifest(root: &Path) -> Result<MpcorbManifest, String> {
    serde_json::from_slice(&fs::read(root.join("active.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

pub fn load_active(root: &Path) -> Result<(MpcorbManifest, Vec<OrbitRecord>), String> {
    let manifest = load_active_manifest(root)?;
    let file = File::open(root.join(&manifest.index_file)).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let records = if manifest.parser_version == "skyeye-mpcorb-1" {
        // Keep existing installations readable; new indexes use a self-describing envelope.
        bincode::serde::decode_from_std_read(&mut reader, bincode::config::standard())
            .map_err(|e| e.to_string())?
    } else {
        if manifest.parser_version != PARSER_VERSION {
            return Err(format!(
                "unsupported MPCORB index version {}",
                manifest.parser_version
            ));
        }
        let stored: StoredIndex =
            bincode::serde::decode_from_std_read(&mut reader, bincode::config::standard())
                .map_err(|e| e.to_string())?;
        if stored.parser_version != manifest.parser_version
            || stored.source_sha256 != manifest.sha256
        {
            return Err("MPCORB index does not match its active manifest".into());
        }
        stored.records
    };
    if records.len() != manifest.record_count {
        return Err(format!(
            "MPCORB index record count mismatch: expected {}, got {}",
            manifest.record_count,
            records.len()
        ));
    }
    Ok((manifest, records))
}

pub async fn download_and_activate(root: &Path) -> Result<MpcorbManifest, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let previous = load_active_manifest(root).ok();
    let client = reqwest::Client::builder()
        .user_agent(concat!("SkyEye/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(MPCORB_URL).header(ACCEPT_ENCODING, "identity");
    if let Some(manifest) = previous.as_ref() {
        if let Some(etag) = manifest.etag.as_deref() {
            request = request.header(IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = manifest.last_modified.as_deref() {
            request = request.header(IF_MODIFIED_SINCE, last_modified);
        }
    }
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status == StatusCode::NOT_MODIFIED {
        let mut manifest = previous
            .clone()
            .ok_or("MPC returned 304 without a local database")?;
        manifest.downloaded_unix = now_unix();
        write_active_manifest(root, &manifest)?;
        return Ok(manifest);
    }
    if !status.is_success() {
        return Err(format!("MPC returned HTTP {status}"));
    }
    let etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let last_modified = response
        .headers()
        .get("last-modified")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if let Some(length) = response.content_length() {
        if length > MAX_COMPRESSED_BYTES {
            return Err(format!(
                "MPCORB download is implausibly large: {length} bytes"
            ));
        }
    }
    let nonce = uuid::Uuid::new_v4();
    let tmp_gz = root.join(format!(".mpcorb-download-{nonce}.tmp"));
    let tmp_index = root.join(format!(".mpcorb-index-{nonce}.tmp"));
    let _cleanup = TempFiles(vec![tmp_gz.clone(), tmp_index.clone()]);
    let mut output = tokio::fs::File::create(&tmp_gz)
        .await
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_COMPRESSED_BYTES {
            return Err(format!(
                "MPCORB download exceeded the {} byte safety limit",
                MAX_COMPRESSED_BYTES
            ));
        }
        hasher.update(&chunk);
        output.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    output.flush().await.map_err(|e| e.to_string())?;
    drop(output);
    let sha = hex::encode(hasher.finalize());
    if let Some(mut manifest) = previous.filter(|manifest| {
        manifest.sha256 == sha
            && manifest.parser_version == PARSER_VERSION
            && root.join(&manifest.compressed_file).is_file()
            && root.join(&manifest.index_file).is_file()
    }) {
        manifest.downloaded_unix = now_unix();
        manifest.etag = etag;
        manifest.last_modified = last_modified;
        write_active_manifest(root, &manifest)?;
        return Ok(manifest);
    }
    let build_gz = tmp_gz.clone();
    let build_index_path = tmp_index.clone();
    let build_sha = sha.clone();
    let record_count =
        tokio::task::spawn_blocking(move || build_index(&build_gz, &build_index_path, &build_sha))
            .await
            .map_err(|e| format!("MPCORB index worker failed: {e}"))??;
    if record_count < MIN_RECORD_COUNT {
        return Err(format!(
            "MPCORB record count {record_count} is implausibly small"
        ));
    }
    let gz_name = format!("mpcorb-{sha}.dat.gz");
    let index_name = format!("mpcorb-{sha}-{PARSER_VERSION}.bin");
    persist_content_file(&tmp_gz, &root.join(&gz_name))?;
    persist_content_file(&tmp_index, &root.join(&index_name))?;
    let manifest = MpcorbManifest {
        source_page: MPC_DATA_PAGE.into(),
        download_url: MPCORB_URL.into(),
        downloaded_unix: now_unix(),
        sha256: sha,
        compressed_file: gz_name,
        index_file: index_name,
        record_count,
        parser_version: PARSER_VERSION.into(),
        etag,
        last_modified,
    };
    write_active_manifest(root, &manifest)?;
    Ok(manifest)
}

/// Activate a local MPCORB.DAT.gz: validate → sha256 → build index → persist → write manifest.
/// Shares the same persistence path as `download_and_activate`, so users can fall back to a
/// local file when the official source is unreachable.
pub fn activate_local_gz(root: &Path, gz_path: &Path) -> Result<MpcorbManifest, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let metadata =
        fs::metadata(gz_path).map_err(|e| format!("cannot read {}: {e}", gz_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", gz_path.display()));
    }
    if metadata.len() > MAX_COMPRESSED_BYTES {
        return Err(format!(
            "MPCORB file is implausibly large: {} bytes",
            metadata.len()
        ));
    }
    let sha = {
        let mut file = File::open(gz_path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        hex::encode(hasher.finalize())
    };
    // Idempotent: same sha with complete files only refreshes the timestamp, no rebuild.
    if let Ok(previous) = load_active_manifest(root) {
        if previous.sha256 == sha
            && previous.parser_version == PARSER_VERSION
            && root.join(&previous.compressed_file).is_file()
            && root.join(&previous.index_file).is_file()
        {
            let mut manifest = previous;
            manifest.downloaded_unix = now_unix();
            write_active_manifest(root, &manifest)?;
            return Ok(manifest);
        }
    }
    let nonce = uuid::Uuid::new_v4();
    let tmp_gz = root.join(format!(".mpcorb-download-{nonce}.tmp"));
    let tmp_index = root.join(format!(".mpcorb-index-{nonce}.tmp"));
    let _cleanup = TempFiles(vec![tmp_gz.clone(), tmp_index.clone()]);
    fs::copy(gz_path, &tmp_gz).map_err(|e| e.to_string())?;
    let record_count = build_index(&tmp_gz, &tmp_index, &sha)?;
    if record_count < MIN_RECORD_COUNT {
        return Err(format!(
            "MPCORB record count {record_count} is implausibly small"
        ));
    }
    let gz_name = format!("mpcorb-{sha}.dat.gz");
    let index_name = format!("mpcorb-{sha}-{PARSER_VERSION}.bin");
    persist_content_file(&tmp_gz, &root.join(&gz_name))?;
    persist_content_file(&tmp_index, &root.join(&index_name))?;
    let manifest = MpcorbManifest {
        source_page: MPC_DATA_PAGE.into(),
        download_url: MPCORB_URL.into(),
        downloaded_unix: now_unix(),
        sha256: sha,
        compressed_file: gz_name,
        index_file: index_name,
        record_count,
        parser_version: PARSER_VERSION.into(),
        etag: None,
        last_modified: None,
    };
    write_active_manifest(root, &manifest)?;
    Ok(manifest)
}

fn build_index(gzip_path: &Path, index_path: &Path, sha: &str) -> Result<usize, String> {
    let gzip = File::open(gzip_path).map_err(|e| e.to_string())?;
    let decoder = GzDecoder::new(BufReader::with_capacity(1024 * 1024, gzip));
    let records = parse_mpcorb_reader(BufReader::with_capacity(1024 * 1024, decoder))?;
    let record_count = records.len();
    let index = StoredIndex {
        parser_version: PARSER_VERSION.into(),
        source_sha256: sha.into(),
        records,
    };
    let file = File::create(index_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::with_capacity(1024 * 1024, file);
    bincode::serde::encode_into_std_write(&index, &mut writer, bincode::config::standard())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    writer.get_ref().sync_all().map_err(|e| e.to_string())?;
    Ok(record_count)
}

fn persist_content_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(source).map_err(|e| e.to_string())
    } else {
        fs::rename(source, destination).map_err(|e| e.to_string())
    }
}

fn write_active_manifest(root: &Path, manifest: &MpcorbManifest) -> Result<(), String> {
    let tmp_manifest: PathBuf = root.join(format!(".active-{}.tmp", uuid::Uuid::new_v4()));
    let _cleanup = TempFiles(vec![tmp_manifest.clone()]);
    fs::write(
        &tmp_manifest,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let active = root.join("active.json");
    let backup = root.join("active.json.previous");
    if active.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&active, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&tmp_manifest, &active) {
        if backup.exists() {
            let _ = fs::rename(&backup, &active);
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

struct TempFiles(Vec<PathBuf>);

impl Drop for TempFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activate_local_gz_rejects_missing_file() {
        let root =
            std::env::temp_dir().join(format!("skyeye-activate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let error = activate_local_gz(&root, Path::new("/nonexistent/MPCORB.DAT.gz"))
            .expect_err("missing file must fail");
        assert!(error.contains("cannot read"));
        let _ = std::fs::remove_dir_all(&root);
    }
    #[test]
    fn packed_epoch() {
        assert!((unpack_epoch("K2411").unwrap() - 2460310.5).abs() < 1e-9);
    }
    #[test]
    fn rejects_truncated() {
        assert!(parse_record("K000001").is_err());
    }

    #[test]
    fn parses_flags_as_hexadecimal() {
        let mut line = vec![b' '; 202];
        let mut put = |start: usize, value: &str| {
            line[start..start + value.len()].copy_from_slice(value.as_bytes());
        };
        put(0, "K24A001");
        put(20, "K2411");
        put(26, "  1.00000");
        put(37, "  2.00000");
        put(48, "  3.00000");
        put(59, "  4.00000");
        put(70, "0.1000000");
        put(80, " 0.20000000");
        put(92, "  2.0000000");
        put(161, "8800");
        let record = parse_record(std::str::from_utf8(&line).unwrap()).unwrap();
        assert!(record.neo);
        assert!(record.pha);
    }
}
