//! Windows System Media Transport Controls: makes the keyboard media
//! keys and the Windows media popup work. WebView2 does not forward
//! `navigator.mediaSession` to Windows, so this bridge does it natively.
//!
//! Button presses are emitted to the webview as a `media-key` event
//! with one of `play`, `pause`, `next`, `previous`, `stop`.

use std::path::Path;

use tauri::{AppHandle, Emitter};
use windows::core::{factory, Ref, Result as WinResult, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
};
use windows::Storage::StorageFile;
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

pub struct Smtc {
    controls: SystemMediaTransportControls,
}

// SystemMediaTransportControls is an agile WinRT object; calling it from
// Tauri's command threads is fine.
unsafe impl Send for Smtc {}
unsafe impl Sync for Smtc {}

pub fn init(app: &AppHandle, hwnd: isize) -> WinResult<Smtc> {
    let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    let controls: SystemMediaTransportControls =
        unsafe { interop.GetForWindow(HWND(hwnd as *mut core::ffi::c_void)) }?;
    controls.SetIsEnabled(true)?;
    controls.SetIsPlayEnabled(true)?;
    controls.SetIsPauseEnabled(true)?;
    controls.SetIsStopEnabled(true)?;
    controls.SetIsNextEnabled(true)?;
    controls.SetIsPreviousEnabled(true)?;
    controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;

    let app = app.clone();
    controls.ButtonPressed(&TypedEventHandler::new(
        move |_sender: Ref<'_, SystemMediaTransportControls>,
              args: Ref<'_, SystemMediaTransportControlsButtonPressedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let button = args.Button()?;
                let name = if button == SystemMediaTransportControlsButton::Play {
                    "play"
                } else if button == SystemMediaTransportControlsButton::Pause {
                    "pause"
                } else if button == SystemMediaTransportControlsButton::Next {
                    "next"
                } else if button == SystemMediaTransportControlsButton::Previous {
                    "previous"
                } else if button == SystemMediaTransportControlsButton::Stop {
                    "stop"
                } else {
                    return Ok(());
                };
                let _ = app.emit("media-key", name);
            }
            Ok(())
        },
    ))?;
    Ok(Smtc { controls })
}

impl Smtc {
    /// Push what is playing to Windows. `status` is `playing`, `paused`
    /// or `stopped`. `thumbnail` is a cached cover file, if any.
    pub fn update(
        &self,
        title: &str,
        artist: &str,
        album: &str,
        status: &str,
        thumbnail: Option<&Path>,
    ) -> WinResult<()> {
        let updater = self.controls.DisplayUpdater()?;
        if status == "stopped" || title.is_empty() {
            updater.ClearAll()?;
            updater.Update()?;
            self.controls.SetPlaybackStatus(MediaPlaybackStatus::Stopped)?;
            return Ok(());
        }
        updater.SetType(MediaPlaybackType::Music)?;
        let music = updater.MusicProperties()?;
        music.SetTitle(&HSTRING::from(title))?;
        music.SetArtist(&HSTRING::from(artist))?;
        music.SetAlbumTitle(&HSTRING::from(album))?;
        let mut thumb_set = false;
        if let Some(p) = thumbnail.filter(|p| p.exists()) {
            if let Ok(file) = StorageFile::GetFileFromPathAsync(&HSTRING::from(p.as_os_str()))
                .and_then(|op| op.join())
            {
                if let Ok(stream) = RandomAccessStreamReference::CreateFromFile(&file) {
                    thumb_set = updater.SetThumbnail(&stream).is_ok();
                }
            }
        }
        if !thumb_set {
            let _ = updater.SetThumbnail(None);
        }
        updater.Update()?;
        self.controls.SetPlaybackStatus(if status == "playing" {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        })?;
        Ok(())
    }
}
