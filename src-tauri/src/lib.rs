pub mod ades;
pub mod astrometry;
mod blink;
pub mod catalog;
mod commands;
pub mod core;
pub mod ephemeris;
mod fits;
pub mod logging;
pub mod measurement;
pub mod mpcorb;
mod project;
pub mod reduction;
pub mod report;
pub mod storage;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            let layout = storage::initialize(app.handle()).map_err(std::io::Error::other)?;
            logging::initialize(&layout.logs_dir).map_err(std::io::Error::other)?;
            log::info!(
                "Sky Eye {} started; logs_dir={}",
                env!("CARGO_PKG_VERSION"),
                layout.logs_dir.display()
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_frames,
            commands::close_all_images,
            commands::get_frame_pixel_buffer,
            commands::detect_stars,
            commands::get_frame_analysis,
            commands::query_gaia,
            commands::cancel_gaia_query,
            commands::query_refcat2,
            commands::fit_photometry,
            commands::calibrate_frame_photometry,
            commands::measure_aperture,
            commands::measure_target,
            commands::confirm_target_measurement,
            commands::discard_target_measurement,
            commands::list_target_measurements,
            commands::delete_target_measurement,
            commands::rename_target_measurement,
            commands::update_mpcorb,
            commands::get_mpcorb_status,
            commands::search_known_objects,
            commands::search_known_objects_batch,
            commands::match_tracklet,
            commands::preview_ades,
            commands::export_ades,
            commands::preview_report,
            commands::export_report,
            commands::get_app_config,
            commands::save_app_config,
            commands::load_app_config_file,
            commands::save_app_config_file,
            commands::get_storage_layout,
            commands::write_frontend_log,
            commands::plate_solve,
            commands::reduce_all_frames,
            commands::start_reduction,
            commands::get_reduction_run,
            commands::refit_reduction,
            commands::export_solved_fits,
            commands::blink_next,
            commands::blink_prev,
            commands::blink_set_frame,
            commands::blink_toggle,
            commands::blink_set_speed,
            commands::blink_get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
