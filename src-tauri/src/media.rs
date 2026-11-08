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
        } else if path == "/playlist-cover" {
            serve_playlist_cover(&app, &query).await
        } else if path == "/artist-art" {
            serve_artist_art(&app, &query).await
        } else if let Some(vid) = path.strip_prefix("/online/") {
            serve_online(&app, vid, range.as_deref()).await
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

fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix(&format!("{key}=")))
        .map(|v| v.to_string())
}

/// `%XX` escapes (and `+`) back to text, for query values the page encoded.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    None => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// `/playlist-cover?file=<path as the server gave it>`: the server's
/// playlist mosaic, cached on disk under a hash of the path.
async fn serve_playlist_cover(app: &AppHandle, query: &str) -> Result<Response<Vec<u8>>, StatusCode> {
    let file = query_param(query, "file").ok_or(StatusCode::NOT_FOUND)?;
    if file.is_empty() {
        return Err(StatusCode::NOT_FOUND);
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .join("playlist-covers");
    let cache = dir.join(format!("{}.jpg", fnv(&file)));
    let bytes = match std::fs::read(&cache) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            let state = app.state::<AppState>();
            let client = client_for(&state).map_err(|_| StatusCode::NOT_FOUND)?;
            let resp = client
                .get(&format!("/playlist-cover?file={file}"))
                .send()
                .await
                .map_err(|_| StatusCode::BAD_GATEWAY)?;
            if !resp.status().is_success() {
                return Err(StatusCode::NOT_FOUND);
            }
            let b = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?.to_vec();
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&cache, &b);
            b
        }
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "max-age=86400")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// `/artist-art?path=/downloads/…&v=<version>`: an artist's photo as the
/// server saved it (the address `GET /api/artists/art` gives), fetched with
/// the device token and cached on disk per path and version.
async fn serve_artist_art(app: &AppHandle, query: &str) -> Result<Response<Vec<u8>>, StatusCode> {
    let path = percent_decode(&query_param(query, "path").ok_or(StatusCode::NOT_FOUND)?);
    if !path.starts_with("/downloads/") || path.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let version = query_param(query, "v").unwrap_or_default();
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .join("artist-art");
    let cache = dir.join(format!("{}.img", fnv(&format!("{path}#{version}"))));
    let bytes = match std::fs::read(&cache) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            let state = app.state::<AppState>();
            let client = client_for(&state).map_err(|_| StatusCode::NOT_FOUND)?;
            let encoded: String = path
                .split('/')
                .map(|seg| {
                    seg.bytes()
                        .map(|b| match b {
                            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                            _ => format!("%{b:02X}"),
                        })
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("/");
            let resp = client.get(&encoded).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            if !resp.status().is_success() {
                return Err(StatusCode::NOT_FOUND);
            }
            let b = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?.to_vec();
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&cache, &b);
            b
        }
    };
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "max-age=86400")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// `/online/<video_id>`: a song that isn't in the library yet, streamed by
/// the server (`GET /api/stream/file`, which needs the device token the
/// audio element can't send). Range is passed through so seeking works.
async fn serve_online(app: &AppHandle, video_id: &str, range: Option<&str>) -> Result<Response<Vec<u8>>, StatusCode> {
    if video_id.is_empty() || video_id.len() > 64 || !video_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(StatusCode::BAD_REQUEST);
    }
    let state = app.state::<AppState>();
    let client = client_for(&state).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let mut req = client.get(&format!("/api/stream/file?video_id={video_id}"));
    if let Some(r) = range {
        req = req.header(header::RANGE, r);
    }
    let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if !status.is_success() {
        return Err(status);
    }
    let mut b = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store");
    for name in [header::CONTENT_TYPE, header::CONTENT_RANGE] {
        if let Some(v) = resp.headers().get(&name) {
            b = b.header(name.clone(), v.clone());
        }
    }
    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?.to_vec();
    b = b.header(header::CONTENT_LENGTH, bytes.len().to_string());
    b.body(bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
