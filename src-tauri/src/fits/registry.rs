use super::reader::{load_fits, FitsData, FitsMetadata};
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

#[derive(Debug, Clone)]
pub struct FrameSummary {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub min: f32,
    pub max: f32,
    pub metadata: FitsMetadata,
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
    pub fn push_loaded(&mut self, data: FitsData) {
        let index = self.records.len();
        self.records.push(FrameRecord {
            summary: FrameSummary {
                path: data.path.clone(),
                width: data.width,
                height: data.height,
                min: data.min,
                max: data.max,
                metadata: data.metadata.clone(),
            },
        });
        self.insert_cache(index, Arc::new(data));
    }
    pub fn get(&mut self, index: usize) -> Result<Arc<FitsData>, String> {
        if let Some(data) = self.cache.get(&index).cloned() {
            self.touch(index);
            return Ok(data);
        }
        let record = self.records.get(index).ok_or("Invalid frame index")?;
        let mut data = load_fits(&record.summary.path)?;
        data.metadata = record.summary.metadata.clone();
        let data = Arc::new(data);
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
