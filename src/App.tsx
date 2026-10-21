import { useCallback, useEffect, useState } from "react";
import { api, playerApi, Settings, ServerStatus, Summary } from "./api";
import { Setup } from "./views/Setup";
import { Library } from "./views/Library";
import { SettingsView } from "./views/SettingsView";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { player } from "./player/store";
import { usePlayer } from "./player/usePlayer";
import { likeBus } from "./likeBus";

type Page = "library" | "settings";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState<Page>("library");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [libraryVersion, setLibraryVersion] = useState(0);
  const { queueOpen, current } = usePlayer();

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await api.librarySummary());
    } catch {
      /* no library yet */
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      setStatus(await api.serverStatus());
    } catch (e) {
      setStatus({ online: false, paired: true, detail: String(e), user: null });
    }
  }, []);

  const sync = useCallback(
    async (refresh = false) => {
      setSyncing(true);
      setNotice("");
      try {
        const r = await api.syncLibrary(refresh);
        setSummary(r.summary);
        setLibraryVersion((v) => v + 1);
        setNotice(
          r.full
            ? `Full sync: ${r.summary.tracks} tracks, ${r.playlists} playlists`
            : r.upserted + r.deleted === 0
              ? "Library is up to date"
              : `Synced: ${r.upserted} updated, ${r.deleted} removed`,
        );
        setStatus((s) => (s ? { ...s, online: true } : s));
      } catch (e) {
        setNotice(`Sync failed: ${e}`);
        await checkStatus();
      } finally {
        setSyncing(false);
      }
    },
    [checkStatus],
  );

  // Boot: load settings; if paired, show the local library at once and
  // restore the player, then probe the server and sync in the background.
  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      if (s.paired) {
        await refreshSummary();
        player.restore();
        await checkStatus();
      }
    })();
  }, [refreshSummary, checkStatus]);

  useEffect(() => {
    if (settings?.paired && status?.online) {
      sync(false);
      playerApi.flushListens().catch(() => {});
    }
    // only when we first learn the server is online
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.paired, status?.online]);

  // Re-probe the server every 30 s so the badge recovers after an outage.
  useEffect(() => {
    if (!settings?.paired) return;
    const t = setInterval(checkStatus, 30_000);
    return () => clearInterval(t);
  }, [settings?.paired, checkStatus]);

  // Keyboard shortcuts.
  const online = !!status?.online;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPage("library");
        setTimeout(() => document.getElementById("library-search")?.focus(), 0);
        return;
      }
      if (typing && !(el instanceof HTMLInputElement && el.type === "range")) return;
      if (e.key === " ") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft" && e.ctrlKey) {
        e.preventDefault();
        player.previous();
      } else if (e.key === "ArrowRight" && e.ctrlKey) {
        e.preventDefault();
        player.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        player.seekBy(-5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        player.seekBy(5);
      } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const t = player.getSnapshot().current;
        if (t && online) playerApi.setLike(t.id, !t.liked).then((liked) => likeBus.emit(t.id, liked)).catch(() => {});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [online]);

  // Window title follows the song.
  useEffect(() => {
    document.title = current ? `${current.title} — ${current.artist} · Downtify` : "Downtify";
  }, [current?.id, current?.title, current?.artist]);

  if (!settings) return <div className="boot">Loading…</div>;

  if (!settings.paired) {
    return (
      <Setup
        onPaired={(s) => {
          setSettings(s);
          setStatus({ online: true, paired: true, detail: "", user: { username: s.username } });
        }}
      />
    );
  }

  const unpairedRemotely = status && status.online && !status.paired;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ♫
          </span>
          <span>Downtify</span>
          <span className="server-name">{settings.server_name || settings.server_url}</span>
        </div>
        <nav className="tabs">
          <button className={page === "library" ? "active" : ""} onClick={() => setPage("library")}>
            Library
          </button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
            Settings
          </button>
        </nav>
        <div className="status">
          <span className={`dot ${online ? "on" : "off"}`} />
          <span>{online ? "Online" : "Offline"}</span>
          <button className="ghost" disabled={!online || syncing} onClick={() => sync(false)} title="Sync library">
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </header>

      {unpairedRemotely && (
        <div className="banner warn">
          This PC was unpaired on the server. Your downloaded files still play.{" "}
          <button className="link" onClick={() => setPage("settings")}>
            Pair again
          </button>
        </div>
      )}
      {!online && status && (
        <div className="banner muted">
          Server unreachable ({status.detail || "offline"}). Showing your local library; downloaded tracks play as normal.
        </div>
      )}
      {notice && <div className="banner info">{notice}</div>}

      <main className="content">
        {page === "library" ? (
          <Library key={libraryVersion} online={online} summary={summary} />
        ) : (
          <SettingsView
            settings={settings}
            summary={summary}
            onSettings={setSettings}
            onResync={() => sync(true)}
            onUnpaired={(s) => {
              setSettings(s);
              setSummary(null);
              setStatus(null);
            }}
          />
        )}
        {queueOpen && <QueuePanel />}
      </main>

      <PlayerBar
        online={online}
        onReveal={() => {
          setPage("library");
          player.reveal();
        }}
      />
    </div>
  );
}
