import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Settings, Summary, api, fmtWhen, playerApi } from "../api";

interface Props {
  settings: Settings;
  summary: Summary | null;
  onSettings: (s: Settings) => void;
  onResync: () => void;
  onUnpaired: (s: Settings) => void;
}

export function SettingsView({ settings, summary, onSettings, onResync, onUnpaired }: Props) {
  const [error, setError] = useState("");
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  async function chooseFolder() {
    setError("");
    try {
      const picked = await open({ directory: true, multiple: false, defaultPath: settings.music_dir, title: "Choose where to keep your music" });
      if (typeof picked === "string") onSettings(await api.setMusicDir(picked));
    } catch (e) {
      setError(String(e));
    }
  }

  async function resetFolder() {
    setError("");
    try {
      onSettings(await api.setMusicDir(settings.default_music_dir));
    } catch (e) {
      setError(String(e));
    }
  }

  async function unpair() {
    setError("");
    try {
      onUnpaired(await api.unpair());
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Server</h2>
        <dl>
          <dt>Name</dt>
          <dd>{settings.server_name || "–"}</dd>
          <dt>Address</dt>
          <dd>{settings.server_url}</dd>
          <dt>Signed in as</dt>
          <dd>{settings.username || "–"}</dd>
          <dt>This device</dt>
          <dd>{settings.device_name || "–"}</dd>
          <dt>Last sync</dt>
          <dd>{summary ? fmtWhen(summary.last_sync) : "never"}</dd>
        </dl>
        <div className="row">
          <button onClick={onResync}>Rescan server library</button>
          {!confirmUnpair ? (
            <button className="danger ghost" onClick={() => setConfirmUnpair(true)}>
              Unpair this PC
            </button>
          ) : (
            <span className="row">
              <span>Forget the server and clear the index? Downloaded files stay on disk.</span>
              <button className="danger" onClick={unpair}>
                Yes, unpair
              </button>
              <button className="ghost" onClick={() => setConfirmUnpair(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Music folder</h2>
        <p className="hint">Downloaded tracks are saved here as ordinary tagged files, so other players can use them too.</p>
        <code className="path">{settings.music_dir}</code>
        <div className="row">
          <button onClick={chooseFolder}>Change folder…</button>
          <button className="ghost" onClick={() => openPath(settings.music_dir).catch((e) => setError(String(e)))}>
            Open in Explorer
          </button>
          {settings.music_dir !== settings.default_music_dir && (
            <button className="ghost" onClick={resetFolder}>
              Use default
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Playback</h2>
        <p className="hint">Downloaded tracks always play from disk. This only affects songs streamed from the server.</p>
        <label className="check">
          <input
            type="radio"
            name="quality"
            checked={settings.stream_quality !== "opus160"}
            onChange={() => playerApi.setStreamQuality("original").then(onSettings).catch((e) => setError(String(e)))}
          />
          Original quality (best at home)
        </label>
        <label className="check">
          <input
            type="radio"
            name="quality"
            checked={settings.stream_quality === "opus160"}
            onChange={() => playerApi.setStreamQuality("opus160").then(onSettings).catch((e) => setError(String(e)))}
          />
          Smaller stream, Opus 160 kbps (away from home)
        </label>
        <p className="hint" style={{ marginTop: 12 }}>
          Shortcuts: Space play/pause · ← → seek 5 s · Ctrl+← Ctrl+→ previous/next · Ctrl+F search · Ctrl+L like · scroll on volume ±2
        </p>
      </section>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
