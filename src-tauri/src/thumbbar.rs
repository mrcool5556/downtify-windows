//! Taskbar thumbnail buttons: Back, Play/Pause and Forward under the
//! window preview that shows when you hover Downtify on the taskbar.
//!
//! Clicks are sent to the webview as the same `media-key` event the
//! keyboard media keys use (`previous`, `toggle`, `next`). Every call
//! here runs on the window's own (main) thread, which owns the COM object.

use std::cell::RefCell;
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_ENABLED, THBN_CLICKED,
    THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, GetSystemMetrics, RegisterWindowMessageW, HICON, ICONINFO, SM_CXSMICON,
    WM_COMMAND,
};

const ID_PREV: u32 = 1;
const ID_PLAY: u32 = 2;
const ID_NEXT: u32 = 3;

static APP: OnceLock<AppHandle> = OnceLock::new();
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();

struct Bar {
    hwnd: HWND,
    list: ITaskbarList3,
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
    playing: bool,
}

thread_local! {
    static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
}

/// Set up the buttons for the main window. Call on the main thread.
pub fn init(app: &AppHandle, hwnd: isize) -> windows::core::Result<()> {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    let _ = APP.set(app.clone());
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let list: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
        list.HrInit()?;
        let _ = TASKBAR_CREATED.set(RegisterWindowMessageW(w!("TaskbarButtonCreated")));
        let size = GetSystemMetrics(SM_CXSMICON).max(16);
        let color = glyph_color();
        let bar = Bar {
            hwnd,
            list,
            prev: make_icon(size, color, prev_shape)?,
            play: make_icon(size, color, play_shape)?,
            pause: make_icon(size, color, pause_shape)?,
            next: make_icon(size, color, next_shape)?,
            playing: false,
        };
        BAR.with(|b| *b.borrow_mut() = Some(bar));
        // Windows tells the window when its taskbar button (re)appears:
        // at first show, after hiding to the tray, after Explorer restarts.
        let _ = SetWindowSubclass(hwnd, Some(subclass), 0x7468_6d62, 0);
        // The button may already exist (window shown before setup ran).
        add_buttons();
    }
    Ok(())
}

/// Swap the middle button between Play and Pause. Call on the main thread.
pub fn set_playing(playing: bool) {
    BAR.with(|b| {
        if let Some(bar) = b.borrow_mut().as_mut() {
            if bar.playing != playing {
                bar.playing = playing;
                let buttons = [middle(bar)];
                unsafe {
                    let _ = bar.list.ThumbBarUpdateButtons(bar.hwnd, &buttons);
                }
            }
        }
    });
}

fn add_buttons() {
    BAR.with(|b| {
        if let Some(bar) = b.borrow().as_ref() {
            let buttons = [
                button(ID_PREV, bar.prev, "Previous"),
                middle(bar),
                button(ID_NEXT, bar.next, "Next"),
            ];
            unsafe {
                // Fails harmlessly if the taskbar button isn't there yet;
                // TaskbarButtonCreated brings us back here when it is.
                let _ = bar.list.ThumbBarAddButtons(bar.hwnd, &buttons);
            }
        }
    });
}

fn middle(bar: &Bar) -> THUMBBUTTON {
    if bar.playing {
        button(ID_PLAY, bar.pause, "Pause")
    } else {
        button(ID_PLAY, bar.play, "Play")
    }
}

fn button(id: u32, icon: HICON, tip: &str) -> THUMBBUTTON {
    let mut b = THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        hIcon: icon,
        dwFlags: THBF_ENABLED,
        ..Default::default()
    };
    for (i, c) in tip.encode_utf16().take(259).enumerate() {
        b.szTip[i] = c;
    }
    b
}

unsafe extern "system" fn subclass(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if Some(&msg) == TASKBAR_CREATED.get() {
        add_buttons();
    } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
        let key = match (wparam.0 & 0xffff) as u32 {
            ID_PREV => Some("previous"),
            ID_PLAY => Some("toggle"),
            ID_NEXT => Some("next"),
            _ => None,
        };
        if let (Some(key), Some(app)) = (key, APP.get()) {
            let _ = app.emit("media-key", key);
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// White glyphs on a dark taskbar, near-black on a light one.
fn glyph_color() -> [u8; 3] {
    let mut v: u32 = 0;
    let mut n = 4u32;
    let light = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("SystemUsesLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut v as *mut u32 as *mut _),
            Some(&mut n),
        )
        .is_ok()
            && v == 1
    };
    if light {
        [0x1b, 0x1b, 0x1b]
    } else {
        [0xff, 0xff, 0xff]
    }
}

// Shapes in a 0..1 square; true where the glyph is filled.
fn tri(x: f32, y: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
    let s = |p: (f32, f32), q: (f32, f32)| (x - q.0) * (p.1 - q.1) - (p.0 - q.0) * (y - q.1);
    let (d1, d2, d3) = (s(a, b), s(b, c), s(c, a));
    let neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(neg && pos)
}
fn rect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> bool {
    x >= x0 && x <= x1 && y >= y0 && y <= y1
}
fn play_shape(x: f32, y: f32) -> bool {
    tri(x, y, (0.25, 0.14), (0.25, 0.86), (0.85, 0.5))
}
fn pause_shape(x: f32, y: f32) -> bool {
    rect(x, y, 0.22, 0.16, 0.41, 0.84) || rect(x, y, 0.59, 0.16, 0.78, 0.84)
}
fn next_shape(x: f32, y: f32) -> bool {
    tri(x, y, (0.16, 0.18), (0.16, 0.82), (0.68, 0.5)) || rect(x, y, 0.70, 0.18, 0.84, 0.82)
}
fn prev_shape(x: f32, y: f32) -> bool {
    next_shape(1.0 - x, y)
}

/// Draw a glyph (4x4 supersampled for smooth edges) into a 32-bit icon.
unsafe fn make_icon(size: i32, rgb: [u8; 3], shape: fn(f32, f32) -> bool) -> windows::core::Result<HICON> {
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: size,
        biHeight: -size, // top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let color = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
    let px = std::slice::from_raw_parts_mut(bits as *mut u8, (size * size * 4) as usize);
    const SS: i32 = 4;
    for py in 0..size {
        for pxi in 0..size {
            let mut hit = 0;
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = (pxi as f32 + (sx as f32 + 0.5) / SS as f32) / size as f32;
                    let y = (py as f32 + (sy as f32 + 0.5) / SS as f32) / size as f32;
                    if shape(x, y) {
                        hit += 1;
                    }
                }
            }
            let a = (hit * 255 / (SS * SS)) as u8;
            let i = ((py * size + pxi) * 4) as usize;
            px[i] = rgb[2];
            px[i + 1] = rgb[1];
            px[i + 2] = rgb[0];
            px[i + 3] = a;
        }
    }
    let mask = CreateBitmap(size, size, 1, 1, None);
    let icon = CreateIconIndirect(&ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    });
    let _ = DeleteObject(color.into());
    let _ = DeleteObject(mask.into());
    icon
}
