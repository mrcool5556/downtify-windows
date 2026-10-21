//! The download manager: a queue of track ids, up to three workers,
//! resumable transfers into the music folder, progress events to the UI.
//!
//! Files land at `<music_dir>/<server relative path>` so the local folder
//! mirrors the server's layout. A transfer writes `<file>.part` and
//! renames on completion; a `.part` left behind is resumed with Range.

use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::commands::client_for;
use crate::db;
use crate::AppState;

pub const PARALLEL: usize = 3;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Downloading,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub track_id: String,
    pub status: Status,
    pub received: u64,
    pub total: u64,
    pub error: String,
    pub title: String,
    pub artist: String,
}

#[derive(Default)]
pub struct Manager_ {
    queue: VecDeque<String>,
    states: HashMap<String, Progress>,
    active: usize,
    cancel: HashMap<String, Arc<std::sync::atomic::AtomicBool>>,
}

pub type Shared = Arc<Mutex<Manager_>>;

pub fn new() -> Shared {
    Arc::new(Mutex::new(Manager_::default()))
}

/// Everything the UI shows in the Downloads view: active + queued +
/// recent results, newest activity first-ish (insertion order).
pub fn snapshot(m: &Shared) -> Vec<Progress> {
    let g = m.lock().unwrap();
    let mut out: Vec<Progress> = g.states.values().cloned().collect();
    out.sort_by_key(|p| match p.status {
        Status::Downloading => 0,
        Status::Queued => 1,
        Status::Error => 2,
        Status::Done => 3,
        Status::Cancelled => 4,
    });
    out
}

pub fn clear_finished(m: &Shared) {
    let mut g = m.lock().unwrap();
    g.states
        .retain(|_, p| matches!(p.status, Status::Queued | Status::Downloading));
}

/// Queue tracks (ignoring ones already queued, running or on disk).
pub fn enqueue(app: &AppHandle, ids: Vec<String>) -> usize {
    let state = app.state::<AppState>();
    let mut added = 0;
    {
        let conn = state.db.lock().unwrap();
        let mut g = state.downloads.lock().unwrap();
        for id in ids {
            if db::local_path(&conn, &id).is_some() {
                continue;
            }
            if let Some(p) = g.states.get(&id) {
                if matches!(p.status, Status::Queued | Status::Downloading) {
                    continue;
                }
            }
            let (title, artist) = db::get_track(&conn, &id)
                .ok()
                .flatten()
                .map(|t| {
                    (
                        t.row.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        t.row.get("artist").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    )
                })
                .unwrap_or_default();
            g.states.insert(
                id.clone(),
                Progress {
                    track_id: id.clone(),
                    status: Status::Queued,
                    received: 0,
                    total: 0,
                    error: String::new(),
                    title,
                    artist,
                },
            );
            g.queue.push_back(id);
            added += 1;
        }
    }
    pump(app);
    added
}

pub fn cancel(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let mut g = state.downloads.lock().unwrap();
    g.queue.retain(|q| q != id);
    if let Some(flag) = g.cancel.get(id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(p) = g.states.get_mut(id) {
        if p.status == Status::Queued {
            p.status = Status::Cancelled;
            let _ = app.emit("download-progress", p.clone());
        }
    }
}

/// Start workers while there is room.
fn pump(app: &AppHandle) {
    let state = app.state::<AppState>();
    loop {
        let next = {
            let mut g = state.downloads.lock().unwrap();
            if g.active >= PARALLEL {
                return;
            }
            match g.queue.pop_front() {
                Some(id) => {
                    g.active += 1;
                    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    g.cancel.insert(id.clone(), flag.clone());
                    if let Some(p) = g.states.get_mut(&id) {
                        p.status = Status::Downloading;
                        let _ = app.emit("download-progress", p.clone());
                    }
                    (id, flag)
                }
                None => return,
            }
        };
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let (id, flag) = next;
            let result = download_one(&app2, &id, flag).await;
            let state = app2.state::<AppState>();
            let progress = {
                let mut g = state.downloads.lock().unwrap();
                g.active -= 1;
                g.cancel.remove(&id);
                let p = g.states.get_mut(&id);
                match (&result, p) {
                    (Ok(()), Some(p)) => {
                        p.status = Status::Done;
                        p.received = p.total.max(p.received);
                        Some(p.clone())
                    }
                    (Err(e), Some(p)) => {
                        p.status = if e == "cancelled" { Status::Cancelled } else { Status::Error };
                        p.error = if e == "cancelled" { String::new() } else { e.clone() };
                        Some(p.clone())
                    }
                    _ => None,
                }
            };
            if let Some(p) = progress {
                let _ = app2.emit("download-progress", p);
            }
            pump(&app2);
        });
    }
}

/// Make a server-relative path safe for a Windows folder under music_dir.
pub fn local_relative(file: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in Path::new(&file.replace('\\', "/")).components() {
        match comp {
            Component::Normal(c) => {
                let s = c.to_string_lossy();
                let cleaned: String = s
                    .chars()
                    .map(|ch| match ch {
                        '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
                        c if (c as u32) < 32 => '_',
                        c => c,
                    })
                    .collect();
                let cleaned = cleaned.trim_end_matches(['.', ' ']).to_string();
                if cleaned.is_empty() {
                    return None;
                }
                out.push(cleaned);
            }
            Component::CurDir => {}
            _ => return None, // `..`, roots, prefixes: refuse
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

async fn download_one(app: &AppHandle, id: &str, cancel: Arc<std::sync::atomic::AtomicBool>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (track, music_dir) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let t = db::get_track(&conn, id)?.ok_or("Track is no longer in the library")?;
        let dir = state.settings.lock().map_err(|e| e.to_string())?.music_dir.clone();
        (t, dir)
    };
    let file = track.row.get("file").and_then(|v| v.as_str()).unwrap_or("");
    let rel = local_relative(file).ok_or("Server gave an unusable file name")?;
    let final_path = Path::new(&music_dir).join(&rel);
    let part_path = final_path.with_extension(format!(
        "{}.part",
        final_path.extension().and_then(|e| e.to_str()).unwrap_or("bin")
    ));
    if let Some(parent) = final_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Cannot create folder: {e}"))?;
    }

    // A file already there (e.g. copied by hand) counts as downloaded.
    let expected = track.row.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    if let Ok(meta) = tokio::fs::metadata(&final_path).await {
        if meta.is_file() && (expected == 0 || meta.len() == expected) {
            finish(app, id, &final_path, meta.len())?;
            return Ok(());
        }
    }

    let resume_from = tokio::fs::metadata(&part_path).await.map(|m| m.len()).unwrap_or(0);
    let client = client_for(&state)?;
    let mut req = client.get(&format!("/api/v1/tracks/{id}/stream?download=true"));
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={resume_from}-"));
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Server unreachable".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status();
    if status.as_u16() == 401 {
        return Err("This device is no longer paired".into());
    }
    if !status.is_success() {
        return Err(format!("Server answered {}", status.as_u16()));
    }
    let resumed = status.as_u16() == 206 && resume_from > 0;
    let total = resp
        .content_length()
        .map(|l| if resumed { l + resume_from } else { l })
        .or(if expected > 0 { Some(expected) } else { None })
        .unwrap_or(0);

    let mut file = if resumed {
        tokio::fs::OpenOptions::new().append(true).open(&part_path).await
    } else {
        tokio::fs::File::create(&part_path).await
    }
    .map_err(|e| format!("Cannot write file: {e}"))?;

    let mut received = if resumed { resume_from } else { 0 };
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| format!("Cannot write file: {e}"))?;
        received += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 250 {
            last_emit = std::time::Instant::now();
            let mut g = state.downloads.lock().map_err(|e| e.to_string())?;
            if let Some(p) = g.states.get_mut(id) {
                p.received = received;
                p.total = total;
                let _ = app.emit("download-progress", p.clone());
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if total > 0 && received < total {
        return Err(format!("Incomplete ({received} of {total} bytes); will resume next time"));
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Cannot finish file: {e}"))?;
    finish(app, id, &final_path, received)
}

fn finish(app: &AppHandle, id: &str, path: &Path, size: u64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_local_file(&conn, id, &path.to_string_lossy(), size as i64)?;
    {
        let mut g = state.downloads.lock().map_err(|e| e.to_string())?;
        if let Some(p) = g.states.get_mut(id) {
            p.total = size;
            p.received = size;
        }
    }
    let _ = app.emit(
        "download-done",
        serde_json::json!({ "track_id": id, "local_path": path.to_string_lossy() }),
    );
    Ok(())
}

/// Delete local copies. Orphaned tracks (gone from the server) are
/// dropped from the index too.
pub fn remove_local(app: &AppHandle, ids: &[String]) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut removed = 0;
    for id in ids {
        if let Some(path) = db::local_path(&conn, id) {
            let p = PathBuf::from(&path);
            match std::fs::remove_file(&p) {
                Ok(()) | Err(_) => {}
            }
            // Tidy empty folders up to the music root, best effort.
            let root = PathBuf::from(&state.settings.lock().map_err(|e| e.to_string())?.music_dir);
            let mut dir = p.parent().map(|d| d.to_path_buf());
            while let Some(d) = dir {
                if d == root || !d.starts_with(&root) {
                    break;
                }
                if std::fs::remove_dir(&d).is_err() {
                    break;
                }
                dir = d.parent().map(|x| x.to_path_buf());
            }
            db::clear_local_file(&conn, id)?;
            removed += 1;
            let _ = app.emit("download-done", serde_json::json!({ "track_id": id, "local_path": Value::Null }));
        }
    }
    Ok(removed)
}

/// Tracks of keep-synced playlists (and liked songs) that aren't on disk.
pub fn missing_for_keep_synced(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let names = db::keep_synced(conn)?;
    let mut ids = Vec::new();
    for name in names {
        for id in db::playlist_track_ids(conn, &name)? {
            if db::local_path(conn, &id).is_none() && db::track_exists(conn, &id)? {
                ids.push(id);
            }
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}
