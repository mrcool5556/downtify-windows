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
  playerApi,
  playlistCoverUrl,
  playlistsApi,
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

type Section = "home" | "tracks" | "albums" | "artists" | "playlists" | "downloads";

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

export function Library({ online, summary, version }: { online: boolean; summary: Summary | null; version: number }) {
  const [section, setSection] = useState<Section>("home");
  const [scope, setScope] = useState<Scope>({});
  const [search, setSearch] = useState("");
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
    setSection(context.section as Section);
    setScope((context.scope as Scope) ?? {});
    setSearch(context.section === "home" ? "" : (context.search ?? ""));
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
        setSearch("");
        if (t.playlist) {
          const p = playlists.find((x) => x.name === t.playlist);
          if (p) {
            setSection("playlists");
            setScope({ playlist: p });
          }
        } else if (t.album_id) {
          setSection("albums");
          setScope({
            album: {
              album_id: t.album_id,
              album: t.album ?? "",
              album_artist: t.album_artist ?? "",
              artist_id: t.artist_id ?? "",
              count: 0,
              local_count: 0,
              cover_track_id: t.cover_track_id ?? "",
            },
          });
        } else if (t.artist_id) {
          setSection("albums");
          setScope({ artist: { artist_id: t.artist_id, name: t.artist ?? "", count: 0, local_count: 0 } });
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
    setSection(s);
    setScope({});
    setSearch("");
  }

  function openPlaylist(p: PlaylistSummary) {
    setSection("playlists");
    setScope({ playlist: p });
    setSearch("");
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
    const pctx = { section: "playlists", scope: { playlist: p }, search: "", localOnly: false };
    const load = () => api.listTracks({ playlist: p.name, limit: 10000 });
    return [
      { label: "Play", onClick: () => load().then((ts) => player.playList(ts, 0, pctx)) },
      { label: "Shuffle", onClick: () => load().then((ts) => player.shufflePlay(ts, pctx)) },
      { label: "Add to queue", onClick: () => load().then((ts) => player.addToQueue(ts)) },
      { separator: true },
      {
        label: "Keep synced to this PC",
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
      { label: "Rename…", disabled: !editable || !online, hint: editable ? undefined : "imported", onClick: () => setRenaming({ name: p.name, value: p.name }) },
      { label: "Delete playlist…", danger: true, disabled: !editable || !online, hint: editable ? undefined : "imported", onClick: () => setDeleting(p.name) },
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

  return (
    <div className={`library density-${layout.density} ${layout.rowArt ? "" : "no-row-art"}`}>
      {ctx.menu}
      <aside className="sidebar">
        <button className={`nav ${section === "home" ? "active" : ""}`} onClick={() => go("home")}>
          <span className="nav-icon">⌂</span> Home
        </button>
        <button className={`nav ${section === "downloads" ? "active" : ""}`} onClick={() => go("downloads")}>
          <span className="nav-icon">⤓</span> Downloads
          {activeDownloads > 0 && <small className="badge">{activeDownloads}</small>}
        </button>
        <div className="sidebar-title">
          Your playlists
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
          {playlists.map((p) => (
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
                <span className="pl-name">{playlistLabel(p)}</span>
              )}
            </button>
          ))}
          {playlists.length === 0 && <div className="sidebar-empty">No playlists yet</div>}
        </div>
        <div className="sidebar-foot">
          <label className="check">
            <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} />
            On this PC only
          </label>
          {summary && (
            <small>
              {summary.local_tracks} of {summary.tracks} downloaded
            </small>
          )}
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
            onContextMenu={(e) => {
              if (headerPlaylist) ctx.open(e, playlistMenu(headerPlaylist));
              else if (scope.album) ctx.open(e, albumMenu(scope.album));
            }}
          >
            {title}
          </h2>
          {headerPlaylist && <KeepSynced p={headerPlaylist} online={online} onChange={() => reloadPlaylists()} />}
          {showingTracks && <DensityPicker small />}
          {showingTracks && <input id="library-search" className="search" placeholder="Search title, artist, album" value={search} onChange={(e) => setSearch(e.target.value)} />}
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

        {empty ? (
          <div className="empty">{online ? "Library is empty. Download something on the server, then press Sync." : "No library yet. Connect to the server once to sync it."}</div>
        ) : section === "downloads" ? (
          <Downloads />
        ) : section === "home" ? (
          <Home
            summary={summary}
            online={online}
            env={env}
            openMenu={ctx.open}
            addToPlaylist={addToPlaylist}
            go={go}
            openAlbum={(a) => {
              setSection("albums");
              setScope({ album: a });
            }}
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
        ) : section === "albums" ? (
          <AlbumGrid albums={albums} onOpen={(a) => setScope({ ...scope, album: a })} onMenu={(e, a) => ctx.open(e, albumMenu(a))} />
        ) : section === "artists" ? (
          <ul className="list">
            {artists.map((a) => (
              <li key={a.artist_id}>
                <button
                  className="rowbtn"
                  onClick={() => {
                    setScope({ artist: a });
                    setSection("albums");
                  }}
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
          <div className="grid">
            {playlists.map((p) => (
              <button key={p.name} className="tile" onClick={() => openPlaylist(p)} onContextMenu={(e) => ctx.open(e, playlistMenu(p))}>
                <PlaylistArt p={p} size={0} />
                <div className="tile-title" title={playlistLabel(p)}>
                  {playlistLabel(p)}
                </div>
                <div className="tile-meta">
                  {p.local_count}/{p.count} on this PC
                </div>
              </button>
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

function KeepSynced({ p, online, onChange }: { p: PlaylistSummary; online: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await downloadsApi.setKeepSynced(p.name, !p.keep_synced);
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function removeAll() {
    setBusy(true);
    try {
      const ids = (await api.listTracks({ playlist: p.name, local_only: true, limit: 10000 })).map((t) => t.id);
      if (p.keep_synced) await downloadsApi.setKeepSynced(p.name, false);
      await downloadsApi.removeLocal(ids);
      onChange();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <div className="keep">
      <label className="switch" title={online ? "Download this playlist and keep new additions coming" : "Needs the server to start"}>
        <input type="checkbox" checked={p.keep_synced} disabled={busy || (!online && !p.keep_synced)} onChange={toggle} />
        <span className="slider" />
        <span>Keep synced to this PC</span>
      </label>
      <small>
        {p.local_count} of {p.count} on this PC
      </small>
      {p.local_count > 0 &&
        (confirm ? (
          <span className="dl-confirm">
            Remove {p.local_count} files?
            <button className="small danger" onClick={removeAll} disabled={busy}>
              Remove
            </button>
            <button className="small ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="small ghost" onClick={() => setConfirm(true)} title="Delete this playlist's files from this PC">
            Remove from this PC
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
    <table className={`tracks ${compact ? "compact" : ""}`}>
      {!compact && (
        <thead>
          <tr>
            <th className="c-play"></th>
            <th className="c-art"></th>
            <th className="c-local" title="Downloaded to this PC"></th>
            <th className="c-title">Title</th>
            <th>Artist</th>
            {showAlbum && <th>Album</th>}
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
              <td className="c-local">{t.local_path ? "●" : ""}</td>
              <td className="c-title">
                {t.title || t.file}
                {t.orphaned && (
                  <span className="orphan" title="No longer on the server; your copy stays until you remove it">
                    {" "}
                    · gone from server
                  </span>
                )}
              </td>
              <td>{t.artist}</td>
              {showAlbum && <td>{t.album}</td>}
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
