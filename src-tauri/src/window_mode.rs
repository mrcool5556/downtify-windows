//! Full window <-> mini player: one window, two shapes. The webview (and
//! the audio playing in it) never changes; only size, position, pinning
//! and opacity do. Geometry for each shape is remembered in settings.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::settings::{self, Settings};
use crate::AppState;

pub const MINI_HEIGHT: f64 = 126.0;
pub const MINI_MIN_WIDTH: f64 = 360.0;
pub const MINI_MAX_WIDTH: f64 = 700.0;
pub const FULL_MIN: (f64, f64) = (820.0, 520.0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Current logical bounds of the window.
pub fn current_bounds(win: &WebviewWindow) -> Option<Bounds> {
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?.to_logical::<f64>(scale);
    let size = win.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Bounds { x: pos.x, y: pos.y, w: size.width, h: size.height })
}

/// Remember where the window is for the shape it is currently in.
pub fn remember_bounds(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    if win.is_minimized().unwrap_or(false) || win.is_maximized().unwrap_or(false) {
        return;
    }
    let Some(b) = current_bounds(&win) else { return };
    let state = app.state::<AppState>();
    let mut guard = match state.settings.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.mini {
        guard.mini_bounds = Some(b);
    } else {
        guard.full_bounds = Some(b);
    }
    let _ = settings::save(&state.settings_path, &guard);
    drop(guard);
}

/// Put the window into the shape `settings.mini` says, using the saved
/// geometry for that shape.
pub fn apply(app: &AppHandle, s: &Settings) {
    let Some(win) = main_window(app) else { return };
    if s.mini {
        let b = s.mini_bounds;
        let width = b.map(|b| b.w).unwrap_or(520.0).clamp(MINI_MIN_WIDTH, MINI_MAX_WIDTH);
        let _ = win.unmaximize();
        let _ = win.set_min_size(Some(LogicalSize::new(MINI_MIN_WIDTH, MINI_HEIGHT)));
        let _ = win.set_max_size(Some(LogicalSize::new(MINI_MAX_WIDTH, MINI_HEIGHT)));
        let _ = win.set_size(LogicalSize::new(width, MINI_HEIGHT));
        match b {
            Some(b) => {
                let _ = win.set_position(LogicalPosition::new(b.x, b.y));
            }
            None => {
                // Bottom-right of the monitor the window is on.
                if let Ok(Some(mon)) = win.current_monitor() {
                    let scale = mon.scale_factor();
                    let size = mon.size().to_logical::<f64>(scale);
                    let pos = mon.position().to_logical::<f64>(scale);
                    let _ = win.set_position(LogicalPosition::new(pos.x + size.width - width - 24.0, pos.y + size.height - MINI_HEIGHT - 72.0));
                }
            }
        }
        let _ = win.set_always_on_top(s.mini_pinned);
        set_opacity(&win, s.mini_opacity);
    } else {
        let _ = win.set_max_size(None::<LogicalSize<f64>>);
        let _ = win.set_min_size(Some(LogicalSize::new(FULL_MIN.0, FULL_MIN.1)));
        let _ = win.set_always_on_top(false);
        set_opacity(&win, 100);
        if let Some(b) = s.full_bounds {
            let _ = win.set_size(LogicalSize::new(b.w.max(FULL_MIN.0), b.h.max(FULL_MIN.1)));
            let _ = win.set_position(LogicalPosition::new(b.x, b.y));
        } else {
            let _ = win.set_size(LogicalSize::new(1100.0, 720.0));
            let _ = win.center();
        }
    }
}

/// Window opacity in percent (10..=100) through a layered window.
pub fn set_opacity(win: &WebviewWindow, percent: u8) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{COLORREF, HWND};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED,
        };
        let Ok(h) = win.hwnd() else { return };
        let hwnd = HWND(h.0 as *mut core::ffi::c_void);
        let pct = percent.clamp(10, 100) as u32;
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let layered = WS_EX_LAYERED.0 as isize;
            if pct >= 100 {
                if ex & layered != 0 {
                    let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !layered);
                }
            } else {
                if ex & layered == 0 {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | layered);
                }
                let alpha = ((pct * 255) / 100) as u8;
                let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (win, percent);
    }
}

pub fn opacity_now(app: &AppHandle, percent: u8) {
    if let Some(win) = main_window(app) {
        set_opacity(&win, percent);
    }
}
