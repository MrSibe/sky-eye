use super::reader::{load_fits_hdu, FitsData, FitsMetadata};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::UNIX_EPOCH,
};

pub const FITS_READER_VERSION: &str = "cfitsio-reader-v2";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct FrameIdentity {
    pub canonical_path: String,
    pub file_len: u64,
    pub modified_ns: u128,
    pub sha256: String,
    pub selected_hdu: usize,
    pub reader_version: &'static str,
}

impl FrameIdentity {
    fn inspect(path: &Path, selected_hdu: usize) -> Result<Self, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("无法确认 FITS 文件 '{}': {error}", path.display()))?;
        let metadata = fs::metadata(&canonical)
            .map_err(|error| format!("无法检查 FITS 文件 '{}': {error}", canonical.display()))?;
        Ok(Self {
            canonical_path: canonical.to_string_lossy().into_owned(),
            file_len: metadata.len(),
            modified_ns: modified_ns(&metadata),
            sha256: crate::project::sha256_file(&canonical)?,
            selected_hdu,
            reader_version: FITS_READER_VERSION,
        })
    }

    fn verify_stat(&self) -> Result<PathBuf, String> {
        let path = PathBuf::from(&self.canonical_path);
        let metadata =
            fs::metadata(&path).map_err(|error| frame_changed(&path, &error.to_string()))?;
        if metadata.len() != self.file_len || modified_ns(&metadata) != self.modified_ns {
            return Err(frame_changed(&path, "文件长度或修改时间与打开图像时不一致"));
        }
        Ok(path)
    }
}

fn modified_ns(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default()
}

fn frame_changed(path: &Path, detail: &str) -> String {
    format!(
        "FITS 文件在当前会话中已变化，Sky Eye 已阻止继续使用旧分析结果。请重新打开文件 '{}': {detail}",
        path.display()
    )
}

#[derive(Debug, Clone)]
pub struct FrameSummary {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub min: f32,
    pub max: f32,
    pub metadata: FitsMetadata,
    pub identity: FrameIdentity,
}

struct FrameRecord {
    summary: FrameSummary,
}

pub struct FrameRegistry {
    records: Vec<FrameRecord>,
    cache: HashMap<usize, Arc<FitsData>>,
    lru: VecDeque<usize>,
    cached_bytes: usize,
    max_bytes: usize,
}

impl Default for FrameRegistry {
    fn default() -> Self {
        let max_mib = std::env::var("SKYEYE_FRAME_CACHE_MIB")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(256)
            .max(64);
        Self {
            records: Vec::new(),
            cache: HashMap::new(),
            lru: VecDeque::new(),
            cached_bytes: 0,
            max_bytes: max_mib * 1024 * 1024,
        }
    }
}

impl FrameRegistry {
    pub fn len(&self) -> usize {
        self.records.len()
    }
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
    pub fn clear(&mut self) {
        self.records.clear();
        self.cache.clear();
        self.lru.clear();
        self.cached_bytes = 0;
    }
    pub fn summaries(&self) -> impl Iterator<Item = &FrameSummary> {
        self.records.iter().map(|record| &record.summary)
    }
    pub fn identity(&self, index: usize) -> Result<&FrameIdentity, String> {
        self.records
            .get(index)
            .map(|record| &record.summary.identity)
            .ok_or_else(|| "Invalid frame index".to_string())
    }
    pub fn push_loaded(&mut self, data: FitsData) -> Result<(), String> {
        let index = self.records.len();
        let identity = FrameIdentity::inspect(Path::new(&data.path), data.metadata.selected_hdu)?;
        self.records.push(FrameRecord {
            summary: FrameSummary {
                path: data.path.clone(),
                width: data.width,
                height: data.height,
                min: data.min,
                max: data.max,
                metadata: data.metadata.clone(),
                identity,
            },
        });
        self.insert_cache(index, Arc::new(data));
        Ok(())
    }
    pub fn get(&mut self, index: usize) -> Result<Arc<FitsData>, String> {
        let identity = self.identity(index)?.clone();
        let path = identity.verify_stat()?;
        if let Some(data) = self.cache.get(&index).cloned() {
            self.touch(index);
            return Ok(data);
        }
        let sha256 = crate::project::sha256_file(&path)?;
        if sha256 != identity.sha256 {
            return Err(frame_changed(&path, "文件摘要与打开图像时不一致"));
        }
        let data = Arc::new(load_fits_hdu(
            path.to_string_lossy().as_ref(),
            Some(identity.selected_hdu),
        )?);
        self.insert_cache(index, data.clone());
        Ok(data)
    }
    fn data_bytes(data: &FitsData) -> usize {
        data.pixels.len() * std::mem::size_of::<f32>() + data.valid_pixels.len().div_ceil(8)
    }
    fn touch(&mut self, index: usize) {
        self.lru.retain(|value| *value != index);
        self.lru.push_back(index);
    }
    fn insert_cache(&mut self, index: usize, data: Arc<FitsData>) {
        if let Some(previous) = self.cache.insert(index, data.clone()) {
            self.cached_bytes = self
                .cached_bytes
                .saturating_sub(Self::data_bytes(&previous));
        }
        self.cached_bytes += Self::data_bytes(&data);
        self.touch(index);
        while self.cached_bytes > self.max_bytes && self.cache.len() > 1 {
            let Some(candidate) = self.lru.pop_front() else {
                break;
            };
            if candidate == index {
                self.lru.push_back(candidate);
                continue;
            }
            if let Some(removed) = self.cache.remove(&candidate) {
                self.cached_bytes = self.cached_bytes.saturating_sub(Self::data_bytes(&removed));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn frame_identity_rejects_external_file_replacement() {
        let path = std::env::temp_dir().join(format!(
            "sky-eye-frame-identity-{}.fits",
            uuid::Uuid::new_v4()
        ));
        fs::write(&path, b"original").expect("write fixture");
        let identity = FrameIdentity::inspect(&path, 3).expect("inspect fixture");
        assert_eq!(identity.selected_hdu, 3);
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open fixture");
        file.write_all(b"-changed").expect("modify fixture");
        let error = identity.verify_stat().expect_err("changed file must fail");
        assert!(error.contains("请重新打开文件"));
        let _ = fs::remove_file(path);
    }
}
