//! HTTP client for the Downtify client API (`api_version` 1).
//! See docs/mobile-client-contract.md in the Downtify repo.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const KNOWN_API_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    #[serde(default)]
    pub server_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub api_version: i64,
    #[serde(default)]
    pub require_sign_in: bool,
    #[serde(default)]
    pub capabilities: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairResponse {
    pub token: String,
    pub device: PairDevice,
    #[serde(default)]
    pub server: PairServer,
    #[serde(default)]
    pub user: PairUser,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PairDevice {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PairServer {
    #[serde(default)]
    pub server_id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PairUser {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibraryResponse {
    pub cursor: i64,
    #[serde(default)]
    pub full: bool,
    #[serde(default)]
    pub tracks: Vec<Value>,
    #[serde(default)]
    pub deleted: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub name: String,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub manual: bool,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub track_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Likes {
    #[serde(default)]
    track_ids: Vec<String>,
}

/// Accept what the user typed and turn it into a base URL.
pub fn normalize_base(input: &str) -> String {
    let mut s = input.trim().to_string();
    if s.is_empty() {
        return s;
    }
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("http://{s}");
    }
    while s.ends_with('/') {
        s.pop();
    }
    s
}

fn http(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(timeout)
        .user_agent(concat!("DowntifyDesktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

async fn read_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let detail = body
        .get("detail")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| status.canonical_reason().unwrap_or("error").to_string());
    format!("{} ({})", detail, status.as_u16())
}

fn friendly_net(e: &reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Server unreachable".to_string()
    } else {
        e.to_string()
    }
}

/// `GET /api/server/info`: public, no credentials.
pub async fn info(base: &str) -> Result<ServerInfo, String> {
    let client = http(Duration::from_secs(6))?;
    let resp = client
        .get(format!("{base}/api/server/info"))
        .send()
        .await
        .map_err(|e| friendly_net(&e))?;
    if !resp.status().is_success() {
        return Err(read_error(resp).await);
    }
    let info: ServerInfo = resp.json().await.map_err(|e| e.to_string())?;
    if info.product != "Downtify" {
        return Err("That address is not a Downtify server".into());
    }
    if info.api_version > KNOWN_API_VERSION {
        return Err(format!(
            "Server speaks API v{}, this app knows v{}. Update the app.",
            info.api_version, KNOWN_API_VERSION
        ));
    }
    Ok(info)
}

/// `POST /api/auth/pair`: trade a pairing code for a device token.
pub async fn pair(base: &str, code: &str, device_name: &str) -> Result<PairResponse, String> {
    let client = http(Duration::from_secs(10))?;
    let resp = client
        .post(format!("{base}/api/auth/pair"))
        .json(&serde_json::json!({
            "code": code,
            "device_name": device_name,
            "platform": "windows",
        }))
        .send()
        .await
        .map_err(|e| friendly_net(&e))?;
    if !resp.status().is_success() {
        return Err(read_error(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

pub const SESSION_COOKIE: &str = "downtify_session";

/// `POST /api/auth/login`: a browser-style session for the routes a
/// device token may not call (playlist editing). Returns the session
/// token from the Set-Cookie header and the user's name.
pub async fn login(base: &str, username: &str, password: &str) -> Result<(String, String), String> {
    let client = http(Duration::from_secs(10))?;
    let resp = client
        .post(format!("{base}/api/auth/login"))
        .header("Origin", base)
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|e| friendly_net(&e))?;
    if !resp.status().is_success() {
        return Err(read_error(resp).await);
    }
    let mut session = String::new();
    for value in resp.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(s) = value.to_str() {
            if let Some(rest) = s.strip_prefix(&format!("{SESSION_COOKIE}=")) {
                session = rest.split(';').next().unwrap_or("").to_string();
            }
        }
    }
    if session.is_empty() {
        return Err("Server did not return a session".into());
    }
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let user = body
        .get("user")
        .and_then(|u| u.get("username"))
        .and_then(|u| u.as_str())
        .unwrap_or(username)
        .to_string();
    Ok((session, user))
}

#[derive(Debug)]
pub enum ApiError {
    /// 401: the device was unpaired or the token is wrong.
    Unpaired,
    Offline,
    Other(String),
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> String {
        match e {
            ApiError::Unpaired => "This device is no longer paired".into(),
            ApiError::Offline => "Server unreachable".into(),
            ApiError::Other(s) => s,
        }
    }
}

/// An authenticated client for one paired server.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Client {
    pub fn new(base: &str, token: &str) -> Result<Self, String> {
        Ok(Self {
            http: http(Duration::from_secs(90))?,
            base: base.to_string(),
            token: token.to_string(),
        })
    }

    /// A request as the signed-in browser session (playlist editing).
    /// The server refuses unsafe methods without a same-origin header.
    pub async fn web_json(
        &self,
        session: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ApiError> {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .header(reqwest::header::COOKIE, format!("{SESSION_COOKIE}={session}"))
            .header("Origin", &self.base)
            .header("Referer", format!("{}/", self.base));
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                ApiError::Offline
            } else {
                ApiError::Other(e.to_string())
            }
        })?;
        if resp.status().as_u16() == 401 {
            return Err(ApiError::Unpaired);
        }
        if !resp.status().is_success() {
            return Err(ApiError::Other(read_error(resp).await));
        }
        Ok(resp.json().await.unwrap_or(Value::Null))
    }

    pub fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let resp = self.get(path).send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                ApiError::Offline
            } else {
                ApiError::Other(e.to_string())
            }
        })?;
        if resp.status().as_u16() == 401 {
            return Err(ApiError::Unpaired);
        }
        if !resp.status().is_success() {
            return Err(ApiError::Other(read_error(resp).await));
        }
        resp.json().await.map_err(|e| ApiError::Other(e.to_string()))
    }

    /// POST or PUT a JSON body; returns the JSON reply (or Null).
    pub async fn send_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &Value,
    ) -> Result<Value, ApiError> {
        let resp = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    ApiError::Offline
                } else {
                    ApiError::Other(e.to_string())
                }
            })?;
        if resp.status().as_u16() == 401 {
            return Err(ApiError::Unpaired);
        }
        if !resp.status().is_success() {
            return Err(ApiError::Other(read_error(resp).await));
        }
        Ok(resp.json().await.unwrap_or(Value::Null))
    }

    /// `POST /api/v1/sign`: URLs a headerless player (the audio element)
    /// can fetch. Returns full URLs.
    pub async fn sign(&self, items: Vec<Value>, ttl: u64) -> Result<Vec<String>, ApiError> {
        let v = self
            .send_json(
                reqwest::Method::POST,
                "/api/v1/sign",
                &serde_json::json!({ "items": items, "ttl": ttl }),
            )
            .await?;
        Ok(v
            .get("urls")
            .and_then(|u| u.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.as_str())
                    .map(|u| format!("{}{}", self.base, u))
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn library(&self, since: i64, refresh: bool) -> Result<LibraryResponse, ApiError> {
        let path = format!(
            "/api/v1/library?since={since}{}",
            if refresh { "&refresh=true" } else { "" }
        );
        self.get_json(&path).await
    }

    pub async fn playlists(&self) -> Result<Vec<Playlist>, ApiError> {
        self.get_json("/api/v1/playlists").await
    }

    pub async fn likes(&self) -> Result<Vec<String>, ApiError> {
        let l: Likes = self.get_json("/api/v1/likes").await?;
        Ok(l.track_ids)
    }

    /// Cheap "am I still paired?" check; also tells us the server is up.
    pub async fn auth_status(&self) -> Result<Value, ApiError> {
        self.get_json("/api/auth/status").await
    }
}
