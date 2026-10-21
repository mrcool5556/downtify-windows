//! System tray: play/pause, next, show, quit. Button presses reach the
//! webview as the same `media-key` event the Windows media keys use.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_ID: &str = "main-tray";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let play = MenuItem::with_id(app, "play", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Downtify", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&play, &next, &prev, &PredefinedMenuItem::separator(app)?, &show, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Downtify")
        .on_menu_event(|app, event| match event.id().as_ref() {
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
            "quit" => {
                let _ = app.emit("app-quit", ());
                app.exit(0);
            }
            _ => {}
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

/// Update the tooltip with what's playing.
pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if text.is_empty() { "Downtify" } else { text }));
    }
}
