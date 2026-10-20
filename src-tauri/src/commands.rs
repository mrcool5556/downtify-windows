//! Tauri commands: the surface the React frontend calls.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::db;
use crate::server::{self, ApiError, Client, ServerInfo};
use crate::settings::{self, Settings};
use crate::AppState;

#[derive(Serialize)]
pub struct SettingsView {
    #[serde(flatten)]
    pub settings: Settings,
    pub paired: bool,
    pub default_music_dir: String,
}

fn view(s: &Settings) -> SettingsView {
    SettingsView {
        settings: s.clone(),
        paired: s.paired() && settings::load_token().is_some(),
        default_music_dir: settings::default_music_dir()
            .to_string_lossy()
            .into_owned(),
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn client_for(state: &AppState) -> Result<Client, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    if !s.paired() {
        return Err("Not paired with a server yet".into());
    }
    let token = settings::load_token().ok_or("Device token is missing; pair again")?;
    Client::new(&s.server_url, &token)
}

fn device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "Windows PC".into())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<SettingsView, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(view(&s))
}

/// Check an address before pairing. Returns the server's public info.
#[tauri::command]
pub async fn check_server(url: String) -> Result<ServerInfo, String> {
    let base = server::normalize_base(&url);
    if base.is_empty() {
        return Err("Enter the server address".into());
    }
    server::info(&base).await
}

/// Pair with a code from the web UI (Settings -> Apps -> Pair a phone).
#[tauri::command]
pub async fn pair(
    state: State<'_, AppState>,
    url: String,
    code: String,
) -> Result<SettingsView, String> {
    let base = server::normalize_base(&url);
    let info = server::info(&base).await?;
    let code = code.trim();
    if code.is_empty() {
        return Err("Enter the pairing code".into());
    }
    let resp = server::pair(&base, code, &device_name()).await?;
    settings::save_token(&resp.token)?;

    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    let switching_server = !s.server_id.is_empty() && s.server_id != info.server_id;
    s.server_url = base;
    s.server_id = if resp.server.server_id.is_empty() {
        info.server_id.clone()
    } else {
        resp.server.server_id.clone()
    };
    s.server_name = if resp.server.name.is_empty() {
        info.name.clone()
    } else {
        resp.server.name.clone()
    };
    s.username = resp.user.username.clone();
    s.device_id = resp.device.id.clone();
    s.device_name = resp.device.name.clone();
    settings::save(&state.settings_path, &s)?;
    if switching_server {
        // A different server: its track ids mean nothing here.
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::clear_all(&conn)?;
    }
    Ok(view(&s))
}

/// Forget the server. Keeps downloaded files on disk; clears the index.
#[tauri::command]
pub fn unpair(state: State<AppState>) -> Result<SettingsView, String> {
    settings::clear_token();
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    let music_dir = s.music_dir.clone();
    *s = Settings {
        music_dir,
        ..Default::default()
    };
    settings::save(&state.settings_path, &s)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::clear_all(&conn)?;
    Ok(view(&s))
}

#[derive(Serialize)]
pub struct ServerStatus {
    pub online: bool,
    pub paired: bool,
    pub detail: String,
    pub user: Value,
}

/// Is the server up and are we still paired? Quick; safe to poll.
#[tauri::command]
pub async fn server_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    let client = match client_for(&state) {
        Ok(c) => c,
        Err(e) => {
            return Ok(ServerStatus {
                online: false,
                paired: false,
                detail: e,
                user: Value::Null,
            })
        }
    };
    match client.auth_status().await {
        Ok(v) => Ok(ServerStatus {
            online: true,
            paired: v.get("signed_in").and_then(|b| b.as_bool()).unwrap_or(true),
            detail: String::new(),
            user: v.get("user").cloned().unwrap_or(Value::Null),
        }),
        Err(ApiError::Unpaired) => Ok(ServerStatus {
            online: true,
            paired: false,
            detail: "This device was unpaired on the server".into(),
            user: Value::Null,
        }),
        Err(ApiError::Offline) => Ok(ServerStatus {
            online: false,
            paired: true,
            detail: "Server unreachable".into(),
            user: Value::Null,
        }),
        Err(ApiError::Other(e)) => Ok(ServerStatus {
            online: false,
            paired: true,
            detail: e,
            user: Value::Null,
        }),
    }
}

#[derive(Serialize)]
pub struct SyncResult {
    pub full: bool,
    pub upserted: usize,
    pub deleted: usize,
    pub cursor: i64,
    pub playlists: usize,
    pub likes: usize,
    pub summary: db::Summary,
}

/// Pull library changes since the last cursor, then playlists and likes.
#[tauri::command]
pub async fn sync_library(state: State<'_, AppState>, refresh: bool) -> Result<SyncResult, String> {
    let client = client_for(&state)?;
    let since = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::cursor(&conn)
    };
    let lib = client.library(since, refresh).await.map_err(String::from)?;
    let playlists = client.playlists().await.map_err(String::from)?;
    let likes = client.likes().await.map_err(String::from)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let (upserted, deleted) =
        db::apply_library(&mut conn, lib.full, &lib.tracks, &lib.deleted, lib.cursor)?;
    db::replace_playlists(&mut conn, &playlists)?;
    db::replace_likes(&mut conn, &likes)?;
    db::set_meta(&conn, "last_sync", &now().to_string())?;
    Ok(SyncResult {
        full: lib.full,
        upserted,
        deleted,
        cursor: lib.cursor,
        playlists: playlists.len(),
        likes: likes.len(),
        summary: db::summary(&conn)?,
    })
}

#[tauri::command]
pub fn library_summary(state: State<AppState>) -> Result<db::Summary, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::summary(&conn)
}

#[derive(Deserialize, Default)]
pub struct TrackFilter {
    #[serde(default)]
    pub search: String,
    pub album_id: Option<String>,
    pub artist_id: Option<String>,
    pub playlist: Option<String>,
    #[serde(default)]
    pub local_only: bool,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub fn list_tracks(state: State<AppState>, filter: TrackFilter) -> Result<Vec<db::Track>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_tracks(
        &conn,
        &db::TrackQuery {
            search: filter.search,
            album_id: filter.album_id,
            artist_id: filter.artist_id,
            playlist: filter.playlist,
            local_only: filter.local_only,
            limit: filter.limit.unwrap_or(500),
            offset: filter.offset.unwrap_or(0),
        },
    )
}

#[tauri::command]
pub fn list_albums(state: State<AppState>, artist_id: Option<String>) -> Result<Vec<db::Album>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_albums(&conn, artist_id.as_deref())
}

#[tauri::command]
pub fn list_artists(state: State<AppState>) -> Result<Vec<db::Artist>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_artists(&conn)
}

#[tauri::command]
pub fn list_playlists(state: State<AppState>) -> Result<Vec<db::PlaylistSummary>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_playlists(&conn)
}

/// Change where downloads go. Existing files are not moved (yet).
#[tauri::command]
pub fn set_music_dir(state: State<AppState>, path: String) -> Result<SettingsView, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("Choose a folder".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Cannot use that folder: {e}"))?;
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    s.music_dir = path;
    settings::save(&state.settings_path, &s)?;
    Ok(view(&s))
}
