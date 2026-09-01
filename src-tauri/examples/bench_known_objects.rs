//! Compare the legacy per-orbit ERFA setup with prepared propagation contexts.
//!
//! Usage: cargo run --release --manifest-path src-tauri/Cargo.toml --example
//!        bench_known_objects -- DATA_MPCORB_DIRECTORY [SAMPLE_COUNT] [--prepared-only]

use sky_eye_lib::{
    ephemeris::{propagate, propagate_with_context, Observatory, PropagationContext},
    mpcorb,
};
use std::{env, hint::black_box, path::Path, time::Instant};

fn main() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let root = args.first().ok_or("expected MPCORB data directory")?;
    let sample_count = args
        .get(1)
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or(10_000);
    let load_started = Instant::now();
    let (manifest, records) = mpcorb::load_active(Path::new(root))?;
    let load = load_started.elapsed();
    let records = &records[..records.len().min(sample_count)];
    let prepared_only = args.get(2).is_some_and(|value| value == "--prepared-only");
    let station = Some(Observatory {
        longitude_deg_east: -155.4761,
        latitude_deg: 19.825,
        altitude_m: 4205.0,
        dut1_seconds: Some(0.0),
    });
    let epochs = [
        2_460_000.5,
        2_460_000.500_52,
        2_460_000.501_04,
        2_460_000.501_56,
    ];

    let mut legacy_checksum = 0.0;
    let legacy = if prepared_only {
        None
    } else {
        let started = Instant::now();
        for record in records {
            for epoch in epochs {
                legacy_checksum += propagate(record, epoch, station)?.ra_deg;
            }
        }
        Some(started.elapsed())
    };

    let started = Instant::now();
    let contexts = epochs
        .into_iter()
        .map(|epoch| PropagationContext::new(epoch, station))
        .collect::<Result<Vec<_>, _>>()?;
    let mut prepared_checksum = 0.0;
    for record in records {
        for context in &contexts {
            prepared_checksum += propagate_with_context(record, context)?.ra_deg;
        }
    }
    let prepared = started.elapsed();
    black_box((legacy_checksum, prepared_checksum));

    if let Some(legacy) = legacy {
        println!(
            "records={} manifest_records={} load_ms={} legacy_ms={} prepared_ms={} speedup={:.2}x",
            records.len(),
            manifest.record_count,
            load.as_millis(),
            legacy.as_millis(),
            prepared.as_millis(),
            legacy.as_secs_f64() / prepared.as_secs_f64()
        );
    } else {
        println!(
            "records={} manifest_records={} load_ms={} prepared_ms={}",
            records.len(),
            manifest.record_count,
            load.as_millis(),
            prepared.as_millis()
        );
    }
    Ok(())
}
