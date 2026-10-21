import { useCallback, useEffect, useRef, useState } from "react";
import {
  Album,
  Artist,
  PlaylistSummary,
  Summary,
  Track,
  api,
  coverUrl,
  fmtDuration,
  homeApi,
  isEditable,
  isMine,
  playerApi,
  playlistCoverUrl,
  playlistsApi,
  sharingApi,
} from "../api";
import { usePlayer } from "../player/usePlayer";
import { player as playerSingleton } from "../player/store";
import { likeBus } from "../likeBus";
import { DensityPicker, useLayout } from "../layout";
import { DownloadButton } from "../components/DownloadButton";
import { Downloads } from "./Downloads";
import { downloadsApi, localBus, useDownloads } from "../downloads";
import { MenuItem, useContextMenu } from "../components/ContextMenu";
import { navBus } from "../navBus";
import { Section, nav, useNav } from "../nav";
import { setLayout } from "../layout";

interface Scope {
  album?: Album;
  artist?: Artist;
  playlist?: PlaylistSummary;
}

const SECTION_TITLE: Record<Section, string> = {
  home: "Home",
  tracks: "Songs",
  albums: "Albums",
  artists: "Artists",
  playlists: "Playlists",
  downloads: "Downloads",
  settings: "Settings",
};

const DRAG_MIME = "application/x-downtify-tracks";

interface DragPayload {
  ids: string[];
  fromPlaylist?: string;
}

/** Shared bits every menu builder needs. */
export interface MenuEnv {
  online: boolean;
  playlists: PlaylistSummary[];
  setNotice: (s: string) => void;
  reloadPlaylists: (list?: PlaylistSummary[]) => void;
  promptNewPlaylist: (thenAdd?: string[]) => void;
  currentPlaylist?: PlaylistSummary;
}

export function Library({
  online,
  summary,
  version,
  renderSettings,
  username,
}: {
  online: boolean;
  summary: Summary | null;
  version: number;
  renderSettings: (tab: string, setTab: (t: string) => void) => JSX.Element;
  username: string;
}) {
  const { view } = useNav();
  const section = view.section;
  const scope = view.scope as Scope;
  const search = view.search;
  const setSection = (s: Section) => nav.push({ ...view, section: s });
  const setScope = (sc: Scope) => nav.push({ ...view, scope: sc as Record<string, unknown> });
  const setSearch = (q: string) => nav.replace({ ...view, search: q });
  const [localOnly, setLocalOnly] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newPlaylist, setNewPlaylist] = useState<{ open: boolean; name: string; thenAdd?: string[] } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detaching, setDetaching] = useState<string | null>(null);
  const [sharing, setSharing] = useState<PlaylistSummary | null>(null);
  const [publicOpen, setPublicOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const { player, revealNonce, context, current } = usePlayer();
  const [revealPending, setRevealPending] = useState(false);
  const layout = useLayout();
  const ctx = useContextMenu();

  const playContext = { section, scope, search, localOnly };

  // ── Navigation plumbing ─────────────────────────────────────────────

  const lastReveal = useRef(revealNonce);
  useEffect(() => {
    if (revealNonce === lastReveal.current) return;
    lastReveal.current = revealNonce;
    if (!context) return;
    nav.push({
      section: context.section as Section,
      scope: ((context.scope as Scope) ?? {}) as Record<string, unknown>,
      search: "",
    });
    setLocalOnly(!!context.localOnly);
    setRevealPending(true);
  }, [revealNonce, context]);

  useEffect(() => {
    if (!revealPending || !current) return;
    const row = document.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(current.id)}"]`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      setRevealPending(false);
    }
  }, [revealPending, tracks, current]);

  useEffect(
    () =>
      navBus.on((t) => {
        if (t.playlist) {
          const p = playlists.find((x) => x.name === t.playlist);
          if (p) nav.push({ section: "playlists", scope: { playlist: p }, search: "" });
        } else if (t.album_id) {
          nav.push({
            section: "albums",
            search: "",
            scope: {
              album: {
              album_id: t.album_id,
              album: t.album ?? "",
              album_artist: t.album_artist ?? "",
              artist_id: t.artist_id ?? "",
              count: 0,
              local_count: 0,
              cover_track_id: t.cover_track_id ?? "",
              },
            },
          });
        } else if (t.artist_id) {
          nav.push({ section: "albums", search: "", scope: { artist: { artist_id: t.artist_id, name: t.artist ?? "", count: 0, local_count: 0 } } });
        }
      }),
    [playlists],
  );

  // ── Data loading ────────────────────────────────────────────────────

  const showingTracks = section === "tracks" || !!scope.album || !!scope.playlist;

  const reloadPlaylists = useCallback((list?: PlaylistSummary[]) => {
    if (list) setPlaylists(list);
    else api.listPlaylists().then(setPlaylists).catch(() => {});
  }, []);

  useEffect(() => {
    reloadPlaylists();
  }, [summary?.playlists, summary?.local_tracks, reloadPlaylists, version]);

  const [tracksVersion, setTracksVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError("");
        if (showingTracks) {
          const list = await api.listTracks({
            search,
            album_id: scope.album?.album_id,
            artist_id: scope.album ? undefined : scope.artist?.artist_id,
            playlist: scope.playlist?.name,
            local_only: localOnly,
            limit: 2000,
          });
          if (!cancelled) setTracks(list);
        } else if (section === "albums") {
          const list = await api.listAlbums(scope.artist?.artist_id);
          if (!cancelled) setAlbums(list);
        } else if (section === "artists") {
          if (!cancelled) setArtists(await api.listArtists());
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section, scope, search, localOnly, showingTracks, tracksVersion, version]);

  useEffect(() => likeBus.on((id, liked) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, liked } : t)))), []);
  useEffect(
    () =>
      localBus.on((id, local_path) => {
        setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, local_path } : t)));
        reloadPlaylists();
      }),
    [reloadPlaylists],
  );
  const downloads = useDownloads();
  const activeDownloads = downloads.filter((d) => d.status === "queued" || d.status === "downloading").length;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Navigation helpers ──────────────────────────────────────────────

  function go(s: Section) {
    nav.push({ section: s, scope: {}, search: "" });
  }

  function openPlaylist(p: PlaylistSummary) {
    nav.push({ section: "playlists", scope: { playlist: p } as Record<string, unknown>, search: "" });
    if (p.is_new) sharingApi.seen(p.name).then(() => reloadPlaylists()).catch(() => {});
  }

  async function runPlaylistOp(label: string, op: () => Promise<PlaylistSummary[]>) {
    try {
      const list = await op();
      reloadPlaylists(list);
      setNotice(label);
    } catch (e) {
      setNotice(String(e));
    }
  }

  // ── Playlist editing ────────────────────────────────────────────────

  const env: MenuEnv = {
    online,
    playlists,
    setNotice,
    reloadPlaylists,
    promptNewPlaylist: (thenAdd) => setNewPlaylist({ open: true, name: "", thenAdd }),
    currentPlaylist: scope.playlist,
  };

  async function createPlaylist() {
    if (!newPlaylist || !newPlaylist.name.trim()) return;
    const name = newPlaylist.name.trim();
    try {
      let list = await playlistsApi.create(name);
      if (newPlaylist.thenAdd?.length) {
        const r = await playlistsApi.editTracks(name, newPlaylist.thenAdd, []);
        list = r.playlists;
        setNotice(`Created "${name}" with ${r.added} song${r.added === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} skipped: not on the server)` : ""}`);
      } else {
        setNotice(`Created "${name}"`);
      }
      reloadPlaylists(list);
      setNewPlaylist(null);
    } catch (e) {
      setNotice(String(e));
    }
  }

  async function commitRename() {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (!value || value === renaming.name) {
      setRenaming(null);
      return;
    }
    try {
      const list = await playlistsApi.rename(renaming.name, value);
      reloadPlaylists(list);
      if (scope.playlist?.name === renaming.name) {
        const p = list.find((x) => x.name === value);
        if (p) setScope({ playlist: p });
      }
      setRenaming(null);
    } catch (e) {
      setNotice(String(e));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const list = await playlistsApi.delete(deleting);
      reloadPlaylists(list);
      if (scope.playlist?.name === deleting) go("home");
      setNotice(`Deleted "${deleting}" on the server`);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setDeleting(null);
    }
  }

  async function addToPlaylist(name: string, ids: string[]) {
    try {
      const r = await playlistsApi.editTracks(name, ids, []);
      reloadPlaylists(r.playlists);
      setNotice(`Added ${r.added} to "${name}"${r.skipped ? ` (${r.skipped} skipped: not on the server)` : ""}${r.added === 0 && !r.skipped ? " (already there)" : ""}`);
      if (scope.playlist?.name === name) setTracksVersion((v) => v + 1);
    } catch (e) {
      setNotice(String(e));
    }
  }

  async function removeFromPlaylist(name: string, ids: string[]) {
    try {
      const r = await playlistsApi.editTracks(name, [], ids);
      reloadPlaylists(r.playlists);
      setNotice(`Removed ${r.removed} from "${name}"`);
      if (scope.playlist?.name === name) setTracksVersion((v) => v + 1);
    } catch (e) {
      setNotice(String(e));
    }
  }

  // ── Drag and drop onto sidebar playlists ────────────────────────────

  function readDrag(e: React.DragEvent): DragPayload | null {
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      return raw ? (JSON.parse(raw) as DragPayload) : null;
    } catch {
      return null;
    }
  }

  async function dropOnPlaylist(e: React.DragEvent, target: PlaylistSummary) {
    e.preventDefault();
    setDropTarget(null);
    const payload = readDrag(e);
    if (!payload || payload.ids.length === 0) return;
    if (!isEditable(target)) {
      setNotice(target.liked ? "Use the heart to add to Liked Songs" : `"${target.name}" was imported and can't be edited`);
      return;
    }
    const move = e.shiftKey && payload.fromPlaylist && payload.fromPlaylist !== target.name;
    await addToPlaylist(target.name, payload.ids);
    if (move) {
      const src = playlists.find((p) => p.name === payload.fromPlaylist);
      if (src && isEditable(src)) await removeFromPlaylist(src.name, payload.ids);
      else setNotice(`Copied. "${payload.fromPlaylist}" can't be edited, so nothing was removed from it`);
    }
  }

  // ── Menus ───────────────────────────────────────────────────────────

  function playlistMenu(p: PlaylistSummary): MenuItem[] {
    const editable = isEditable(p);
    const mine = isMine(p);
    const pctx = { section: "playlists", scope: { playlist: p }, search: "", localOnly: false };
    const load = () => api.listTracks({ playlist: p.name, limit: 10000 });
    const shareLabel = p.visibility === "public" ? "Share… (public)" : p.visibility === "shared" ? `Share… (${p.shared_with.length})` : "Share…";
    const ownerBits: MenuItem[] = mine
      ? [
          { label: shareLabel, disabled: !online, onClick: () => setSharing(p) },
          ...(!p.manual ? [{ label: "Detach from source…", disabled: !online, hint: "makes it editable", onClick: () => setDetaching(p.name) } as MenuItem] : []),
        ]
      : [
          ...(p.visibility === "public" && !p.shared_with_me
            ? [{ label: p.followed ? "Unfollow" : "Follow", disabled: !online, onClick: () => runPlaylistOp(p.followed ? `Unfollowed "${p.name}"` : `Following "${p.name}"`, () => sharingApi.follow(p.name, !p.followed)) } as MenuItem]
            : []),
          { label: "Save a copy", disabled: !online, hint: "editable, yours", onClick: () => runPlaylistOp(`Saved a copy of "${p.name}"`, () => sharingApi.copy(p.name)) },
        ];
    return [
      { label: "Play", onClick: () => load().then((ts) => player.playList(ts, 0, pctx)) },
      { label: "Shuffle", onClick: () => load().then((ts) => player.shufflePlay(ts, pctx)) },
      { label: "Add to queue", onClick: () => load().then((ts) => player.addToQueue(ts)) },
      { separator: true },
      {
        label: "Sync to this PC",
        icon: <DownloadGlyph on={p.keep_synced} />,
        checked: p.keep_synced,
        disabled: !online && !p.keep_synced,
        onClick: () => downloadsApi.setKeepSynced(p.name, !p.keep_synced).then(() => reloadPlaylists()),
      },
      {
        label: "Remove from this PC",
        disabled: p.local_count === 0,
        onClick: async () => {
          const ids = (await api.listTracks({ playlist: p.name, local_only: true, limit: 10000 })).map((t) => t.id);
          if (p.keep_synced) await downloadsApi.setKeepSynced(p.name, false);
          await downloadsApi.removeLocal(ids);
          reloadPlaylists();
        },
      },
      { separator: true },
      ...ownerBits,
      ...(mine
        ? [
            { separator: true } as MenuItem,
            { label: "Rename…", disabled: !editable || !online, hint: editable ? undefined : "imported", onClick: () => setRenaming({ name: p.name, value: p.name }) } as MenuItem,
            { label: "Delete playlist…", danger: true, disabled: !editable || !online, hint: editable ? undefined : "imported", onClick: () => setDeleting(p.name) } as MenuItem,
          ]
        : []),
    ];
  }

  function albumMenu(a: Album): MenuItem[] {
    const load = () => api.listTracks({ album_id: a.album_id, limit: 10000 });
    const actx = { section: "albums", scope: { album: a }, search: "", localOnly: false };
    return [
      { label: "Play", onClick: () => load().then((ts) => player.playList(ts, 0, actx)) },
      { label: "Shuffle", onClick: () => load().then((ts) => player.shufflePlay(ts, actx)) },
      { label: "Play next", onClick: () => load().then((ts) => player.playNext(ts)) },
      { label: "Add to queue", onClick: () => load().then((ts) => player.addToQueue(ts)) },
      { label: "Add to playlist", submenu: addToPlaylistItems(env, () => load().then((ts) => ts.map((t) => t.id)), addToPlaylist) },
      { separator: true },
      { label: "Download all", disabled: !online || a.local_count === a.count, onClick: () => load().then((ts) => downloadsApi.download(ts.map((t) => t.id))) },
      {
        label: "Remove from this PC",
        disabled: a.local_count === 0,
        onClick: () => load().then((ts) => downloadsApi.removeLocal(ts.filter((t) => t.local_path).map((t) => t.id)).then(() => setTracksVersion((v) => v + 1))),
      },
      { separator: true },
      { label: "Go to artist", disabled: !a.artist_id, onClick: () => navBus.go({ artist_id: a.artist_id, artist: a.album_artist }) },
    ];
  }

  // ── Render ──────────────────────────────────────────────────────────

  const empty = summary && summary.tracks === 0;
  const title = scope.album
    ? `${scope.album.album} — ${scope.album.album_artist}`
    : scope.playlist
      ? playlistLabel(scope.playlist)
      : scope.artist
        ? scope.artist.name
        : SECTION_TITLE[section];
  const headerPlaylist = scope.playlist ? (playlists.find((x) => x.name === scope.playlist!.name) ?? scope.playlist) : undefined;

  const collapsed = layout.sidebarCollapsed;
  return (
    <div className={`library density-${layout.density} ${layout.rowArt ? "" : "no-row-art"} ${collapsed ? "sidebar-collapsed" : ""}`}>
      {ctx.menu}
      <aside className="sidebar">
        <button className={`nav ${section === "home" ? "active" : ""}`} onClick={() => go("home")} title="Home">
          <span className="nav-icon">⌂</span> <span className="lbl">Home</span>
        </button>
        <button className={`nav ${section === "downloads" ? "active" : ""}`} onClick={() => go("downloads")} title="Downloads">
          <span className="nav-icon">⤓</span> <span className="lbl">Downloads</span>
          {activeDownloads > 0 && <small className="badge">{activeDownloads}</small>}
        </button>
        <div className="sidebar-title">
          <span className="lbl">Your playlists</span>
          <button className="icon plus" title={online ? "New playlist" : "Needs the server"} disabled={!online} onClick={() => setNewPlaylist({ open: true, name: "" })}>
            +
          </button>
        </div>
        {newPlaylist?.open && (
          <form
            className="new-playlist"
            onSubmit={(e) => {
              e.preventDefault();
              createPlaylist();
            }}
          >
            <input
              autoFocus
              placeholder="Playlist name"
              value={newPlaylist.name}
              onChange={(e) => setNewPlaylist({ ...newPlaylist, name: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && setNewPlaylist(null)}
            />
            <button className="small primary" type="submit" disabled={!newPlaylist.name.trim()}>
              Create
            </button>
          </form>
        )}
        <div className="sidebar-playlists">
          {sidebarSections(playlists, publicOpen, username, layout.showOthersPlaylists).map((sec) => (
            <div key={sec.key} className="pl-section">
              {sec.title && (
                <button className={`pl-section-title ${sec.foldable ? "foldable" : ""}`} onClick={() => sec.foldable && setPublicOpen((o) => !o)} disabled={!sec.foldable}>
                  <span>{sec.title}</span>
                  <small>
                    {sec.foldable ? (publicOpen ? "▾" : "▸") : ""} {sec.count}
                  </small>
                </button>
              )}
              {sec.items.map((p) => (
            <button
              key={p.name}
              className={`pl ${scope.playlist?.name === p.name ? "active" : ""} ${dropTarget === p.name ? "drop" : ""} ${isEditable(p) ? "" : "locked"}`}
              onClick={() => openPlaylist(p)}
              onContextMenu={(e) => ctx.open(e, playlistMenu(p))}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = isEditable(p) ? (e.shiftKey ? "move" : "copy") : "none";
                  if (dropTarget !== p.name) setDropTarget(p.name);
                }
              }}
              onDragLeave={() => setDropTarget((t) => (t === p.name ? null : t))}
              onDrop={(e) => dropOnPlaylist(e, p)}
              title={`${playlistLabel(p)} · ${p.local_count}/${p.count} on this PC${isEditable(p) ? "" : " · imported, not editable"}`}
            >
              <PlaylistArt p={p} size={28} />
              {p.is_new && <span className="new-dot" title="New" />}
              {renaming?.name === p.name ? (
                <input
                  className="rename"
                  autoFocus
                  value={renaming.value}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span className="pl-name">
                  {playlistLabel(p)}
                  {(!p.mine || (p.owner && username && p.owner.toLowerCase() !== username.toLowerCase() && !p.liked)) && <small className="pl-owner"> · {p.owner}</small>}
                </span>
              )}
            </button>
              ))}
            </div>
          ))}
          {playlists.length === 0 && <div className="sidebar-empty">No playlists yet</div>}
        </div>
        <div className="sidebar-foot">
          <button
            className={`nav modebtn ${localOnly ? "active on" : ""}`}
            onClick={() => setLocalOnly(!localOnly)}
            title={localOnly ? "Offline mode: showing only songs on this PC. Click to show everything" : "Show only songs that are on this PC"}
          >
            <span className="nav-icon">
              <DownloadGlyph on={localOnly} />
            </span>
            <span className="lbl">Offline mode</span>
            <span className={`pill-toggle ${localOnly ? "on" : ""}`}>
              <span className="pill-knob" />
            </span>
          </button>
          {summary && (
            <small className="lbl foot-count">
              {summary.local_tracks} of {summary.tracks} on this PC
            </small>
          )}
          <button className={`nav ${section === "settings" ? "active" : ""}`} onClick={() => nav.push({ section: "settings", scope: {}, search: "", tab: view.tab ?? "general" })} title="Settings">
            <span className="nav-icon">⚙</span> <span className="lbl">Settings</span>
          </button>
          <button className="nav collapse" onClick={() => setLayout({ sidebarCollapsed: !collapsed })} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span className="nav-icon">{collapsed ? "»" : "«"}</span> <span className="lbl">Collapse sidebar</span>
          </button>
        </div>
      </aside>

      <section className="pane">
        <div className="pane-head">
          {scope.album || scope.artist || scope.playlist ? (
            <button className="icon back" onClick={() => setScope({})} title="Back">
              ←
            </button>
          ) : section !== "home" ? (
            <button className="icon back" onClick={() => go("home")} title="Home">
              ←
            </button>
          ) : null}
          {scope.album && scope.album.cover_track_id ? <img className="head-art" src={coverUrl(scope.album.cover_track_id, 150)} alt="" /> : null}
          {headerPlaylist ? <PlaylistArt p={headerPlaylist} size={30} /> : null}
          <h2
            className={headerPlaylist || scope.album ? "has-menu" : ""}
            title={headerPlaylist || scope.album ? "Right-click for options" : undefined}
            onContextMenu={(e) => {
              if (headerPlaylist) ctx.open(e, playlistMenu(headerPlaylist));
              else if (scope.album) ctx.open(e, albumMenu(scope.album));
            }}
          >
            {title}
          </h2>
          {headerPlaylist && !headerPlaylist.mine && (
            <small className="head-owner" title={headerPlaylist.shared_with_me ? "Shared with you" : "Public playlist"}>
              by {headerPlaylist.owner} · view only
            </small>
          )}
          {headerPlaylist && headerPlaylist.mine && headerPlaylist.visibility !== "private" && (
            <small className="head-owner" title={headerPlaylist.visibility === "public" ? "Everyone on the server can see this" : `Shared with ${headerPlaylist.shared_with.join(", ")}`}>
              {headerPlaylist.visibility === "public" ? "public" : `shared with ${headerPlaylist.shared_with.length}`}
            </small>
          )}
          {headerPlaylist && (
            <small className="head-count" title={headerPlaylist.keep_synced ? "Synced to this PC: every song, and new ones as they are added (right-click to change)" : "Right-click for Sync to this PC, Remove from this PC, Rename…"}>
              {headerPlaylist.local_count} of {headerPlaylist.count} on this PC <DownloadGlyph on={headerPlaylist.keep_synced} />
            </small>
          )}
          {showingTracks && search && (
            <small className="head-owner">
              matching “{search}”{" "}
              <button className="link" onClick={() => setSearch("")}>
                clear
              </button>
            </small>
          )}
          {showingTracks && (
            <span className="head-spacer">
              <DensityPicker small />
            </span>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {notice && <div className="toast">{notice}</div>}

        {deleting && (
          <div className="confirm-box">
            <b>Delete "{deleting}" on the server?</b>
            <p>
              The server removes the playlist <u>and deletes its songs from the server library</u> unless another user also owns them. Your downloaded copies on this PC stay.
            </p>
            <div className="row">
              <button className="danger" onClick={confirmDelete}>
                Delete on server
              </button>
              <button className="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {detaching && (
          <div className="confirm-box">
            <b>Detach "{detaching}" from its source?</b>
            <p>It becomes an ordinary playlist you can edit. The link to the Spotify / YouTube Music playlist and its monitor entry are dropped, so the server stops updating it from there. Songs stay.</p>
            <div className="row">
              <button className="primary" onClick={() => runPlaylistOp(`Detached "${detaching}"`, () => sharingApi.detach(detaching)).then(() => setDetaching(null))}>
                Detach
              </button>
              <button className="ghost" onClick={() => setDetaching(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {sharing && (
          <SharePanel
            p={playlists.find((x) => x.name === sharing.name) ?? sharing}
            onClose={() => setSharing(null)}
            onSaved={(list, label) => {
              reloadPlaylists(list);
              setNotice(label);
              setSharing(null);
            }}
            onError={setNotice}
          />
        )}

        {section === "settings" ? (
          renderSettings(view.tab ?? "general", (t) => nav.replace({ ...view, tab: t }))
        ) : empty ? (
          <div className="empty">{online ? "Library is empty. Download something on the server, then press Sync." : "No library yet. Connect to the server once to sync it."}</div>
        ) : section === "downloads" ? (
          <Downloads
            renderTable={(local) => (
              <TrackTable
                tracks={local}
                online={online}
                showAlbum
                onPlay={(i) => player.playList(local, i, { section: "downloads", scope: {}, search: "", localOnly: true })}
                env={{ ...env, currentPlaylist: undefined }}
                openMenu={ctx.open}
                addToPlaylist={addToPlaylist}
              />
            )}
          />
        ) : section === "home" ? (
          <Home
            summary={summary}
            online={online}
            env={env}
            openMenu={ctx.open}
            addToPlaylist={addToPlaylist}
            go={go}
            openAlbum={(a) => nav.push({ section: "albums", scope: { album: a } as Record<string, unknown>, search: "" })}
            albumMenu={albumMenu}
          />
        ) : showingTracks && layout.density === "grid" ? (
          <TrackGrid
            tracks={tracks}
            online={online}
            onPlay={(i) => player.playList(tracks, i, playContext)}
            env={env}
            openMenu={ctx.open}
            addToPlaylist={addToPlaylist}
            removeFromPlaylist={removeFromPlaylist}
          />
        ) : showingTracks ? (
          <TrackTable
            tracks={tracks}
            online={online}
            showAlbum={!scope.album}
            onPlay={(i) => player.playList(tracks, i, playContext)}
            env={env}
            openMenu={ctx.open}
            addToPlaylist={addToPlaylist}
            removeFromPlaylist={removeFromPlaylist}
          />
        ) : section === "albums" && scope.artist ? (
          <ArtistPage
            artist={scope.artist}
            albums={albums}
            online={online}
            env={env}
            openMenu={ctx.open}
            addToPlaylist={addToPlaylist}
            onOpenAlbum={(a) => setScope({ ...scope, album: a })}
            albumMenu={albumMenu}
          />
        ) : section === "albums" ? (
          <AlbumGrid albums={albums} onOpen={(a) => setScope({ ...scope, album: a })} onMenu={(e, a) => ctx.open(e, albumMenu(a))} />
        ) : section === "artists" ? (
          <ul className="list">
            {artists.map((a) => (
              <li key={a.artist_id}>
                <button
                  className="rowbtn"
                  onClick={() => nav.push({ section: "albums", scope: { artist: a } as Record<string, unknown>, search: "" })}
                >
                  <span>{a.name}</span>
                  <small>
                    {a.local_count}/{a.count} songs
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="playlist-sections">
            {sidebarSections(playlists, true, username, layout.showOthersPlaylists).map((sec) => (
              <div key={sec.key}>
                {sec.title && (
                  <h3>
                    {sec.title} <small>{sec.count}</small>
                  </h3>
                )}
                <div className="grid">
                  {sec.items.map((p) => (
                    <button key={p.name} className="tile" onClick={() => openPlaylist(p)} onContextMenu={(e) => ctx.open(e, playlistMenu(p))}>
                      <PlaylistArt p={p} size={0} />
                      <div className="tile-title" title={playlistLabel(p)}>
                        {p.is_new && <span className="new-dot" />}
                        {playlistLabel(p)}
                      </div>
                      <div className="tile-sub">{p.mine ? (p.visibility === "private" ? "" : p.visibility) : `by ${p.owner}${p.followed ? " · following" : ""}`}</div>
                      <div className="tile-meta">
                        {p.local_count}/{p.count} on this PC
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Menu builders shared by rows, tiles, queue and player bar ───────────

export function addToPlaylistItems(env: MenuEnv, ids: () => Promise<string[]> | string[], add: (name: string, ids: string[]) => Promise<void>): MenuItem[] {
  const editable = env.playlists.filter(isEditable);
  const resolve = async () => await ids();
  const items: MenuItem[] = [
    {
      label: "New playlist…",
      disabled: !env.online,
      onClick: async () => env.promptNewPlaylist(await resolve()),
    },
  ];
  if (editable.length) items.push({ separator: true });
  for (const p of editable) {
    items.push({ label: p.name, disabled: !env.online, onClick: async () => add(p.name, await resolve()) });
  }
  if (editable.length === 0) items.push({ label: "No editable playlists yet", disabled: true });
  return items;
}

export function trackMenu(
  tracks: Track[],
  env: MenuEnv,
  opts: {
    playFirst?: () => void;
    addToPlaylist: (name: string, ids: string[]) => Promise<void>;
    removeFromPlaylist?: (name: string, ids: string[]) => Promise<void>;
    extra?: MenuItem[];
  },
): MenuItem[] {
  const player = playerSingleton;
  const ids = tracks.map((t) => t.id);
  const one = tracks.length === 1 ? tracks[0] : null;
  const n = tracks.length;
  const label = (s: string) => (n > 1 ? `${s} (${n})` : s);
  const allLocal = tracks.every((t) => t.local_path);
  const anyLocal = tracks.some((t) => t.local_path);
  const inPlaylist = env.currentPlaylist && isEditable(env.currentPlaylist) ? env.currentPlaylist : undefined;
  const items: MenuItem[] = [
    { label: label("Play"), onClick: () => (opts.playFirst ? opts.playFirst() : player.playList(tracks, 0)) },
    { label: label("Play next"), onClick: () => player.playNext(tracks) },
    { label: label("Add to queue"), onClick: () => player.addToQueue(tracks) },
    { label: label("Add to playlist"), submenu: addToPlaylistItems(env, () => ids, opts.addToPlaylist) },
  ];
  if (inPlaylist && opts.removeFromPlaylist) {
    items.push({ label: label(`Remove from "${inPlaylist.name}"`), disabled: !env.online, onClick: () => opts.removeFromPlaylist!(inPlaylist.name, ids) });
  }
  items.push({ separator: true });
  if (one) {
    items.push({
      label: one.liked ? "Unlike" : "Like",
      disabled: !env.online,
      onClick: () =>
        playerApi
          .setLike(one.id, !one.liked)
          .then((liked) => likeBus.emit(one.id, liked))
          .catch(() => {}),
    });
  }
  if (!allLocal) items.push({ label: label("Download to this PC"), disabled: !env.online, onClick: () => downloadsApi.download(tracks.filter((t) => !t.local_path).map((t) => t.id)) });
  if (anyLocal) items.push({ label: label("Remove from this PC"), onClick: () => downloadsApi.removeLocal(tracks.filter((t) => t.local_path).map((t) => t.id)) });
  if (one) {
    items.push({ separator: true });
    items.push({
      label: "Go to album",
      disabled: !one.album_id,
      onClick: () => navBus.go({ album_id: one.album_id, album: one.album, album_artist: one.album_artist, artist_id: one.artist_id, cover_track_id: one.id }),
    });
    items.push({ label: "Go to artist", disabled: !one.artist_id, onClick: () => navBus.go({ artist_id: one.artist_id, artist: one.album_artist || one.artist }) });
  }
  if (opts.extra?.length) {
    items.push({ separator: true }, ...opts.extra);
  }
  return items;
}

/** The small download arrow used next to "Sync to this PC". Green when on. */
function DownloadGlyph({ on }: { on: boolean }) {
  return (
    <svg className={`dl-glyph ${on ? "on" : ""}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={on ? "var(--accent)" : "none"} stroke={on ? "var(--accent)" : "currentColor"} strokeWidth="1.3" />
      <path d="M8 4v6M5.5 7.8 8 10.3l2.5-2.5" fill="none" stroke={on ? "#06230f" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12h6" stroke={on ? "#06230f" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface PlSection {
  key: string;
  title: string;
  items: PlaylistSummary[];
  count: number;
  foldable: boolean;
}

/** Your own, shared with you (plus followed), the public ones, and (admins, opt-in) other users'. */
function sidebarSections(all: PlaylistSummary[], publicOpen: boolean, username: string, showOthers: boolean): PlSection[] {
  const me = username.toLowerCase();
  // An admin gets every user's playlist marked editable; keep "yours" to what you own.
  const isOwn = (p: PlaylistSummary) => p.mine && (!p.owner || !me || p.owner.toLowerCase() === me || p.liked);
  const mine = all.filter(isOwn);
  const others = all.filter((p) => p.mine && !isOwn(p));
  const shared = all.filter((p) => !p.mine && (p.shared_with_me || p.followed));
  const pub = all.filter((p) => !p.mine && !p.shared_with_me && !p.followed && p.visibility === "public");
  const out: PlSection[] = [{ key: "mine", title: "", items: mine, count: mine.length, foldable: false }];
  if (shared.length) out.push({ key: "shared", title: "Shared with me", items: shared, count: shared.length, foldable: false });
  if (pub.length) out.push({ key: "public", title: "Public playlists", items: publicOpen ? pub : [], count: pub.length, foldable: true });
  if (showOthers && others.length) out.push({ key: "others", title: "Other users (admin)", items: others, count: others.length, foldable: false });
  return out;
}

function SharePanel({
  p,
  onClose,
  onSaved,
  onError,
}: {
  p: PlaylistSummary;
  onClose: () => void;
  onSaved: (list: PlaylistSummary[], label: string) => void;
  onError: (s: string) => void;
}) {
  const [visibility, setVisibility] = useState<"private" | "shared" | "public">(p.visibility);
  const [chosen, setChosen] = useState<Set<string>>(new Set(p.shared_with));
  const [names, setNames] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    sharingApi
      .usernames()
      .then((u) => {
        setNames(u.usernames);
        setEnabled(u.enabled);
      })
      .catch((e) => onError(String(e)));
  }, [onError]);
  async function save() {
    setBusy(true);
    try {
      const list = await sharingApi.setVisibility(p.name, visibility, visibility === "shared" ? [...chosen] : []);
      onSaved(list, visibility === "private" ? `"${p.name}" is private again` : visibility === "public" ? `"${p.name}" is now public` : `"${p.name}" shared with ${chosen.size}`);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="confirm-box share">
      <b>Share "{p.name}"</b>
      {!enabled && <p>Sharing is turned off by the server admin.</p>}
      <div className="share-options">
        <label className="check">
          <input type="radio" name="vis" checked={visibility === "private"} onChange={() => setVisibility("private")} /> Private, only me
        </label>
        <label className="check">
          <input type="radio" name="vis" checked={visibility === "shared"} disabled={!enabled} onChange={() => setVisibility("shared")} /> Specific people
        </label>
        {visibility === "shared" && (
          <div className="share-people">
            {names.length === 0 && <small>No other accounts on this server.</small>}
            {names.map((n) => (
              <label key={n} className="check">
                <input
                  type="checkbox"
                  checked={chosen.has(n)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const c = new Set(s);
                      if (e.target.checked) c.add(n);
                      else c.delete(n);
                      return c;
                    })
                  }
                />
                {n}
              </label>
            ))}
          </div>
        )}
        <label className="check">
          <input type="radio" name="vis" checked={visibility === "public"} disabled={!enabled} onChange={() => setVisibility("public")} /> Public, everyone on the server
        </label>
      </div>
      <p>Others can play, follow and save a copy. Nobody but you can edit it.</p>
      <div className="row">
        <button className="primary" onClick={save} disabled={busy || (visibility === "shared" && chosen.size === 0)}>
          Save
        </button>
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The server names the liked list after itself; we just say Liked Songs. */
function playlistLabel(p: PlaylistSummary): string {
  return p.liked ? "Liked Songs" : p.name;
}

/** A playlist's mosaic, or a heart for Liked Songs. size 0 = fill tile. */
function PlaylistArt({ p, size }: { p: PlaylistSummary; size: number }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.55) } : undefined;
  const cls = size ? "pl-art" : "tile-art";
  if (p.liked) {
    return (
      <div className={`${cls} liked`} style={style}>
        ♥
      </div>
    );
  }
  if (!p.cover || failed) {
    return (
      <div className={cls} style={style}>
        ♫
      </div>
    );
  }
  return <img className={cls} style={style} src={playlistCoverUrl(p.cover)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function RowArt({ track }: { track: Track }) {
  const [failed, setFailed] = useState(false);
  if (!track.has_cover || failed) return <div className="row-art">♫</div>;
  return <img className="row-art" src={coverUrl(track.id, 150)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function AlbumArt({ trackId }: { trackId: string }) {
  const [failed, setFailed] = useState(false);
  if (!trackId || failed) return <div className="tile-art">♫</div>;
  return <img className="tile-art" src={coverUrl(trackId, 300)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function AlbumGrid({ albums, onOpen, onMenu }: { albums: Album[]; onOpen: (a: Album) => void; onMenu: (e: React.MouseEvent, a: Album) => void }) {
  return (
    <div className="grid">
      {albums.map((a) => (
        <button key={a.album_id} className="tile" onClick={() => onOpen(a)} onContextMenu={(e) => onMenu(e, a)}>
          <AlbumArt trackId={a.cover_track_id} />
          <div className="tile-title" title={a.album}>
            {a.album}
          </div>
          <div className="tile-sub" title={a.album_artist}>
            {a.album_artist}
          </div>
          <div className="tile-meta">
            {a.local_count}/{a.count} on this PC
          </div>
        </button>
      ))}
    </div>
  );
}

function Home({
  summary,
  online,
  env,
  openMenu,
  addToPlaylist,
  go,
  openAlbum,
  albumMenu,
}: {
  summary: Summary | null;
  online: boolean;
  env: MenuEnv;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  addToPlaylist: (name: string, ids: string[]) => Promise<void>;
  go: (s: Section) => void;
  openAlbum: (a: Album) => void;
  albumMenu: (a: Album) => MenuItem[];
}) {
  const [recentAlbums, setRecentAlbums] = useState<Album[]>([]);
  const [recentSongs, setRecentSongs] = useState<Track[]>([]);
  const [recentPlays, setRecentPlays] = useState<Track[]>([]);
  const { player, current } = usePlayer();

  useEffect(() => {
    homeApi.recentAlbums(12).then(setRecentAlbums).catch(() => {});
    api.listTracks({ limit: 15 }).then(setRecentSongs).catch(() => {});
    homeApi.recentPlays(15).then(setRecentPlays).catch(() => {});
  }, [summary?.tracks, current?.id]);

  useEffect(
    () =>
      likeBus.on((id, liked) => {
        const fix = (ts: Track[]) => ts.map((t) => (t.id === id ? { ...t, liked } : t));
        setRecentSongs(fix);
        setRecentPlays(fix);
      }),
    [],
  );
  useEffect(
    () =>
      localBus.on((id, local_path) => {
        const fix = (ts: Track[]) => ts.map((t) => (t.id === id ? { ...t, local_path } : t));
        setRecentSongs(fix);
        setRecentPlays(fix);
      }),
    [],
  );

  const hctx = (name: string) => ({ section: "home", scope: {}, search: name, localOnly: false });
  const homeEnv = { ...env, currentPlaylist: undefined };

  return (
    <div className="home">
      <div className="home-entries">
        <button onClick={() => go("tracks")}>
          <b>Songs</b>
          <small>{summary?.tracks ?? 0}</small>
        </button>
        <button onClick={() => go("albums")}>
          <b>Albums</b>
          <small>{summary?.albums ?? 0}</small>
        </button>
        <button onClick={() => go("artists")}>
          <b>Artists</b>
          <small>{summary?.artists ?? 0}</small>
        </button>
        <button onClick={() => go("playlists")}>
          <b>Playlists</b>
          <small>{summary?.playlists ?? 0}</small>
        </button>
      </div>

      <h3>Recently added</h3>
      <div className="strip">
        <AlbumGrid albums={recentAlbums} onOpen={openAlbum} onMenu={(e, a) => openMenu(e, albumMenu(a))} />
      </div>

      <h3>Recently added songs</h3>
      <TrackTable tracks={recentSongs} online={online} showAlbum onPlay={(i) => player.playList(recentSongs, i, hctx("recent-songs"))} compact env={homeEnv} openMenu={openMenu} addToPlaylist={addToPlaylist} />

      {recentPlays.length > 0 && (
        <>
          <h3>Recently played</h3>
          <TrackTable tracks={recentPlays} online={online} showAlbum onPlay={(i) => player.playList(recentPlays, i, hctx("recent-plays"))} compact env={homeEnv} openMenu={openMenu} addToPlaylist={addToPlaylist} />
        </>
      )}
    </div>
  );
}

function ArtistPage({
  artist,
  albums,
  online,
  env,
  openMenu,
  addToPlaylist,
  onOpenAlbum,
  albumMenu,
}: {
  artist: Artist;
  albums: Album[];
  online: boolean;
  env: MenuEnv;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  addToPlaylist: (name: string, ids: string[]) => Promise<void>;
  onOpenAlbum: (a: Album) => void;
  albumMenu: (a: Album) => MenuItem[];
}) {
  const [songs, setSongs] = useState<Track[]>([]);
  const { player } = usePlayer();
  useEffect(() => {
    api.listTracks({ artist_id: artist.artist_id, limit: 5000 }).then(setSongs).catch(() => {});
  }, [artist.artist_id]);
  useEffect(() => likeBus.on((id, liked) => setSongs((ts) => ts.map((t) => (t.id === id ? { ...t, liked } : t)))), []);
  useEffect(() => localBus.on((id, local_path) => setSongs((ts) => ts.map((t) => (t.id === id ? { ...t, local_path } : t)))), []);
  const actx = { section: "albums", scope: { artist }, search: "", localOnly: false };
  return (
    <div className="artist-page">
      {albums.length > 0 && (
        <>
          <h3>Albums</h3>
          <AlbumGrid albums={albums} onOpen={onOpenAlbum} onMenu={(e, a) => openMenu(e, albumMenu(a))} />
        </>
      )}
      <h3>
        Songs <small>{songs.length}</small>
      </h3>
      <TrackTable tracks={songs} online={online} showAlbum onPlay={(i) => player.playList(songs, i, actx)} env={{ ...env, currentPlaylist: undefined }} openMenu={openMenu} addToPlaylist={addToPlaylist} />
    </div>
  );
}

/** Draggable column edge. Widths live in localStorage. */
const COL_KEY = "downtify.cols";
type ColWidths = { title: number; artist: number; album: number };
const COL_DEFAULTS: ColWidths = { title: 36, artist: 22, album: 22 };
function loadCols(): ColWidths {
  try {
    return { ...COL_DEFAULTS, ...(JSON.parse(localStorage.getItem(COL_KEY) || "{}") as Partial<ColWidths>) };
  } catch {
    return COL_DEFAULTS;
  }
}
let cols = loadCols();
const colListeners = new Set<() => void>();
function setCols(c: ColWidths) {
  cols = c;
  try {
    localStorage.setItem(COL_KEY, JSON.stringify(c));
  } catch {
    /* fine */
  }
  for (const l of colListeners) l();
}
function useCols() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    colListeners.add(l);
    return () => {
      colListeners.delete(l);
    };
  }, []);
  return cols;
}
function ColResizer({ col }: { col: keyof ColWidths }) {
  return (
    <span
      className="col-resizer"
      title="Drag to resize, double-click to reset"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
        const table = th?.closest("table") as HTMLElement | null;
        if (!th || !table) return;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        const tableW = table.getBoundingClientRect().width;
        const onMove = (ev: MouseEvent) => {
          const pct = Math.max(8, Math.min(70, ((startW + ev.clientX - startX) / tableW) * 100));
          setCols({ ...cols, [col]: pct });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setCols({ ...cols, [col]: COL_DEFAULTS[col] });
      }}
    />
  );
}

/** Click / Ctrl / Shift selection over a list of tracks. */
function useSelection(tracks: Track[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number>(-1);
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(tracks.map((t) => t.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [tracks]);
  function click(e: React.MouseEvent, index: number) {
    const id = tracks[index].id;
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range = tracks.slice(a, b + 1).map((t) => t.id);
      setSelected((s) => (e.ctrlKey ? new Set([...s, ...range]) : new Set(range)));
    } else if (e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      anchor.current = index;
    } else {
      setSelected(new Set([id]));
      anchor.current = index;
    }
  }
  /** For a right-click: keep the selection if the row is in it, else select just that row. */
  function forMenu(index: number): Track[] {
    const id = tracks[index].id;
    if (selected.has(id)) return tracks.filter((t) => selected.has(t.id));
    setSelected(new Set([id]));
    anchor.current = index;
    return [tracks[index]];
  }
  return { selected, click, forMenu };
}

function startDrag(e: React.DragEvent, tracks: Track[], fromPlaylist?: string) {
  const payload: DragPayload = { ids: tracks.map((t) => t.id), fromPlaylist };
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.setData("text/plain", tracks.map((t) => `${t.artist} - ${t.title}`).join("\n"));
  e.dataTransfer.effectAllowed = "copyMove";
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = tracks.length === 1 ? tracks[0].title : `${tracks.length} songs`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
}

interface ListProps {
  tracks: Track[];
  online: boolean;
  onPlay: (index: number) => void;
  env: MenuEnv;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  addToPlaylist: (name: string, ids: string[]) => Promise<void>;
  removeFromPlaylist?: (name: string, ids: string[]) => Promise<void>;
}

function TrackGrid({ tracks, online, onPlay, env, openMenu, addToPlaylist, removeFromPlaylist }: ListProps) {
  const { current, playing, player } = usePlayer();
  const sel = useSelection(tracks);
  if (tracks.length === 0) return <div className="empty">Nothing here.</div>;
  return (
    <div className="grid songs">
      {tracks.map((t, i) => {
        const isCurrent = current?.id === t.id;
        const playable = !!t.local_path || online;
        return (
          <button
            key={t.id}
            data-track-id={t.id}
            className={`tile ${isCurrent ? "current" : ""} ${playable ? "" : "unplayable"} ${sel.selected.has(t.id) ? "selected" : ""}`}
            onClick={(e) => sel.click(e, i)}
            onDoubleClick={() => playable && (isCurrent ? player.toggle() : onPlay(i))}
            onContextMenu={(e) => openMenu(e, trackMenu(sel.forMenu(i), env, { playFirst: () => onPlay(i), addToPlaylist, removeFromPlaylist }))}
            draggable
            onDragStart={(e) => startDrag(e, sel.selected.has(t.id) ? tracks.filter((x) => sel.selected.has(x.id)) : [t], env.currentPlaylist?.name)}
            title="Double-click to play · right-click for more"
          >
            <div className="tile-art-wrap">
              {t.has_cover ? <img className="tile-art" src={coverUrl(t.id, 300)} alt="" loading="lazy" /> : <div className="tile-art">♫</div>}
              <span
                className="tile-play"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!playable) return;
                  if (isCurrent) player.toggle();
                  else onPlay(i);
                }}
              >
                {isCurrent && playing ? "⏸" : "▶"}
              </span>
              {t.local_path ? (
                <span className="tile-dot" title="On this PC">
                  ●
                </span>
              ) : null}
            </div>
            <div className="tile-title" title={t.title}>
              {t.liked ? <span className="heart on">♥ </span> : null}
              {t.title || t.file}
            </div>
            <div className="tile-sub" title={t.artist}>
              {t.artist}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TrackTable({ tracks, online, showAlbum, onPlay, compact, env, openMenu, addToPlaylist, removeFromPlaylist }: ListProps & { showAlbum: boolean; compact?: boolean }) {
  const { player, current, playing } = usePlayer();
  const sel = useSelection(tracks);
  const widths = useCols();

  async function toggleLike(t: Track) {
    if (!online) return;
    try {
      const liked = await playerApi.setLike(t.id, !t.liked);
      likeBus.emit(t.id, liked);
    } catch {
      /* ignore; the heart stays as it was */
    }
  }

  if (tracks.length === 0) return <div className="empty">Nothing here.</div>;
  return (
    <table
      className={`tracks ${compact ? "compact" : ""}`}
      style={{ "--w-title": `${widths.title}%`, "--w-artist": `${widths.artist}%`, "--w-album": `${showAlbum ? widths.album : 0}%` } as React.CSSProperties}
    >
      {!compact && (
        <thead>
          <tr>
            <th className="c-play"></th>
            <th className="c-art"></th>
            <th className="c-title">
              Title
              <ColResizer col="title" />
            </th>
            <th className="c-artist">
              Artist
              <ColResizer col="artist" />
            </th>
            {showAlbum && (
              <th className="c-album">
                Album
                <ColResizer col="album" />
              </th>
            )}
            <th className="c-like"></th>
            <th className="c-dl"></th>
            <th className="c-dur">Time</th>
          </tr>
        </thead>
      )}
      <tbody>
        {tracks.map((t, i) => {
          const isCurrent = current?.id === t.id;
          const playable = !!t.local_path || online;
          return (
            <tr
              key={t.id}
              className={`${t.local_path ? "local" : "remote"} ${isCurrent ? "current" : ""} ${sel.selected.has(t.id) ? "selected" : ""} ${playable ? "" : "unplayable"}`}
              data-track-id={t.id}
              onClick={(e) => sel.click(e, i)}
              onDoubleClick={() => playable && onPlay(i)}
              onContextMenu={(e) => openMenu(e, trackMenu(sel.forMenu(i), env, { playFirst: () => onPlay(i), addToPlaylist, removeFromPlaylist }))}
              draggable
              onDragStart={(e) => startDrag(e, sel.selected.has(t.id) ? tracks.filter((x) => sel.selected.has(x.id)) : [t], env.currentPlaylist?.name)}
              title={playable ? "Double-click to play · right-click for more" : "Not downloaded and the server is offline"}
            >
              <td className="c-play">
                <button
                  className="icon rowplay"
                  disabled={!playable}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCurrent) player.toggle();
                    else onPlay(i);
                  }}
                  title={isCurrent && playing ? "Pause" : "Play"}
                >
                  {isCurrent && playing ? "⏸" : "▶"}
                </button>
              </td>
              <td className="c-art">
                <RowArt track={t} />
              </td>
              <td className="c-title">
                {t.title || t.file}
                {t.orphaned && (
                  <span className="orphan" title="No longer on the server; your copy stays until you remove it">
                    {" "}
                    · gone from server
                  </span>
                )}
              </td>
              <td className="c-artist">
                {t.artist_id ? (
                  <button
                    className="cell-link"
                    title="Go to artist"
                    onClick={(e) => {
                      e.stopPropagation();
                      navBus.go({ artist_id: t.artist_id, artist: t.album_artist || t.artist });
                    }}
                  >
                    {t.artist}
                  </button>
                ) : (
                  t.artist
                )}
              </td>
              {showAlbum && (
                <td className="c-album">
                  {t.album_id ? (
                    <button
                      className="cell-link"
                      title="Go to album"
                      onClick={(e) => {
                        e.stopPropagation();
                        navBus.go({ album_id: t.album_id, album: t.album, album_artist: t.album_artist, artist_id: t.artist_id, cover_track_id: t.id });
                      }}
                    >
                      {t.album}
                    </button>
                  ) : (
                    t.album
                  )}
                </td>
              )}
              <td className="c-like">
                <button
                  className={`icon heart ${t.liked ? "on" : ""}`}
                  disabled={!online}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(t);
                  }}
                  title={online ? (t.liked ? "Unlike" : "Like") : "Likes need the server"}
                >
                  {t.liked ? "♥" : "♡"}
                </button>
              </td>
              <td className="c-dl">
                <DownloadButton track={t} online={online} />
              </td>
              <td className="c-dur">{fmtDuration(t.duration)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
