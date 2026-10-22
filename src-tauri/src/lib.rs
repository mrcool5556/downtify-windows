mod commands;
mod db;
mod downloads;
mod media;
mod server;
mod settings;
#[cfg(windows)]
mod smtc;
mod tray;
pub mod window_mode;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// Everything the commands share.
pub struct AppState {
    pub settings_path: PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub db: Mutex<Connection>,
    pub downloads: downloads::Shared,
    #[cfg(windows)]
    pub smtc: Mutex<Option<smtc::Smtc>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .register_asynchronous_uri_scheme_protocol("media", media::handle)
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    // Debounce-free but cheap: remember where each shape lives.
                    window_mode::remember_bounds(window.app_handle());
                }
                _ => {}
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .state::<AppState>()
                    .settings
                    .lock()
                    .map(|s| s.close_to_tray)
                    .unwrap_or(true);
                window_mode::save_now(window.app_handle());
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
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
                downloads: downloads::new(),
                #[cfg(windows)]
                smtc: Mutex::new(smtc),
            });
            commands::verify_local_files(app.handle());
            {
                let state = app.state::<AppState>();
                let s = state.settings.lock().map(|s| s.clone()).unwrap_or_default();
                window_mode::apply(app.handle(), &s);
            }
            if let Err(e) = tray::build(app.handle()) {
                eprintln!("tray unavailable: {e}");
            }
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
            commands::record_play,
            commands::recent_plays,
            commands::recent_albums,
            commands::download_tracks,
            commands::cancel_download,
            commands::download_states,
            commands::clear_finished_downloads,
            commands::remove_local,
            commands::set_keep_synced,
            commands::sync_keep_synced,
            commands::set_keep_played,
            commands::web_sign_in,
            commands::web_sign_out,
            commands::web_status,
            commands::create_playlist,
            commands::edit_playlist_tracks,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::refresh_playlists,
            commands::follow_playlist,
            commands::playlist_seen,
            commands::usernames,
            commands::set_playlist_visibility,
            commands::copy_playlist,
            commands::detach_playlist,
            commands::set_close_to_tray,
            commands::set_start_with_windows,
            commands::quit_app,
            commands::request_download,
            commands::check_app_update,
            commands::set_tray_tooltip,
            commands::set_mini,
            commands::set_mini_pinned,
            commands::set_mini_opacity,
            commands::set_mini_opacity_mode,
            commands::set_mini_expanded,
            commands::window_opacity_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Downtify");
}
