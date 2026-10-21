//! Local SQLite library: a mirror of the server's track feed, playlists
//! and likes, plus which tracks have a file on this PC. Everything is
//! keyed by the server's stable track id.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::server::Playlist;

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            album_artist TEXT NOT NULL DEFAULT '',
            album_id TEXT NOT NULL DEFAULT '',
            artist_id TEXT NOT NULL DEFAULT '',
            track_number INTEGER NOT NULL DEFAULT 0,
            duration REAL NOT NULL DEFAULT 0,
            added INTEGER NOT NULL DEFAULT 0,
            orphaned INTEGER NOT NULL DEFAULT 0,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS keep_synced (
            name TEXT PRIMARY KEY
        );
        CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id);
        CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist_id);
        CREATE INDEX IF NOT EXISTS tracks_added ON tracks(added);
        CREATE TABLE IF NOT EXISTS playlists (
            name TEXT PRIMARY KEY,
            liked INTEGER NOT NULL DEFAULT 0,
            manual INTEGER NOT NULL DEFAULT 0,
            count INTEGER NOT NULL DEFAULT 0,
            cover TEXT NOT NULL DEFAULT '',
            track_ids TEXT NOT NULL,
            owner TEXT NOT NULL DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'private',
            mine INTEGER NOT NULL DEFAULT 1,
            followed INTEGER NOT NULL DEFAULT 0,
            shared_with_me INTEGER NOT NULL DEFAULT 0,
            is_new INTEGER NOT NULL DEFAULT 0,
            shared_with TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS likes (
            track_id TEXT PRIMARY KEY,
            position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_files (
            track_id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            downloaded_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id TEXT NOT NULL,
            played_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS history_when ON history(played_at);
        CREATE TABLE IF NOT EXISTS pending_listens (
            play_id TEXT PRIMARY KEY,
            track_id TEXT NOT NULL,
            played_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    // Older databases: add columns introduced later.
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN orphaned INTEGER NOT NULL DEFAULT 0", []);
    for col in [
        "owner TEXT NOT NULL DEFAULT ''",
        "visibility TEXT NOT NULL DEFAULT 'private'",
        "mine INTEGER NOT NULL DEFAULT 1",
        "followed INTEGER NOT NULL DEFAULT 0",
        "shared_with_me INTEGER NOT NULL DEFAULT 0",
        "is_new INTEGER NOT NULL DEFAULT 0",
        "shared_with TEXT NOT NULL DEFAULT '[]'",
    ] {
        let _ = conn.execute(&format!("ALTER TABLE playlists ADD COLUMN {col}"), []);
    }
    Ok(conn)
}

pub fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn cursor(conn: &Connection) -> i64 {
    get_meta(conn, "cursor")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn s(v: &Value, k: &str) -> String {
    v.get(k)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// Apply one `/api/v1/library` response. Returns (upserted, deleted).
pub fn apply_library(
    conn: &mut Connection,
    full: bool,
    tracks: &[Value],
    deleted: &[String],
    cursor: i64,
) -> Result<(usize, usize), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut removed = 0usize;
    if full {
        // Keep anything we have on disk; the upserts below un-orphan
        // whatever the server still lists.
        removed = tx
            .execute("DELETE FROM tracks WHERE id NOT IN (SELECT track_id FROM local_files)", [])
            .map_err(|e| e.to_string())?;
        tx.execute("UPDATE tracks SET orphaned = 1", [])
            .map_err(|e| e.to_string())?;
    }
    {
        let mut up = tx
            .prepare(
                "INSERT INTO tracks(id, title, artist, album, album_artist, album_id, artist_id,
                                    track_number, duration, added, json)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title, artist = excluded.artist, album = excluded.album,
                    album_artist = excluded.album_artist, album_id = excluded.album_id,
                    artist_id = excluded.artist_id, track_number = excluded.track_number,
                    duration = excluded.duration, added = excluded.added, json = excluded.json,
                    orphaned = 0",
            )
            .map_err(|e| e.to_string())?;
        for t in tracks {
            let id = s(t, "id");
            if id.is_empty() {
                continue;
            }
            up.execute(params![
                id,
                s(t, "title"),
                s(t, "artist"),
                s(t, "album"),
                s(t, "album_artist"),
                s(t, "album_id"),
                s(t, "artist_id"),
                t.get("track_number").and_then(|x| x.as_i64()).unwrap_or(0),
                t.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0),
                t.get("added").and_then(|x| x.as_i64()).unwrap_or(0),
                t.to_string(),
            ])
            .map_err(|e| e.to_string())?;
        }
        if !full {
            let mut del = tx
                .prepare("DELETE FROM tracks WHERE id = ?1 AND id NOT IN (SELECT track_id FROM local_files)")
                .map_err(|e| e.to_string())?;
            let mut orphan = tx
                .prepare("UPDATE tracks SET orphaned = 1 WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            for id in deleted {
                let n = del.execute([id]).map_err(|e| e.to_string())?;
                if n == 0 {
                    orphan.execute([id]).map_err(|e| e.to_string())?;
                }
                removed += n;
            }
        }
    }
    tx.execute(
        "INSERT INTO meta(key, value) VALUES('cursor', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [cursor.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok((tracks.len(), removed))
}

pub fn replace_playlists(conn: &mut Connection, lists: &[Playlist]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM playlists", [])
        .map_err(|e| e.to_string())?;
    {
        let mut ins = tx
            .prepare(
                "INSERT INTO playlists(name, liked, manual, count, cover, track_ids,
                                       owner, visibility, mine, followed, shared_with_me, is_new, shared_with)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            )
            .map_err(|e| e.to_string())?;
        for p in lists {
            ins.execute(params![
                p.name,
                p.liked as i64,
                p.manual as i64,
                p.count,
                p.cover,
                serde_json::to_string(&p.track_ids).unwrap_or_else(|_| "[]".into()),
                p.owner,
                p.visibility,
                p.mine as i64,
                p.followed as i64,
                p.shared_with_me as i64,
                p.is_new as i64,
                serde_json::to_string(&p.shared_with).unwrap_or_else(|_| "[]".into()),
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn replace_likes(conn: &mut Connection, ids: &[String]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM likes", []).map_err(|e| e.to_string())?;
    {
        let mut ins = tx
            .prepare("INSERT INTO likes(track_id, position) VALUES(?1, ?2)")
            .map_err(|e| e.to_string())?;
        for (i, id) in ids.iter().enumerate() {
            ins.execute(params![id, i as i64])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn local_path(conn: &Connection, track_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM local_files WHERE track_id = ?1",
        [track_id],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn set_local_file(conn: &Connection, track_id: &str, path: &str, size: i64) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO local_files(track_id, path, size, downloaded_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(track_id) DO UPDATE SET path = excluded.path, size = excluded.size, downloaded_at = excluded.downloaded_at",
        params![track_id, path, size, now],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn clear_local_file(conn: &Connection, track_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM local_files WHERE track_id = ?1", [track_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks WHERE id = ?1 AND orphaned = 1", [track_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn track_exists(conn: &Connection, track_id: &str) -> Result<bool, String> {
    conn.query_row("SELECT 1 FROM tracks WHERE id = ?1 AND orphaned = 0", [track_id], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
        .map_err(|e| e.to_string())
}

pub fn playlist_track_ids(conn: &Connection, name: &str) -> Result<Vec<String>, String> {
    Ok(conn
        .query_row("SELECT track_ids FROM playlists WHERE name = ?1", [name], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())?
        .and_then(|txt| serde_json::from_str(&txt).ok())
        .unwrap_or_default())
}

/// Track ids for server file paths, in the given order (unknown paths skipped).
pub fn ids_for_files(conn: &Connection, files: &[String]) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM tracks WHERE json_extract(json, '$.file') = ?1 AND orphaned = 0 LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(files.len());
    for f in files {
        if let Some(id) = stmt.query_row([f], |r| r.get::<_, String>(0)).optional().map_err(|e| e.to_string())? {
            out.push(id);
        }
    }
    Ok(out)
}

pub fn set_playlist_tracks(conn: &Connection, name: &str, ids: &[String]) -> Result<(), String> {
    conn.execute(
        "UPDATE playlists SET track_ids = ?1, count = ?2 WHERE name = ?3",
        params![serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()), ids.len() as i64, name],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn keep_synced(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT name FROM keep_synced").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn set_keep_synced(conn: &Connection, name: &str, on: bool) -> Result<(), String> {
    if on {
        conn.execute("INSERT OR IGNORE INTO keep_synced(name) VALUES(?1)", [name])
    } else {
        conn.execute("DELETE FROM keep_synced WHERE name = ?1", [name])
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// All local files (for checking what's still on disk at start).
pub fn local_files(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn.prepare("SELECT track_id, path FROM local_files").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn set_like(conn: &Connection, track_id: &str, liked: bool) -> Result<(), String> {
    if liked {
        // Newest first: put it ahead of everything else.
        conn.execute(
            "INSERT OR REPLACE INTO likes(track_id, position)
             VALUES(?1, COALESCE((SELECT MIN(position) FROM likes), 0) - 1)",
            [track_id],
        )
    } else {
        conn.execute("DELETE FROM likes WHERE track_id = ?1", [track_id])
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Listen {
    pub track_id: String,
    pub play_id: String,
    pub played_at: String,
}

pub fn queue_listen(conn: &Connection, l: &Listen) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO pending_listens(play_id, track_id, played_at) VALUES(?1, ?2, ?3)",
        params![l.play_id, l.track_id, l.played_at],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn pending_listens(conn: &Connection) -> Result<Vec<Listen>, String> {
    let mut stmt = conn
        .prepare("SELECT track_id, play_id, played_at FROM pending_listens")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Listen {
                track_id: r.get(0)?,
                play_id: r.get(1)?,
                played_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn remove_listen(conn: &Connection, play_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM pending_listens WHERE play_id = ?1", [play_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn get_track(conn: &Connection, track_id: &str) -> Result<Option<Track>, String> {
    conn.query_row(&format!("{TRACK_SELECT} WHERE t.id = ?1"), [track_id], row_to_track)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn record_play(conn: &Connection, track_id: &str, now: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO history(track_id, played_at) VALUES(?1, ?2)",
        params![track_id, now],
    )
    .map_err(|e| e.to_string())?;
    // Keep the table small: the last 2000 plays are plenty for Home.
    conn.execute(
        "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 2000)",
        [],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Distinct recently played tracks, newest first.
pub fn recent_plays(conn: &Connection, limit: i64) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{TRACK_SELECT} JOIN (SELECT track_id, MAX(played_at) AS last FROM history GROUP BY track_id) h
             ON h.track_id = t.id ORDER BY h.last DESC LIMIT ?1"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([limit], row_to_track).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Albums by when their newest track was added, newest first.
pub fn recent_albums(conn: &Connection, limit: i64) -> Result<Vec<Album>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.album_id, t.album, t.album_artist, t.artist_id, COUNT(*),
                    SUM(l.path IS NOT NULL), MIN(t.id), MAX(t.added) AS newest
             FROM tracks t LEFT JOIN local_files l ON l.track_id = t.id
             WHERE t.album_id <> ''
             GROUP BY t.album_id ORDER BY newest DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(Album {
                album_id: r.get(0)?,
                album: r.get(1)?,
                album_artist: r.get(2)?,
                artist_id: r.get(3)?,
                count: r.get(4)?,
                local_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                cover_track_id: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn clear_all(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM tracks; DELETE FROM playlists; DELETE FROM likes;
         DELETE FROM local_files; DELETE FROM meta; DELETE FROM pending_listens; DELETE FROM history; DELETE FROM keep_synced;",
    )
    .map_err(|e| e.to_string())
}

/// A track as the frontend sees it: the server row plus local state.
#[derive(Debug, Serialize, Deserialize)]
pub struct Track {
    #[serde(flatten)]
    pub row: Value,
    pub local_path: Option<String>,
    pub liked: bool,
    pub orphaned: bool,
}

const TRACK_SELECT: &str = "SELECT t.json, l.path, (k.track_id IS NOT NULL), t.orphaned
    FROM tracks t
    LEFT JOIN local_files l ON l.track_id = t.id
    LEFT JOIN likes k ON k.track_id = t.id";

fn row_to_track(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    let json: String = r.get(0)?;
    let local_path: Option<String> = r.get(1)?;
    let liked: bool = r.get(2)?;
    let orphaned: bool = r.get(3)?;
    Ok(Track {
        row: serde_json::from_str(&json).unwrap_or(Value::Null),
        local_path,
        liked,
        orphaned,
    })
}

pub struct TrackQuery {
    pub search: String,
    pub album_id: Option<String>,
    pub artist_id: Option<String>,
    pub playlist: Option<String>,
    pub local_only: bool,
    pub limit: i64,
    pub offset: i64,
}

pub fn list_tracks(conn: &Connection, q: &TrackQuery) -> Result<Vec<Track>, String> {
    // Playlists hold an ordered id list; honour that order.
    if let Some(name) = &q.playlist {
        let ids: Vec<String> = conn
            .query_row(
                "SELECT track_ids FROM playlists WHERE name = ?1",
                [name],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .and_then(|txt| serde_json::from_str(&txt).ok())
            .unwrap_or_default();
        let mut stmt = conn
            .prepare(&format!("{TRACK_SELECT} WHERE t.id = ?1"))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(t) = stmt
                .query_row([&id], row_to_track)
                .optional()
                .map_err(|e| e.to_string())?
            {
                if q.local_only && t.local_path.is_none() {
                    continue;
                }
                if !q.search.trim().is_empty() {
                    let needle = q.search.trim().to_lowercase();
                    let hay = |k: &str| t.row.get(k).and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                    if !(hay("title").contains(&needle) || hay("artist").contains(&needle) || hay("album").contains(&needle)) {
                        continue;
                    }
                }
                out.push(t);
            }
        }
        return Ok(out);
    }

    let mut sql = format!("{TRACK_SELECT} WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if !q.search.trim().is_empty() {
        let pat = format!("%{}%", q.search.trim());
        sql.push_str(" AND (t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ?)");
        args.push(Box::new(pat.clone()));
        args.push(Box::new(pat.clone()));
        args.push(Box::new(pat));
    }
    if let Some(a) = &q.album_id {
        sql.push_str(" AND t.album_id = ?");
        args.push(Box::new(a.clone()));
    }
    if let Some(a) = &q.artist_id {
        sql.push_str(" AND t.artist_id = ?");
        args.push(Box::new(a.clone()));
    }
    if q.local_only {
        sql.push_str(" AND l.path IS NOT NULL");
    }
    if q.album_id.is_some() {
        sql.push_str(" ORDER BY t.track_number, t.title");
    } else {
        sql.push_str(" ORDER BY t.added DESC, t.title");
    }
    sql.push_str(" LIMIT ? OFFSET ?");
    args.push(Box::new(q.limit.max(1)));
    args.push(Box::new(q.offset.max(0)));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), row_to_track)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct Album {
    pub album_id: String,
    pub album: String,
    pub album_artist: String,
    pub artist_id: String,
    pub count: i64,
    pub local_count: i64,
    pub cover_track_id: String,
}

pub fn list_albums(conn: &Connection, artist_id: Option<&str>) -> Result<Vec<Album>, String> {
    let mut sql = String::from(
        "SELECT t.album_id, t.album, t.album_artist, t.artist_id, COUNT(*),
                SUM(l.path IS NOT NULL), MIN(t.id)
         FROM tracks t LEFT JOIN local_files l ON l.track_id = t.id
         WHERE t.album_id <> ''",
    );
    if artist_id.is_some() {
        sql.push_str(" AND t.artist_id = ?1");
    }
    sql.push_str(" GROUP BY t.album_id ORDER BY t.album_artist COLLATE NOCASE, t.album COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| -> rusqlite::Result<Album> {
        Ok(Album {
            album_id: r.get(0)?,
            album: r.get(1)?,
            album_artist: r.get(2)?,
            artist_id: r.get(3)?,
            count: r.get(4)?,
            local_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            cover_track_id: r.get(6)?,
        })
    };
    let rows = match artist_id {
        Some(a) => stmt.query_map([a], map),
        None => stmt.query_map([], map),
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct Artist {
    pub artist_id: String,
    pub name: String,
    pub count: i64,
    pub local_count: i64,
}

pub fn list_artists(conn: &Connection) -> Result<Vec<Artist>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.artist_id, t.album_artist, COUNT(*), SUM(l.path IS NOT NULL)
             FROM tracks t LEFT JOIN local_files l ON l.track_id = t.id
             WHERE t.artist_id <> ''
             GROUP BY t.artist_id ORDER BY t.album_artist COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Artist {
                artist_id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
                local_count: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct PlaylistSummary {
    pub name: String,
    pub liked: bool,
    pub manual: bool,
    pub count: i64,
    pub local_count: i64,
    pub cover: String,
    pub keep_synced: bool,
    pub owner: String,
    pub visibility: String,
    pub mine: bool,
    pub followed: bool,
    pub shared_with_me: bool,
    pub is_new: bool,
    pub shared_with: Vec<String>,
}

pub fn list_playlists(conn: &Connection) -> Result<Vec<PlaylistSummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, liked, manual, count, cover, track_ids,
                    owner, visibility, mine, followed, shared_with_me, is_new, shared_with
             FROM playlists ORDER BY mine DESC, liked DESC, name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let mut local = conn
        .prepare("SELECT 1 FROM local_files WHERE track_id = ?1")
        .map_err(|e| e.to_string())?;
    let kept = keep_synced(conn)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                (
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, bool>(8)?,
                    r.get::<_, bool>(9)?,
                    r.get::<_, bool>(10)?,
                    r.get::<_, bool>(11)?,
                    r.get::<_, String>(12)?,
                ),
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (name, liked, manual, count, cover, ids_txt, (owner, visibility, mine, followed, shared_with_me, is_new, shared_txt)) =
            row.map_err(|e| e.to_string())?;
        let shared_with: Vec<String> = serde_json::from_str(&shared_txt).unwrap_or_default();
        let ids: Vec<String> = serde_json::from_str(&ids_txt).unwrap_or_default();
        let mut local_count = 0;
        for id in &ids {
            if local.exists([id]).map_err(|e| e.to_string())? {
                local_count += 1;
            }
        }
        let keep_synced = kept.iter().any(|k| k == &name);
        out.push(PlaylistSummary {
            name,
            liked,
            manual,
            count,
            cover,
            local_count,
            keep_synced,
            owner,
            visibility,
            mine,
            followed,
            shared_with_me,
            is_new,
            shared_with,
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub tracks: i64,
    pub local_tracks: i64,
    pub albums: i64,
    pub artists: i64,
    pub playlists: i64,
    pub cursor: i64,
    pub last_sync: i64,
}

pub fn summary(conn: &Connection) -> Result<Summary, String> {
    let one = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |r| r.get(0)).map_err(|e| e.to_string())
    };
    Ok(Summary {
        tracks: one("SELECT COUNT(*) FROM tracks")?,
        local_tracks: one("SELECT COUNT(*) FROM local_files")?,
        albums: one("SELECT COUNT(DISTINCT album_id) FROM tracks WHERE album_id <> ''")?,
        artists: one("SELECT COUNT(DISTINCT artist_id) FROM tracks WHERE artist_id <> ''")?,
        playlists: one("SELECT COUNT(*) FROM playlists")?,
        cursor: cursor(conn),
        last_sync: get_meta(conn, "last_sync")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    })
}
