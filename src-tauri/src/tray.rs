//! System tray. The menu is rebuilt whenever the player tells us what is
//! playing, so its labels and checks always match (Play vs Pause, Like vs
//! Unlike, shuffle, repeat, mini vs full). Playback items reach the webview
//! as the same `media-key` event the Windows media keys use; the rest as
//! `tray-action`.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub const TRAY_ID: &str = "main-tray";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// What the menu should reflect; sent by the player.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TrayState {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub has_track: bool,
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub shuffle: bool,
    /// "off" | "all" | "one"
    #[serde(default)]
    pub repeat: String,
    #[serde(default)]
    pub mini: bool,
    #[serde(default)]
    pub online: bool,
}

fn menu_for(app: &AppHandle, s: &TrayState) -> tauri::Result<Menu<Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let now = if s.has_track {
        let line = if s.artist.is_empty() { s.title.clone() } else { format!("{} — {}", s.title, s.artist) };
        // Windows menus treat & as a mnemonic marker; double it to show it.
        line.replace('&', "&&")
    } else {
        "Nothing playing".to_string()
    };
    let now = MenuItem::with_id(app, "now", now, false, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", if s.playing { "Pause" } else { "Play" }, s.has_track, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", s.has_track, None::<&str>)?;
    let prev = MenuItem::with_id(app, "previous", "Previous", s.has_track, None::<&str>)?;
    let like = MenuItem::with_id(app, "like", if s.liked { "Unlike" } else { "Like" }, s.has_track && s.online, None::<&str>)?;
    let shuffle = CheckMenuItem::with_id(app, "shuffle", "Shuffle", true, s.shuffle, None::<&str>)?;
    let r_off = CheckMenuItem::with_id(app, "repeat-off", "Off", true, s.repeat == "off" || s.repeat.is_empty(), None::<&str>)?;
    let r_all = CheckMenuItem::with_id(app, "repeat-all", "All", true, s.repeat == "all", None::<&str>)?;
    let r_one = CheckMenuItem::with_id(app, "repeat-one", "One song", true, s.repeat == "one", None::<&str>)?;
    let repeat = Submenu::with_items(app, "Repeat", true, &[&r_off, &r_all, &r_one])?;
    let shape = MenuItem::with_id(
        app,
        if s.mini { "full" } else { "mini" },
        if s.mini { "Full window" } else { "Mini player" },
        true,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "Show Downtify", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Downtify", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &now,
            &sep()?,
            &play,
            &next,
            &prev,
            &sep()?,
            &like,
            &shuffle,
            &repeat,
            &sep()?,
            &shape,
            &show,
            &settings,
            &sep()?,
            &quit,
        ],
    )
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = menu_for(app, &TrayState::default())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Downtify")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "play" => {
                    let _ = app.emit("media-key", "toggle");
                }
                "next" => {
                    let _ = app.emit("media-key", "next");
                }
                "previous" => {
                    let _ = app.emit("media-key", "previous");
                }
                "show" => show_main(app),
                "settings" => {
                    show_main(app);
                    let _ = app.emit("tray-action", "settings");
                }
                "quit" => {
                    let _ = app.emit("app-quit", ());
                    app.exit(0);
                }
                "now" => {}
                other => {
                    if other == "mini" || other == "full" {
                        show_main(app);
                    }
                    let _ = app.emit("tray-action", other);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuild the menu so it matches the player.
pub fn update(app: &AppHandle, s: &TrayState) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = menu_for(app, s) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Update the tooltip with what's playing.
pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if text.is_empty() { "Downtify" } else { text }));
    }
}
