mod commands;
mod db;
mod media;
mod server;
mod settings;
#[cfg(windows)]
mod smtc;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// Everything the commands share.
pub struct AppState {
    pub settings_path: PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub db: Mutex<Connection>,
    #[cfg(windows)]
    pub smtc: Mutex<Option<smtc::Smtc>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("media", media::handle)
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let settings_path = config_dir.join("settings.json");
            let settings = settings::load(&settings_path);
            let db = db::open(&data_dir.join("library.sqlite"))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            #[cfg(windows)]
            let smtc = {
                let handle = app.handle().clone();
                app.get_webview_window("main")
                    .and_then(|w| w.hwnd().ok())
                    .and_then(|h| match smtc::init(&handle, h.0 as isize) {
                        Ok(s) => {
                            println!("media keys: Windows media controls attached");
                            Some(s)
                        }
                        Err(e) => {
                            eprintln!("media keys unavailable: {e}");
                            None
                        }
                    })
            };

            app.manage(AppState {
                settings_path,
                settings: Mutex::new(settings),
                db: Mutex::new(db),
                #[cfg(windows)]
                smtc: Mutex::new(smtc),
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
            commands::set_stream_quality,
            commands::stream_url,
            commands::set_like,
            commands::report_listen,
            commands::flush_listens,
            commands::report_playback,
            commands::get_player_state,
            commands::set_player_state,
            commands::now_playing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Downtify");
}
