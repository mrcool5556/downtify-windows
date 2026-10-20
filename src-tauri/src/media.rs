//! The `media` URI scheme the webview plays and shows things from.
//! On Windows it is reached as `http://media.localhost/...`.
//!
//! - `/track/<id>`: a downloaded track's file, with HTTP Range so the
//!   audio element can seek. Chunks are capped so a request never
//!   loads a whole FLAC into memory.
//! - `/cover/<id>?size=300`: cover art, fetched from the server once
//!   and cached on disk so it still shows offline.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder};

use crate::commands::client_for;
use crate::db;
use crate::AppState;

const CHUNK: u64 = 2 * 1024 * 1024;

pub fn handle(ctx: UriSchemeContext<'_, tauri::Wry>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let uri = req.uri().clone();
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    tauri::async_runtime::spawn(async move {
        let path = uri.path().to_string();
        let query = uri.query().unwrap_or("").to_string();
        let result = if let Some(id) = path.strip_prefix("/track/") {
            serve_track(&app, id, range.as_deref())
        } else if let Some(id) = path.strip_prefix("/cover/") {
            serve_cover(&app, id, &query).await
        } else {
            Err(StatusCode::NOT_FOUND)
        };
        responder.respond(result.unwrap_or_else(|status| {
            Response::builder()
                .status(status)
                .body(Vec::new())
                .unwrap()
        }));
    });
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("flac") => "audio/flac",
        Some("mp3") => "audio/mpeg",
        Some("m4a") | Some("mp4") | Some("aac") => "audio/mp4",
        Some("ogg") | Some("oga") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        _ => "application/octet-stream",
    }
}

/// Parse `bytes=start-end` (either side optional) against a file size.
fn parse_range(spec: &str, size: u64) -> Option<(u64, u64)> {
    let spec = spec.strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", "") => return None,
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (size.saturating_sub(n), size.saturating_sub(1))
        }
        (s, "") => (s.parse().ok()?, size.saturating_sub(1)),
        (s, e) => (s.parse().ok()?, e.parse().ok()?),
    };
    if start >= size || end < start {
        return None;
    }
    Some((start, end.min(size - 1)))
}

fn serve_track(app: &AppHandle, id: &str, range: Option<&str>) -> Result<Response<Vec<u8>>, StatusCode> {
    let state = app.state::<AppState>();
    let path = {
        let conn = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db::local_path(&conn, id).ok_or(StatusCode::NOT_FOUND)?
    };
    let path = PathBuf::from(path);
    let mut file = File::open(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    let size = file.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len();
    let mime = mime_for(&path);

    let (start, end, status) = match range.and_then(|r| parse_range(r, size)) {
        Some((s, e)) => (s, e.min(s + CHUNK - 1), StatusCode::PARTIAL_CONTENT),
        None if range.is_some() => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
        None => (0, size.saturating_sub(1).min(CHUNK - 1), if size > CHUNK { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK }),
    };
    let len = if size == 0 { 0 } else { end - start + 1 };
    let mut buf = vec![0u8; len as usize];
    file.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.read_exact(&mut buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut b = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store");
    if status == StatusCode::PARTIAL_CONTENT {
        b = b.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    b.body(buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub fn cover_cache_path(app: &AppHandle, id: &str, size: u32) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("covers");
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if safe.is_empty() {
        return None;
    }
    Some(dir.join(format!("{safe}_{size}.jpg")))
}

fn cover_size(query: &str) -> u32 {
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("size="))
        .and_then(|v| v.parse().ok())
        .filter(|s| [150u32, 300, 600].contains(s))
        .unwrap_or(300)
}

async fn serve_cover(app: &AppHandle, id: &str, query: &str) -> Result<Response<Vec<u8>>, StatusCode> {
    let size = cover_size(query);
    let cache = cover_cache_path(app, id, size).ok_or(StatusCode::NOT_FOUND)?;
    let bytes = match std::fs::read(&cache) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            let state = app.state::<AppState>();
            let client = client_for(&state).map_err(|_| StatusCode::NOT_FOUND)?;
            let resp = client
                .get(&format!("/api/v1/tracks/{id}/cover?size={size}"))
                .send()
                .await
                .map_err(|_| StatusCode::BAD_GATEWAY)?;
            if !resp.status().is_success() {
                return Err(StatusCode::NOT_FOUND);
            }
            let b = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?.to_vec();
            if let Some(parent) = cache.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&cache, &b);
            b
        }
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "max-age=604800")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
