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

pub(crate) fn client_for(state: &AppState) -> Result<Client, String> {
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

    // Being online is a good moment to deliver plays made offline.
    let _ = flush_pending(&state, &client).await;

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

// ── Player support ──────────────────────────────────────────────────────

#[tauri::command]
pub fn set_stream_quality(state: State<AppState>, quality: String) -> Result<SettingsView, String> {
    let q = match quality.as_str() {
        "opus160" => "opus160",
        _ => "original",
    };
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    s.stream_quality = q.to_string();
    settings::save(&state.settings_path, &s)?;
    Ok(view(&s))
}

#[derive(Serialize)]
pub struct StreamUrl {
    pub url: String,
    pub expires_at: i64,
}

/// A URL the audio element can play a non-downloaded track from.
/// Signed for 12 hours; the player asks again when it expires.
#[tauri::command]
pub async fn stream_url(state: State<'_, AppState>, track_id: String) -> Result<StreamUrl, String> {
    let client = client_for(&state)?;
    let quality = state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .stream_quality
        .clone();
    let params = if quality == "opus160" {
        serde_json::json!({ "format": "opus", "bitrate": "160" })
    } else {
        serde_json::json!({})
    };
    let ttl: u64 = 12 * 3600;
    let urls = client
        .sign(
            vec![serde_json::json!({
                "path": format!("/api/v1/tracks/{track_id}/stream"),
                "params": params,
            })],
            ttl,
        )
        .await
        .map_err(String::from)?;
    let url = urls.into_iter().next().ok_or("Server returned no URL")?;
    Ok(StreamUrl {
        url,
        expires_at: now() + ttl as i64 - 60,
    })
}

#[tauri::command]
pub async fn set_like(state: State<'_, AppState>, track_id: String, liked: bool) -> Result<bool, String> {
    let client = client_for(&state)?;
    client
        .send_json(
            reqwest::Method::PUT,
            "/api/v1/likes",
            &serde_json::json!({ "track_id": track_id, "liked": liked }),
        )
        .await
        .map_err(String::from)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_like(&conn, &track_id, liked)?;
    Ok(liked)
}

async fn send_listen(client: &Client, l: &db::Listen) -> Result<(), ApiError> {
    client
        .send_json(
            reqwest::Method::POST,
            "/api/discover/listens",
            &serde_json::json!({
                "track_id": l.track_id,
                "play_id": l.play_id,
                "played_at": l.played_at,
            }),
        )
        .await
        .map(|_| ())
}

/// Try to deliver queued listens. Stops at the first network failure.
async fn flush_pending(state: &AppState, client: &Client) -> Result<usize, String> {
    let pending = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::pending_listens(&conn)?
    };
    let mut sent = 0;
    for l in pending {
        match send_listen(client, &l).await {
            Ok(()) | Err(ApiError::Other(_)) => {
                // Delivered, or the server refused it for good; drop it.
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                db::remove_listen(&conn, &l.play_id)?;
                sent += 1;
            }
            Err(e) => return Err(String::from(e)),
        }
    }
    Ok(sent)
}

/// Report a play (after half the track). Queued if the server is away.
#[tauri::command]
pub async fn report_listen(state: State<'_, AppState>, track_id: String, play_id: String) -> Result<(), String> {
    let l = db::Listen {
        track_id,
        play_id,
        played_at: chrono_like_now(),
    };
    let client = match client_for(&state) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    match send_listen(&client, &l).await {
        Ok(()) => Ok(()),
        Err(ApiError::Other(e)) => Err(e),
        Err(_) => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            db::queue_listen(&conn, &l)
        }
    }
}

#[tauri::command]
pub async fn flush_listens(state: State<'_, AppState>) -> Result<usize, String> {
    let client = client_for(&state)?;
    flush_pending(&state, &client).await
}

/// "Now playing" for the server's Activity page. Best effort, online only.
#[tauri::command]
pub async fn report_playback(
    state: State<'_, AppState>,
    playback_state: String,
    track: Value,
    position: f64,
) -> Result<(), String> {
    let (client, player) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        if !s.paired() {
            return Ok(());
        }
        let token = match settings::load_token() {
            Some(t) => t,
            None => return Ok(()),
        };
        (Client::new(&s.server_url, &token)?, format!("desktop-{}", s.device_id))
    };
    let _ = client
        .send_json(
            reqwest::Method::POST,
            "/api/activity/playback",
            &serde_json::json!({
                "player": player,
                "state": playback_state,
                "track": track,
                "position": position,
            }),
        )
        .await;
    Ok(())
}

/// Whatever the frontend wants to remember between launches
/// (queue, current track, position, volume, shuffle, repeat).
#[tauri::command]
pub fn get_player_state(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_meta(&conn, "player_state")
        .and_then(|txt| serde_json::from_str(&txt).ok())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub fn set_player_state(state: State<AppState>, player_state: Value) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_meta(&conn, "player_state", &player_state.to_string())
}

/// Tell Windows what is playing (media keys, media popup).
#[tauri::command]
pub fn now_playing(
    app: tauri::AppHandle,
    state: State<AppState>,
    track_id: String,
    title: String,
    artist: String,
    album: String,
    status: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let thumb = crate::media::cover_cache_path(&app, &track_id, 300);
        let guard = state.smtc.lock().map_err(|e| e.to_string())?;
        if let Some(smtc) = guard.as_ref() {
            smtc.update(&title, &artist, &album, &status, thumb.as_deref())
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, track_id, title, artist, album, status);
    }
    Ok(())
}

/// ISO 8601 UTC "now" without pulling in chrono.
fn chrono_like_now() -> String {
    let secs = now();
    // Civil-from-days (Howard Hinnant), good for any sane date.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

// ── Home ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn record_play(state: State<AppState>, track_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::record_play(&conn, &track_id, now())
}

#[tauri::command]
pub fn recent_plays(state: State<AppState>, limit: Option<i64>) -> Result<Vec<db::Track>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::recent_plays(&conn, limit.unwrap_or(20))
}

#[tauri::command]
pub fn recent_albums(state: State<AppState>, limit: Option<i64>) -> Result<Vec<db::Album>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::recent_albums(&conn, limit.unwrap_or(12))
}
