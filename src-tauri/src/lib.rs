mod commands;
mod db;
mod server;
mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// Everything the commands share.
pub struct AppState {
    pub settings_path: PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let settings_path = config_dir.join("settings.json");
            let settings = settings::load(&settings_path);
            let db = db::open(&data_dir.join("library.sqlite"))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(settings),
                db: Mutex::new(db),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::check_server,
            commands::pair,
            commands::unpair,
            commands::server_status,
            commands::sync_library,
            commands::library_summary,
            commands::list_tracks,
            commands::list_albums,
            commands::list_artists,
            commands::list_playlists,
            commands::set_music_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Downtify");
}
