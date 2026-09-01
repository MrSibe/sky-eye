//! Reproducibly crop a FITS image through CFITSIO's image-section syntax.
//!
//! Usage: cargo run --manifest-path src-tauri/Cargo.toml --example crop_golden --
//!        SOURCE.fits DESTINATION.fits X1 X2 Y1 Y2
//! Coordinates are FITS/CFITSIO one-based inclusive coordinates. CFITSIO
//! updates dimensional and WCS reference-pixel cards while copying the HDU.

use fitsio::FitsFile;
use std::{env, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 6 {
        return Err("expected SOURCE DESTINATION X1 X2 Y1 Y2".into());
    }
    let parse = |index: usize| args[index].parse::<usize>();
    let (x1, x2, y1, y2) = (parse(2)?, parse(3)?, parse(4)?, parse(5)?);
    if x1 == 0 || y1 == 0 || x2 < x1 || y2 < y1 {
        return Err("invalid one-based inclusive crop rectangle".into());
    }
    let destination = Path::new(&args[1]);
    if destination.exists() {
        return Err(format!("destination already exists: {}", destination.display()).into());
    }
    let section = format!("{}[{x1}:{x2},{y1}:{y2}]", args[0]);
    let mut source = FitsFile::open(section)?;
    let source_hdu = source.primary_hdu()?;
    let mut output = FitsFile::create(destination).open()?;
    source_hdu.copy_to(&mut source, &mut output)?;
    Ok(())
}
