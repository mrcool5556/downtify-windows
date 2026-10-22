//! Updates from GitHub releases, the Toastshot way: list the releases
//! newer than this build (with their notes), download the installer,
//! check it against the SHA-256 digest GitHub publishes for the asset,
//! run it silently and start the new version. No signing key to keep.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub const REPO: &str = "mrcool5556/downtify-windows";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    pub tag: String,
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: String,
    pub prerelease: bool,
    pub installer_url: String,
    pub installer_name: String,
    pub installer_size: u64,
    /// `sha256:<hex>` as GitHub reports it, or empty when it has none.
    pub digest: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheck {
    pub current: String,
    /// Newer than the running build, newest first.
    pub newer: Vec<Release>,
}

fn parse_version(s: &str) -> Vec<u64> {
    s.trim_start_matches('v')
        .split(|c| c == '.' || c == '-')
        .filter_map(|p| p.parse().ok())
        .collect()
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("DowntifyDesktop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

pub async fn check() -> Result<UpdateCheck, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = http()?;
    let resp = client
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=30"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub answered {}", resp.status().as_u16()));
    }
    let list: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let cur = parse_version(&current);
    let mut newer: Vec<Release> = list
        .iter()
        .filter(|r| !r.get("draft").and_then(|d| d.as_bool()).unwrap_or(false))
        .filter_map(|r| {
            let tag = r.get("tag_name")?.as_str()?.to_string();
            let version = tag.trim_start_matches('v').to_string();
            if parse_version(&version) <= cur {
                return None;
            }
            let asset = r
                .get("assets")?
                .as_array()?
                .iter()
                .find(|a| a.get("name").and_then(|n| n.as_str()).map(|n| n.ends_with("-setup.exe")).unwrap_or(false))?;
            Some(Release {
                tag,
                version,
                name: r.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                notes: r.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string(),
                published_at: r.get("published_at").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                prerelease: r.get("prerelease").and_then(|p| p.as_bool()).unwrap_or(false),
                installer_url: asset.get("browser_download_url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
                installer_name: asset.get("name").and_then(|u| u.as_str()).unwrap_or("").to_string(),
                installer_size: asset.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                digest: asset.get("digest").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                html_url: r.get("html_url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect();
    newer.sort_by(|a, b| parse_version(&b.version).cmp(&parse_version(&a.version)));
    Ok(UpdateCheck { current, newer })
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub stage: String,
    pub received: u64,
    pub total: u64,
    pub message: String,
}

fn emit(app: &AppHandle, stage: &str, received: u64, total: u64, message: &str) {
    let _ = app.emit(
        "update-progress",
        UpdateProgress { stage: stage.into(), received, total, message: message.into() },
    );
}

/// Download, verify and run the newest release's installer, then quit so
/// it can replace this copy. The installer starts the new version.
pub async fn install(app: AppHandle, release: Release) -> Result<(), String> {
    if release.installer_url.is_empty() {
        return Err("That release has no installer attached".into());
    }
    let expected = release
        .digest
        .strip_prefix("sha256:")
        .map(|h| h.to_lowercase())
        .ok_or("GitHub has no checksum for this installer, so it won't be run")?;

    let dir: PathBuf = std::env::temp_dir().join("downtify-update");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(&release.installer_name);

    emit(&app, "downloading", 0, release.installer_size, "Downloading");
    let client = http()?;
    let resp = client.get(&release.installer_url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed ({})", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(release.installer_size);
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        emit(&app, "downloading", received, total, "Downloading");
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    emit(&app, "verifying", received, total, "Checking the download");
    let got = format!("{:x}", hasher.finalize());
    if got != expected {
        let _ = tokio::fs::remove_file(&path).await;
        return Err("The download doesn't match GitHub's checksum, so it wasn't installed".into());
    }

    emit(&app, "installing", total, total, "Installing");
    // Hand off to a detached PowerShell: wait for us to exit, run the
    // installer silently, then start the (updated) app at the same path.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = format!(
        "Start-Sleep -Milliseconds 1500; Start-Process -FilePath '{}' -ArgumentList '/S' -Wait; Start-Process -FilePath '{}'",
        path.to_string_lossy().replace('\'', "''"),
        exe.to_string_lossy().replace('\'', "''"),
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0008); // CREATE_NO_WINDOW | DETACHED_PROCESS
    }
    cmd.spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
    emit(&app, "restarting", total, total, "Restarting");
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    app.exit(0);
    Ok(())
}
