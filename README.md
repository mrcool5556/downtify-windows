# Downtify for Windows

A Windows client for a self-hosted [Downtify](https://github.com/henriquesebastiao/downtify) server, built with Tauri 2, React and Rust.

It keeps a local copy of your library index and lets you download tracks to this PC, so the app still opens and plays your downloaded music when the server is down.

## How it works

1. **Pair once.** Open your server's web page, go to Settings → Apps → Pair a phone, and type the code into the app. The device token is stored in Windows Credential Manager.
2. **Sync.** The app mirrors the server's track list, playlists and likes into a local SQLite database using the server's delta-sync API (`/api/v1/library`).
3. **Download.** Tracks you pick are saved as ordinary tagged audio files in your music folder (default `Music\Downtify`, changeable in Settings).
4. **Offline.** With the server unreachable the app shows the local library and plays downloaded tracks. When the server returns, it syncs quietly.

## Status

| Slice | State |
|-------|-------|
| 1. Scaffold, pairing, library sync, browse | done |
| 2. Download tracks / albums / playlists to the music folder | next |
| 3. Player (local file first, stream when not downloaded) | planned |
| 4. Cover art, lyrics, likes, tray icon | planned |

## Development

Requirements: Node 20+, pnpm, Rust stable, Tauri CLI (`cargo install tauri-cli --version '^2'`), WebView2 (ships with Windows 11).

```bash
pnpm install
cargo tauri dev
```

Build an installer (NSIS) into `src-tauri/target/release/bundle/nsis`:

```bash
cargo tauri build
```

## Layout

- `src/` React frontend (`views/Setup`, `views/Library`, `views/SettingsView`, `api.ts` wraps Tauri commands).
- `src-tauri/src/server.rs` HTTP client for the Downtify client API.
- `src-tauri/src/db.rs` local SQLite library.
- `src-tauri/src/settings.rs` settings JSON and the device token.
- `src-tauri/src/commands.rs` Tauri commands the frontend calls.

Settings live in `%APPDATA%\dev.george.downtify\settings.json`, the library database in `%APPDATA%\dev.george.downtify\library.sqlite`.
