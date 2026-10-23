//! Persistent app settings (JSON in the app config dir) and the device
//! token (Windows Credential Manager via `keyring`).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    /// Base address, e.g. `http://nas:8000` (no trailing slash).
    pub server_url: String,
    pub server_id: String,
    pub server_name: String,
    pub username: String,
    pub device_id: String,
    pub device_name: String,
    /// Where downloaded tracks live on this PC.
    pub music_dir: String,
    /// `original` or `opus160` for tracks streamed from the server.
    #[serde(default)]
    pub stream_quality: String,
    /// Download whatever gets played (off by default).
    #[serde(default)]
    pub keep_played: bool,
    /// Closing the window hides to the tray and keeps playing.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Mirror of the autostart registration, for the UI.
    #[serde(default)]
    pub start_with_windows: bool,
    /// Mini player shape instead of the full window.
    #[serde(default)]
    pub mini: bool,
    #[serde(default = "default_true")]
    pub mini_pinned: bool,
    #[serde(default = "default_opacity")]
    pub mini_opacity: u8,
    /// `window` fades everything; `background` keeps text and art solid.
    #[serde(default = "default_opacity_mode")]
    pub mini_opacity_mode: String,
    /// Drop shadow around the full window and around the mini.
    #[serde(default = "default_true")]
    pub window_shadow: bool,
    #[serde(default = "default_true")]
    pub mini_shadow: bool,
    /// The up-next / opacity drawer under the seek bar is open.
    #[serde(default)]
    pub mini_expanded: bool,
    #[serde(default)]
    pub mini_bounds: Option<crate::window_mode::Bounds>,
    #[serde(default)]
    pub full_bounds: Option<crate::window_mode::Bounds>,
}

fn default_opacity() -> u8 {
    100
}
fn default_opacity_mode() -> String {
    "background".into()
}

fn default_true() -> bool {
    true
}

impl Settings {
    pub fn paired(&self) -> bool {
        !self.server_url.is_empty() && !self.device_id.is_empty()
    }
}

pub fn default_music_dir() -> PathBuf {
    directories::UserDirs::new()
        .and_then(|u| u.audio_dir().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Downtify")
}

pub fn load(path: &Path) -> Settings {
    let mut s: Settings = fs::read_to_string(path)
        .ok()
        .and_then(|txt| serde_json::from_str(&txt).ok())
        .unwrap_or_default();
    if s.music_dir.is_empty() {
        s.music_dir = default_music_dir().to_string_lossy().into_owned();
    }
    s
}

pub fn save(path: &Path, s: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let txt = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(path, txt).map_err(|e| e.to_string())
}

const KEYRING_SERVICE: &str = "Downtify Desktop";
const KEYRING_USER: &str = "device-token";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

pub fn load_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn clear_token() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}

const KEYRING_WEB: &str = "web-session";

fn web_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_WEB).map_err(|e| e.to_string())
}

/// The browser-style session used only for playlist editing.
pub fn load_web_session() -> Option<String> {
    web_entry().ok()?.get_password().ok().filter(|s| !s.is_empty())
}

pub fn save_web_session(token: &str) -> Result<(), String> {
    web_entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn clear_web_session() {
    if let Ok(e) = web_entry() {
        let _ = e.delete_credential();
    }
}
