import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Summary, WebStatus, api, fmtWhen, playerApi, playlistsApi } from "../api";
import { DensityPicker, setLayout, useLayout } from "../layout";
import { ThemePage } from "./ThemePage";
import { downloadsApi } from "../downloads";
import { checkForUpdates, fmtMb, installUpdate, useUpdates } from "../updates";

interface Props {
  tab: string;
  setTab: (t: string) => void;
  settings: Settings;
  summary: Summary | null;
  onSettings: (s: Settings) => void;
  onResync: () => void;
  onUnpaired: (s: Settings) => void;
}

const TABS: [string, string][] = [
  ["general", "General"],
  ["theme", "Theme"],
  ["playback", "Playback"],
  ["server", "Server"],
  ["music", "Music folder"],
  ["about", "About"],
];

export function SettingsView({ tab, setTab, settings, summary, onSettings, onResync, onUnpaired }: Props) {
  const [error, setError] = useState("");
  const current = TABS.some(([k]) => k === tab) ? tab : "general";

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        {TABS.map(([k, label]) => (
          <button key={k} className={current === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {current === "general" && <General settings={settings} onSettings={onSettings} setError={setError} setTab={setTab} />}
        {current === "theme" && <ThemePage settings={settings} onSettings={onSettings} />}
        {current === "playback" && <Playback settings={settings} onSettings={onSettings} setError={setError} />}
        {current === "server" && <Server settings={settings} summary={summary} onResync={onResync} onUnpaired={onUnpaired} setError={setError} />}
        {current === "music" && <Music settings={settings} onSettings={onSettings} setError={setError} />}
        {current === "about" && <About setError={setError} />}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

type Sub = { settings: Settings; onSettings: (s: Settings) => void; setError: (s: string) => void };

function General({ settings, onSettings, setError, setTab }: Sub & { setTab: (t: string) => void }) {
  const layout = useLayout();
  return (
    <>
      <section className="card">
        <h2>Look</h2>
        <div className="setting-row">
          <span>Colours and button style</span>
          <button className="small" onClick={() => setTab("theme")}>
            Open Theme…
          </button>
        </div>
        <div className="setting-row">
          <span>Song lists</span>
          <DensityPicker />
        </div>
        <label className="check">
          <input type="checkbox" checked={layout.rowArt} onChange={(e) => setLayout({ rowArt: e.target.checked })} />
          Show cover art in song rows
        </label>
        <label className="check" title="Only matters on an admin account: the server sends admins every user's playlist">
          <input type="checkbox" checked={layout.showOthersPlaylists} onChange={(e) => setLayout({ showOthersPlaylists: e.target.checked })} />
          Show other users' playlists in an "Other users" section (admin accounts)
        </label>
      </section>
      <section className="card">
        <h2>Window</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.close_to_tray}
            onChange={(e) =>
              invoke<Settings>("set_close_to_tray", { on: e.target.checked })
                .then(onSettings)
                .catch((err) => setError(String(err)))
            }
          />
          Closing the window keeps Downtify running in the tray (music keeps playing)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.start_with_windows}
            onChange={(e) =>
              invoke<Settings>("set_start_with_windows", { on: e.target.checked })
                .then(onSettings)
                .catch((err) => setError(String(err)))
            }
          />
          Start Downtify when Windows starts
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.window_shadow}
            onChange={(e) =>
              invoke<Settings>("set_window_shadow", { mini: false, on: e.target.checked })
                .then(onSettings)
                .catch((err) => setError(String(err)))
            }
          />
          Shadow around the window
        </label>
        <p className="hint">Quit for real from the tray icon's menu.</p>
      </section>
    </>
  );
}

function Playback({ settings, onSettings, setError }: Sub) {
  return (
    <>
      <section className="card">
        <h2>Streaming quality</h2>
        <p className="hint">Downloaded tracks always play from disk. This only affects songs streamed from the server.</p>
        <label className="check">
          <input type="radio" name="quality" checked={settings.stream_quality !== "opus160"} onChange={() => playerApi.setStreamQuality("original").then(onSettings).catch((e) => setError(String(e)))} />
          Original quality (best at home)
        </label>
        <label className="check">
          <input type="radio" name="quality" checked={settings.stream_quality === "opus160"} onChange={() => playerApi.setStreamQuality("opus160").then(onSettings).catch((e) => setError(String(e)))} />
          Smaller stream, Opus 160 kbps (away from home)
        </label>
      </section>
      <section className="card">
        <h2>Keep what I play</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.keep_played}
            onChange={(e) =>
              downloadsApi
                .setKeepPlayed(e.target.checked)
                .then((s) => onSettings(s as Settings))
                .catch((err) => setError(String(err)))
            }
          />
          Download every song to this PC when it starts playing
        </label>
      </section>
    </>
  );
}

function Server({
  settings,
  summary,
  onResync,
  onUnpaired,
  setError,
}: {
  settings: Settings;
  summary: Summary | null;
  onResync: () => void;
  onUnpaired: (s: Settings) => void;
  setError: (s: string) => void;
}) {
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [web, setWeb] = useState<WebStatus | null>(null);
  const [cred, setCred] = useState({ username: settings.username, password: "" });
  const [signing, setSigning] = useState(false);
  useEffect(() => {
    playlistsApi.webStatus().then(setWeb).catch(() => setWeb({ signed_in: false, username: "" }));
  }, []);
  async function signIn() {
    setSigning(true);
    setError("");
    try {
      setWeb(await playlistsApi.webSignIn(cred.username, cred.password));
      setCred((c) => ({ ...c, password: "" }));
    } catch (e) {
      setError(String(e));
    } finally {
      setSigning(false);
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
    <>
      <section className="card">
        <h2>Server</h2>
        <dl>
          <dt>Name</dt>
          <dd>{settings.server_name || "–"}</dd>
          <dt>Address</dt>
          <dd>{settings.server_url}</dd>
          <dt>Paired as</dt>
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
        <h2>Playlist editing</h2>
        <p className="hint">
          Creating, renaming, sharing and editing playlists needs a signed-in account on the server, not just the pairing. Sign in once here; the session lasts 30 days from its last use and
          the app keeps only the session, never the password.
        </p>
        {web?.signed_in ? (
          <div className="row">
            <span>
              Signed in as <b>{web.username}</b>
            </span>
            <button className="ghost" onClick={() => playlistsApi.webSignOut().then(setWeb)}>
              Forget sign-in
            </button>
          </div>
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            <input placeholder="Username" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} autoComplete="username" />
            <input placeholder="Password" type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} autoComplete="current-password" />
            <button className="primary" type="submit" disabled={signing || !cred.username || !cred.password}>
              {signing ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}

function Music({ settings, onSettings, setError }: Sub) {
  async function chooseFolder() {
    setError("");
    try {
      const picked = await open({ directory: true, multiple: false, defaultPath: settings.music_dir, title: "Choose where to keep your music" });
      if (typeof picked === "string") onSettings(await api.setMusicDir(picked));
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="card">
      <h2>Music folder</h2>
      <p className="hint">Downloaded tracks are saved here as ordinary tagged files, in the same folders as on the server, so other players can use them too.</p>
      <code className="path">{settings.music_dir}</code>
      <div className="row">
        <button onClick={chooseFolder}>Change folder…</button>
        <button className="ghost" onClick={() => openPath(settings.music_dir).catch((e) => setError(String(e)))}>
          Open in Explorer
        </button>
        {settings.music_dir !== settings.default_music_dir && (
          <button className="ghost" onClick={() => api.setMusicDir(settings.default_music_dir).then(onSettings).catch((e) => setError(String(e)))}>
            Use default
          </button>
        )}
      </div>
    </section>
  );
}

function About({ setError }: { setError: (s: string) => void }) {
  const u = useUpdates();
  const latest = u.newer[0];
  useEffect(() => {
    if (!u.checkedAt && !u.checking) checkForUpdates();
  }, [u.checkedAt, u.checking]);
  useEffect(() => {
    if (u.error) setError(u.error);
  }, [u.error, setError]);
  const pct = u.progress && u.progress.total > 0 ? Math.round((u.progress.received / u.progress.total) * 100) : 0;
  return (
    <>
      <section className="card about">
        <div className="about-head">
          <span className="logo big" aria-hidden>
            ♫
          </span>
          <div>
            <h2>Downtify for Windows</h2>
            <div className="hint">Version {u.current || "…"}</div>
          </div>
          <div className="about-update">
            {u.progress ? (
              <div className="upd-progress" title={u.progress.message}>
                <div className="upd-bar">
                  <div className="upd-bar-fill" style={{ width: `${u.progress.stage === "downloading" ? pct : 100}%` }} />
                </div>
                <small>
                  {u.progress.message}
                  {u.progress.stage === "downloading" && u.progress.total ? ` ${fmtMb(u.progress.received)} / ${fmtMb(u.progress.total)}` : ""}
                </small>
              </div>
            ) : latest ? (
              <button className="primary" onClick={() => installUpdate(latest)} title={`Download ${latest.installer_name} (${fmtMb(latest.installer_size)}), check it against GitHub's checksum, install and restart`}>
                Update to {latest.version}
              </button>
            ) : (
              <span className="pill ok">{u.checking ? "Checking…" : u.checkedAt ? "Up to date" : "–"}</span>
            )}
            <button className="ghost small" onClick={checkForUpdates} disabled={u.checking || !!u.progress}>
              Check again
            </button>
          </div>
        </div>
        {latest && !u.progress && (
          <p className="hint" style={{ marginTop: 10 }}>
            The update downloads from GitHub, is checked against the checksum GitHub publishes for it, installs silently and restarts Downtify. Your settings, library and downloads stay.
          </p>
        )}
      </section>

      {u.newer.length > 0 && (
        <section className="card">
          <h2>What's new since {u.current}</h2>
          {u.newer.map((r) => (
            <div key={r.tag} className="release">
              <div className="release-head">
                <b>{r.version}</b>
                {r.prerelease && <span className="pill">preview</span>}
                <small>{r.published_at ? new Date(r.published_at).toLocaleDateString() : ""}</small>
              </div>
              <Notes text={r.notes} />
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="setting-row">
          <div>
            <b>Source code</b>
            <div className="hint">AGPL-3.0, on GitHub.</div>
          </div>
          <button onClick={() => openUrl("https://github.com/mrcool5556/downtify-windows")}>GitHub</button>
        </div>
        <div className="setting-row">
          <div>
            <b>Downtify server</b>
            <div className="hint">The server this app talks to, and its docs.</div>
          </div>
          <button onClick={() => openUrl("https://github.com/henriquesebastiao/downtify")}>Downtify</button>
        </div>
      </section>
    </>
  );
}

/** Release notes are Markdown; render the subset we write: paragraphs, bullets, bold. */
function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: JSX.Element[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    if (/^[-*] /.test(line)) {
      bullets.push(line.slice(2));
      return;
    }
    flush();
    if (/^#+ /.test(line)) out.push(<h4 key={i}>{inline(line.replace(/^#+ /, ""))}</h4>);
    else out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="notes">{out}</div>;
}

function inline(s: string): (string | JSX.Element)[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}
