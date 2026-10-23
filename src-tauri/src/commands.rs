//! Tauri commands: the surface the React frontend calls.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

use crate::db;
use crate::downloads;
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
pub async fn sync_library(app: tauri::AppHandle, state: State<'_, AppState>, refresh: bool) -> Result<SyncResult, String> {
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
    let missing = downloads::missing_for_keep_synced(&conn)?;
    drop(conn);
    if !missing.is_empty() {
        downloads::enqueue(&app, missing);
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
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
        let thumb = [300u32, 150, 600]
            .iter()
            .filter_map(|s| crate::media::cover_cache_path(&app, &track_id, *s))
            .find(|p| p.exists());
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

// ── Downloads ───────────────────────────────────────────────────────────

/// On start: forget local files that vanished from disk.
pub fn verify_local_files(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return,
    };
    // A missing drive is not a deleted song: only forget a file whose
    // folder is there but the file is not.
    if let Ok(files) = db::local_files(&conn) {
        for (id, path) in files {
            let p = std::path::Path::new(&path);
            let parent_present = p.parent().map(|d| d.is_dir()).unwrap_or(false);
            if parent_present && !p.is_file() {
                let _ = db::clear_local_file(&conn, &id);
            }
        }
    }
    drop(conn);
}

#[tauri::command]
pub fn download_tracks(app: tauri::AppHandle, track_ids: Vec<String>) -> Result<usize, String> {
    Ok(downloads::enqueue(&app, track_ids))
}

#[tauri::command]
pub fn cancel_download(app: tauri::AppHandle, track_id: String) {
    downloads::cancel(&app, &track_id);
}

#[tauri::command]
pub fn download_states(state: State<AppState>) -> Vec<downloads::Progress> {
    downloads::snapshot(&state.downloads)
}

#[tauri::command]
pub fn clear_finished_downloads(state: State<AppState>) {
    downloads::clear_finished(&state.downloads);
}

#[tauri::command]
pub fn remove_local(app: tauri::AppHandle, track_ids: Vec<String>) -> Result<usize, String> {
    downloads::remove_local(&app, &track_ids)
}

/// Keep a playlist (or the liked list) downloaded; queues what's missing now.
#[tauri::command]
pub fn set_keep_synced(app: tauri::AppHandle, state: State<AppState>, name: String, on: bool) -> Result<usize, String> {
    let missing = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::set_keep_synced(&conn, &name, on)?;
        if on {
            db::playlist_track_ids(&conn, &name)?
                .into_iter()
                .filter(|id| db::local_path(&conn, id).is_none() && db::track_exists(&conn, id).unwrap_or(false))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        }
    };
    Ok(if missing.is_empty() { 0 } else { downloads::enqueue(&app, missing) })
}

/// Queue whatever keep-synced lists are missing (used after a sync).
#[tauri::command]
pub fn sync_keep_synced(app: tauri::AppHandle, state: State<AppState>) -> Result<usize, String> {
    let missing = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        downloads::missing_for_keep_synced(&conn)?
    };
    Ok(if missing.is_empty() { 0 } else { downloads::enqueue(&app, missing) })
}

#[tauri::command]
pub fn set_keep_played(state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    s.keep_played = on;
    settings::save(&state.settings_path, &s)?;
    Ok(view(&s))
}

// ── Playlist editing (needs the browser-style session) ──────────────────

#[derive(Serialize)]
pub struct WebStatus {
    pub signed_in: bool,
    pub username: String,
}

#[tauri::command]
pub async fn web_sign_in(state: State<'_, AppState>, username: String, password: String) -> Result<WebStatus, String> {
    let base = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        if !s.paired() {
            return Err("Pair with the server first".into());
        }
        s.server_url.clone()
    };
    let (session, user) = server::login(&base, username.trim(), &password).await?;
    settings::save_web_session(&session)?;
    Ok(WebStatus { signed_in: true, username: user })
}

#[tauri::command]
pub fn web_sign_out() -> WebStatus {
    settings::clear_web_session();
    WebStatus { signed_in: false, username: String::new() }
}

/// Is the playlist-editing session still good? Cheap; safe to call often.
#[tauri::command]
pub async fn web_status(state: State<'_, AppState>) -> Result<WebStatus, String> {
    let session = match settings::load_web_session() {
        Some(s) => s,
        None => return Ok(WebStatus { signed_in: false, username: String::new() }),
    };
    let client = client_for(&state)?;
    match client.web_json(&session, reqwest::Method::GET, "/api/auth/status", None).await {
        Ok(v) => {
            let signed_in = v.get("signed_in").and_then(|b| b.as_bool()).unwrap_or(false)
                && v.get("via").and_then(|s| s.as_str()) == Some("session");
            if !signed_in {
                settings::clear_web_session();
            }
            Ok(WebStatus {
                signed_in,
                username: v
                    .get("user")
                    .and_then(|u| u.get("username"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        }
        Err(ApiError::Unpaired) => {
            settings::clear_web_session();
            Ok(WebStatus { signed_in: false, username: String::new() })
        }
        Err(e) => Err(String::from(e)),
    }
}

fn web_session() -> Result<String, String> {
    settings::load_web_session().ok_or_else(|| "Sign in under Settings to edit playlists".to_string())
}

fn web_err(e: ApiError) -> String {
    match e {
        ApiError::Unpaired => {
            settings::clear_web_session();
            "Your sign-in expired. Sign in again under Settings to edit playlists".into()
        }
        other => String::from(other),
    }
}

/// Pull playlists and likes again and store them; the UI re-reads.
/// A `refresh=true` library call first makes the server rescan its
/// folder, otherwise the playlist list can lag an edit by a minute.
async fn pull_playlists(state: &AppState, client: &Client) -> Result<Vec<db::PlaylistSummary>, String> {
    let since = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::cursor(&conn)
    };
    if let Ok(lib) = client.library(since, true).await {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::apply_library(&mut conn, lib.full, &lib.tracks, &lib.deleted, lib.cursor);
    }
    let playlists = client.playlists().await.map_err(String::from)?;
    let likes = client.likes().await.map_err(String::from)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_playlists(&mut conn, &playlists)?;
    db::replace_likes(&mut conn, &likes)?;
    db::list_playlists(&conn)
}

#[tauri::command]
pub async fn refresh_playlists(state: State<'_, AppState>) -> Result<Vec<db::PlaylistSummary>, String> {
    let client = client_for(&state)?;
    pull_playlists(&state, &client).await
}

#[tauri::command]
pub async fn create_playlist(state: State<'_, AppState>, name: String) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    client
        .web_json(
            &session,
            reqwest::Method::POST,
            "/api/library/playlists",
            Some(&serde_json::json!({ "name": name.trim() })),
        )
        .await
        .map_err(web_err)?;
    pull_playlists(&state, &client).await
}

#[derive(Serialize)]
pub struct EditResult {
    pub playlists: Vec<db::PlaylistSummary>,
    pub added: i64,
    pub removed: i64,
    pub skipped: usize,
}

/// Add/remove tracks by id. The server wants file paths, so ids are
/// translated here; ids without a server file (orphans) are skipped.
/// The reply carries the playlist's new file list, which is applied
/// locally at once; the full server re-read happens in the background.
#[tauri::command]
pub async fn edit_playlist_tracks(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<EditResult, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    let (add_files, remove_files, skipped) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut skipped = 0;
        let mut to_files = |ids: &[String]| -> Result<Vec<String>, String> {
            let mut out = Vec::new();
            for id in ids {
                match db::get_track(&conn, id)? {
                    Some(t) if !t.orphaned => {
                        if let Some(f) = t.row.get("file").and_then(|v| v.as_str()) {
                            out.push(f.to_string());
                        }
                    }
                    _ => skipped += 1,
                }
            }
            Ok(out)
        };
        let a = to_files(&add)?;
        let r = to_files(&remove)?;
        (a, r, skipped)
    };
    let v = client
        .web_json(
            &session,
            reqwest::Method::POST,
            "/api/library/playlists/tracks",
            Some(&serde_json::json!({ "name": name, "add": add_files, "remove": remove_files })),
        )
        .await
        .map_err(web_err)?;
    // Instant local update from the reply's file list.
    let playlists = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(files) = v.get("files").and_then(|f| f.as_array()) {
            let paths: Vec<String> = files.iter().filter_map(|f| f.as_str().map(|s| s.to_string())).collect();
            let ids = db::ids_for_files(&conn, &paths)?;
            db::set_playlist_tracks(&conn, &name, &ids)?;
        }
        db::list_playlists(&conn)?
    };
    // Background: the authoritative re-read (also catches renames etc.).
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let st = app2.state::<AppState>();
        if let Ok(c) = client_for(&st) {
            if pull_playlists(&st, &c).await.is_ok() {
                let _ = app2.emit("playlists-refreshed", ());
            }
        }
    });
    Ok(EditResult {
        playlists,
        added: v.get("added").and_then(|x| x.as_i64()).unwrap_or(0),
        removed: v.get("removed").and_then(|x| x.as_i64()).unwrap_or(0),
        skipped,
    })
}

#[tauri::command]
pub async fn rename_playlist(state: State<'_, AppState>, name: String, new_name: String) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    client
        .web_json(
            &session,
            reqwest::Method::POST,
            "/api/library/playlists/rename",
            Some(&serde_json::json!({ "name": name, "new_name": new_name.trim() })),
        )
        .await
        .map_err(web_err)?;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let kept = db::keep_synced(&conn)?;
        if kept.iter().any(|k| k == &name) {
            db::set_keep_synced(&conn, &name, false)?;
            db::set_keep_synced(&conn, new_name.trim(), true)?;
        }
    }
    pull_playlists(&state, &client).await
}

/// Deletes the playlist on the server. The server also deletes the
/// playlist's songs from its library unless another user owns them;
/// the UI warns before calling this.
#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, name: String) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    let encoded: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect();
    client
        .web_json(
            &session,
            reqwest::Method::DELETE,
            &format!("/api/library/playlist?playlist_name={encoded}"),
            None,
        )
        .await
        .map_err(web_err)?;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::set_keep_synced(&conn, &name, false)?;
    }
    pull_playlists(&state, &client).await
}

// ── Playlist sharing (Downtify 3.7+) ────────────────────────────────────

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

/// Follow or unfollow a public playlist. Works with the device token.
#[tauri::command]
pub async fn follow_playlist(state: State<'_, AppState>, name: String, on: bool) -> Result<Vec<db::PlaylistSummary>, String> {
    let client = client_for(&state)?;
    if on {
        client
            .send_json(reqwest::Method::POST, "/api/v1/playlists/follow", &serde_json::json!({ "name": name }))
            .await
    } else {
        client
            .send_json(
                reqwest::Method::DELETE,
                &format!("/api/v1/playlists/follow?name={}", url_encode(&name)),
                &serde_json::json!({ "name": name }),
            )
            .await
    }
    .map_err(String::from)?;
    pull_playlists(&state, &client).await
}

/// Clear the "new" marker on a playlist shared with this user.
#[tauri::command]
pub async fn playlist_seen(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let client = client_for(&state)?;
    let _ = client
        .send_json(reqwest::Method::POST, "/api/v1/playlists/seen", &serde_json::json!({ "name": name }))
        .await;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE playlists SET is_new = 0 WHERE name = ?1", [name])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct Usernames {
    pub enabled: bool,
    pub usernames: Vec<String>,
}

/// Who a playlist can be shared with (names only), and whether sharing is on.
#[tauri::command]
pub async fn usernames(state: State<'_, AppState>) -> Result<Usernames, String> {
    let client = client_for(&state)?;
    let resp = client
        .get("/api/v1/usernames")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Server answered {}", resp.status().as_u16()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(Usernames {
        enabled: v.get("enabled").and_then(|b| b.as_bool()).unwrap_or(false),
        usernames: v
            .get("usernames")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
    })
}

/// Share a playlist you own: private | shared (with `shared_with`) | public.
#[tauri::command]
pub async fn set_playlist_visibility(
    state: State<'_, AppState>,
    name: String,
    visibility: String,
    shared_with: Vec<String>,
) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    client
        .web_json(
            &session,
            reqwest::Method::PUT,
            "/api/library/playlists/visibility",
            Some(&serde_json::json!({ "name": name, "visibility": visibility, "shared_with": shared_with })),
        )
        .await
        .map_err(web_err)?;
    pull_playlists(&state, &client).await
}

/// Save a private, editable copy of any playlist you can open.
#[tauri::command]
pub async fn copy_playlist(state: State<'_, AppState>, name: String, new_name: Option<String>) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    let mut body = serde_json::json!({ "name": name });
    if let Some(n) = new_name.filter(|n| !n.trim().is_empty()) {
        body["new_name"] = Value::String(n.trim().to_string());
    }
    client
        .web_json(&session, reqwest::Method::POST, "/api/library/playlists/copy", Some(&body))
        .await
        .map_err(web_err)?;
    pull_playlists(&state, &client).await
}

/// Turn an imported playlist into an editable Library one.
#[tauri::command]
pub async fn detach_playlist(state: State<'_, AppState>, name: String) -> Result<Vec<db::PlaylistSummary>, String> {
    let session = web_session()?;
    let client = client_for(&state)?;
    client
        .web_json(&session, reqwest::Method::POST, "/api/library/playlists/detach", Some(&serde_json::json!({ "name": name })))
        .await
        .map_err(web_err)?;
    pull_playlists(&state, &client).await
}

// ── Shell: tray, startup, link downloads, updates ───────────────────────

#[tauri::command]
pub fn set_close_to_tray(state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    s.close_to_tray = on;
    settings::save(&state.settings_path, &s)?;
    Ok(view(&s))
}

#[tauri::command]
pub fn set_start_with_windows(app: tauri::AppHandle, state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if on {
        launcher.enable().map_err(|e| e.to_string())?;
    } else {
        launcher.disable().map_err(|e| e.to_string())?;
    }
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    s.start_with_windows = launcher.is_enabled().unwrap_or(on);
    settings::save(&state.settings_path, &s)?;
    Ok(view(&s))
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn set_tray_tooltip(app: tauri::AppHandle, text: String) {
    crate::tray::set_tooltip(&app, &text);
}

/// Ask the server to download a Spotify / YouTube Music link.
#[tauri::command]
pub async fn request_download(state: State<'_, AppState>, url: String) -> Result<Value, String> {
    let client = client_for(&state)?;
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("Paste a full link".into());
    }
    let encoded: String = u
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect();
    client
        .send_json(reqwest::Method::POST, &format!("/api/download/url?url={encoded}"), &serde_json::json!({}))
        .await
        .map_err(String::from)
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub url: String,
}

/// Compare the running version with the newest GitHub release.
#[tauri::command]
pub async fn check_app_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(concat!("DowntifyDesktop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let v: Value = client
        .get("https://api.github.com/repos/mrcool5556/downtify-windows/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let tag = v.get("tag_name").and_then(|t| t.as_str()).unwrap_or("").trim_start_matches('v').to_string();
    let url = v.get("html_url").and_then(|t| t.as_str()).unwrap_or("https://github.com/mrcool5556/downtify-windows/releases").to_string();
    let parse = |s: &str| -> Vec<u64> { s.split('.').filter_map(|p| p.parse().ok()).collect() };
    let newer = !tag.is_empty() && parse(&tag) > parse(&current);
    Ok(UpdateInfo { current, latest: tag, newer, url })
}

// ── Mini player ─────────────────────────────────────────────────────────

/// Switch between the full window and the mini player.
#[tauri::command]
pub fn set_mini(app: tauri::AppHandle, state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    crate::window_mode::remember_bounds(&app);
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini = on;
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    crate::window_mode::apply(&app, &snapshot);
    Ok(view(&snapshot))
}

#[tauri::command]
pub fn set_mini_pinned(app: tauri::AppHandle, state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini_pinned = on;
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_always_on_top(on);
        }
    }
    Ok(view(&snapshot))
}

#[tauri::command]
pub fn set_mini_opacity(app: tauri::AppHandle, state: State<AppState>, percent: u8) -> Result<SettingsView, String> {
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini_opacity = percent.min(100);
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini {
        crate::window_mode::opacity_now(&app, if snapshot.mini_opacity_mode == "window" { snapshot.mini_opacity } else { 100 });
    }
    Ok(view(&snapshot))
}

/// Open or close the drawer; the window grows or shrinks to match.
#[tauri::command]
pub fn set_mini_expanded(app: tauri::AppHandle, state: State<AppState>, on: bool) -> Result<SettingsView, String> {
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini_expanded = on;
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini {
        if let Some(win) = app.get_webview_window("main") {
            crate::window_mode::resize_mini_height(&win, crate::window_mode::mini_height(&snapshot));
        }
    }
    Ok(view(&snapshot))
}

#[tauri::command]
pub fn set_mini_opacity_mode(app: tauri::AppHandle, state: State<AppState>, mode: String) -> Result<SettingsView, String> {
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini_opacity_mode = if mode == "window" { "window".into() } else { "background".into() };
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini {
        crate::window_mode::opacity_now(&app, if snapshot.mini_opacity_mode == "window" { snapshot.mini_opacity } else { 100 });
    }
    Ok(view(&snapshot))
}

/// Temporary opacity (hover): does not touch the saved value.
#[tauri::command]
pub fn window_opacity_now(app: tauri::AppHandle, percent: u8) {
    crate::window_mode::opacity_now(&app, percent);
}

// ── In-app updates (GitHub releases + checksum) ─────────────────────────

#[tauri::command]
pub async fn check_updates() -> Result<crate::updater::UpdateCheck, String> {
    crate::updater::check().await
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, release: Value) -> Result<(), String> {
    let r: crate::updater::Release = serde_json::from_value(release).map_err(|e| e.to_string())?;
    crate::updater::install(app, r).await
}

/// Open or close the mini's drawer to an exact height (the handle's click).
#[tauri::command]
pub fn set_mini_height(app: tauri::AppHandle, state: State<AppState>, height: f64) -> Result<SettingsView, String> {
    let h = height.clamp(crate::window_mode::MINI_HEIGHT, crate::window_mode::MINI_MAX_HEIGHT);
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        s.mini_expanded = h > crate::window_mode::MINI_HEIGHT + 20.0;
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini {
        if let Some(win) = app.get_webview_window("main") {
            crate::window_mode::resize_mini_height(&win, h);
        }
    }
    Ok(view(&snapshot))
}

/// Turn the drop shadow on or off for the full window or the mini.
#[tauri::command]
pub fn set_window_shadow(app: tauri::AppHandle, state: State<AppState>, mini: bool, on: bool) -> Result<SettingsView, String> {
    let snapshot = {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        if mini {
            s.mini_shadow = on;
        } else {
            s.window_shadow = on;
        }
        settings::save(&state.settings_path, &s)?;
        s.clone()
    };
    if snapshot.mini == mini {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_shadow(on);
        }
    }
    Ok(view(&snapshot))
}
