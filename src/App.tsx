import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, fmtAgo, fmtWhen, playerApi, Settings, ServerStatus, Summary } from "./api";
import { Setup } from "./views/Setup";
import { Library } from "./views/Library";
import { SettingsView } from "./views/SettingsView";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { player } from "./player/store";
import { usePlayer } from "./player/usePlayer";
import { likeBus } from "./likeBus";
import { localBus } from "./downloads";
import { nav, useNav } from "./nav";
import { ThemeToggle, useLayout } from "./layout";
import { WindowControls } from "./components/WindowControls";
import { MiniPlayer } from "./components/MiniPlayer";

const LIST_SECTIONS = new Set(["tracks", "albums", "playlists"]);

function looksLikeLink(s: string) {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  const { queueOpen, current } = usePlayer();
  const { view, canBack, canForward } = useNav();
  const layout = useLayout();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

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
        if (r.full) setNotice(`Full sync: ${r.summary.tracks} tracks, ${r.playlists} playlists`);
        else if (r.upserted + r.deleted > 0) setNotice(`Synced: ${r.upserted} updated, ${r.deleted} removed`);
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

  useEffect(() => localBus.on(() => refreshSummary()), [refreshSummary]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!settings?.paired) return;
    const t = setInterval(checkStatus, 30_000);
    return () => clearInterval(t);
  }, [settings?.paired, checkStatus]);

  // The search box mirrors the current list view's filter.
  useEffect(() => {
    if (LIST_SECTIONS.has(view.section)) setQuery(view.search);
    else if (!looksLikeLink(query)) setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function onQuery(q: string) {
    setQuery(q);
    if (looksLikeLink(q)) return;
    const onSongs = view.section === "tracks";
    const onScopedList = LIST_SECTIONS.has(view.section) && ("album" in view.scope || "playlist" in view.scope);
    if (onSongs || onScopedList) {
      nav.replace({ ...view, search: q });
    } else if (q.trim()) {
      nav.push({ section: "tracks", scope: {}, search: q });
    }
  }

  async function onSearchEnter() {
    if (!looksLikeLink(query)) return;
    try {
      await invoke("request_download", { url: query.trim() });
      setNotice("Sent to the server. It will show up after the next sync.");
      setQuery("");
    } catch (e) {
      setNotice(`Server refused the link: ${e}`);
    }
  }

  const online = !!status?.online;

  const setMini = useCallback((on: boolean) => {
    invoke<Settings>("set_mini", { on }).then(setSettings).catch(() => {});
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.ctrlKey && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setMini(!(settings?.mini ?? false));
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        nav.back();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        nav.forward();
        return;
      }
      if (typing && !(el instanceof HTMLInputElement && el.type === "range")) {
        if (e.key === "Escape" && el === searchRef.current) searchRef.current?.blur();
        return;
      }
      if (e.key === "?") {
        setShortcuts((s) => !s);
      } else if (e.key === " ") {
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
    // Mouse side buttons: ours, never the webview's own history.
    function onMouse(e: MouseEvent) {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "mouseup") {
          if (e.button === 3) nav.back();
          else nav.forward();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("auxclick", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("auxclick", onMouse, true);
    };
  }, [online, settings?.mini, setMini]);

  // Safety net: if the webview ever navigates its own history, stay put.
  useEffect(() => {
    history.pushState(null, "", location.href);
    const onPop = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Only the mini needs a see-through window; the full one paints solid.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-mini", !!settings?.mini);
  }, [settings?.mini]);

  // Window title and tray tooltip follow the song.
  useEffect(() => {
    const text = current ? `${current.title} — ${current.artist}` : "";
    document.title = current ? `${text} · Downtify` : "Downtify";
    invoke("set_tray_tooltip", { text }).catch(() => {});
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
  const isLink = looksLikeLink(query);

  if (settings.mini) {
    return <MiniPlayer settings={settings} online={online} onSettings={setSettings} onRestoreFull={() => setMini(false)} />;
  }

  return (
    <div className={`shell ${layout.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="topbar" data-tauri-drag-region onDoubleClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("button, input, .searchbox")) return;
        import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().toggleMaximize());
      }}>
        <div className="topleft" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <span className="logo" aria-hidden>
              ♫
            </span>
            <span className="lbl">Downtify</span>
            {settings.server_name && settings.server_name.toLowerCase() !== "downtify" && <span className="server-name lbl">{settings.server_name}</span>}
          </div>
          <div className="histnav">
            <button className="icon" disabled={!canBack} onClick={() => nav.back()} title="Back (Alt+←)">
              ‹
            </button>
            <button className="icon" disabled={!canForward} onClick={() => nav.forward()} title="Forward (Alt+→)">
              ›
            </button>
          </div>
        </div>
        <div className={`searchbox ${isLink ? "link" : ""}`}>
          <span className="searchbox-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchRef}
            placeholder={online ? "Search, or paste a Spotify or YouTube Music link" : "Search your library"}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearchEnter()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
          />
          {isLink ? (
            <button className="small primary" onClick={onSearchEnter} disabled={!online} title="Ask the server to download this">
              Download
            </button>
          ) : query ? (
            <button className="icon" onClick={() => onQuery("")} title="Clear">
              ✕
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
        </div>
        <div className="topbar-right">
          <button className="icon" onClick={() => setShortcuts(true)} title="Keyboard shortcuts (?)">
            ⌨
          </button>
          <ThemeToggle />
          <div className="status">
            <button className="ghost syncbtn" disabled={!online || syncing} onClick={() => sync(false)} title={summary?.last_sync ? `Last synced ${fmtWhen(summary.last_sync)}` : "Never synced"}>
              <span>{syncing ? "Syncing…" : "Sync"}</span>
              <small>{summary?.last_sync ? fmtAgo(summary.last_sync) : "never"}</small>
            </button>
          </div>
          <WindowControls />
        </div>
      </header>

      {unpairedRemotely && (
        <div className="banner warn">
          This PC was unpaired on the server. Your downloaded files still play.{" "}
          <button className="link" onClick={() => nav.push({ section: "settings", scope: {}, search: "", tab: "server" })}>
            Pair again
          </button>
        </div>
      )}
      {!online && status && <div className="banner muted">Server unreachable ({status.detail || "offline"}). Showing your local library; downloaded tracks play as normal.</div>}
      {notice && <div className="banner info">{notice}</div>}

      <main className="content">
        <Library
          online={online}
          summary={summary}
          version={libraryVersion}
          username={settings.username}
          renderSettings={(tab, setTab) => (
            <SettingsView
              tab={tab}
              setTab={setTab}
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
        />
        {queueOpen && <QueuePanel online={online} />}
      </main>

      <PlayerBar online={online} onReveal={() => player.reveal()} onMini={() => setMini(true)} />
      {shortcuts && <ShortcutsOverlay onClose={() => setShortcuts(false)} />}
    </div>
  );
}
