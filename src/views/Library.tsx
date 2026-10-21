import { useEffect, useRef, useState } from "react";
import { Album, Artist, PlaylistSummary, Summary, Track, api, coverUrl, fmtDuration, homeApi, playerApi, playlistCoverUrl } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";
import { DensityPicker, useLayout } from "../layout";

type Section = "home" | "tracks" | "albums" | "artists" | "playlists";

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
};

export function Library({ online, summary }: { online: boolean; summary: Summary | null }) {
  const [section, setSection] = useState<Section>("home");
  const [scope, setScope] = useState<Scope>({});
  const [search, setSearch] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [error, setError] = useState("");
  const { player, revealNonce, context, current } = usePlayer();
  const [revealPending, setRevealPending] = useState(false);
  const layout = useLayout();

  const playContext = { section, scope, search, localOnly };

  // "Show the list this is playing from": restore that view, then scroll
  // to the current song once its rows are in.
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
    const row = document.querySelector<HTMLElement>(`tr[data-track-id="${CSS.escape(current.id)}"]`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      setRevealPending(false);
    }
  }, [revealPending, tracks, current]);

  const showingTracks = section === "tracks" || !!scope.album || !!scope.playlist;

  // The sidebar's playlist list is always wanted.
  useEffect(() => {
    api.listPlaylists().then(setPlaylists).catch(() => {});
  }, [summary?.playlists, summary?.local_tracks]);

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
  }, [section, scope, search, localOnly, showingTracks]);

  // Keep hearts in step with the player bar and other lists.
  useEffect(
    () => likeBus.on((id, liked) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, liked } : t)))),
    [],
  );

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

  const empty = summary && summary.tracks === 0;
  const title = scope.album
    ? `${scope.album.album} — ${scope.album.album_artist}`
    : scope.playlist
      ? playlistLabel(scope.playlist)
      : scope.artist
        ? scope.artist.name
        : SECTION_TITLE[section];

  return (
    <div className={`library density-${layout.density} ${layout.rowArt ? "" : "no-row-art"}`}>
      <aside className="sidebar">
        <button className={`nav ${section === "home" ? "active" : ""}`} onClick={() => go("home")}>
          <span className="nav-icon">⌂</span> Home
        </button>
        <div className="sidebar-title">Your playlists</div>
        <div className="sidebar-playlists">
          {playlists.map((p) => (
            <button
              key={p.name}
              className={`pl ${scope.playlist?.name === p.name ? "active" : ""}`}
              onClick={() => openPlaylist(p)}
              title={`${p.name} · ${p.local_count}/${p.count} on this PC`}
            >
              <PlaylistArt p={p} size={28} />
              <span className="pl-name">{playlistLabel(p)}</span>
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
          {scope.playlist ? <PlaylistArt p={scope.playlist} size={30} /> : null}
          <h2>{title}</h2>
          {showingTracks && <DensityPicker small />}
          {showingTracks && (
            <input
              id="library-search"
              className="search"
              placeholder="Search title, artist, album"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </div>

        {error && <div className="error">{error}</div>}

        {empty ? (
          <div className="empty">
            {online ? "Library is empty. Download something on the server, then press Sync." : "No library yet. Connect to the server once to sync it."}
          </div>
        ) : section === "home" ? (
          <Home
            summary={summary}
            online={online}
            go={go}
            openAlbum={(a) => {
              setSection("albums");
              setScope({ album: a });
            }}
          />
        ) : showingTracks && layout.density === "grid" ? (
          <TrackGrid tracks={tracks} online={online} onPlay={(i) => player.playList(tracks, i, playContext)} />
        ) : showingTracks ? (
          <TrackTable tracks={tracks} online={online} showAlbum={!scope.album} onPlay={(i) => player.playList(tracks, i, playContext)} />
        ) : section === "albums" ? (
          <AlbumGrid albums={albums} onOpen={(a) => setScope({ ...scope, album: a })} />
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
              <button key={p.name} className="tile" onClick={() => openPlaylist(p)}>
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

function TrackGrid({ tracks, online, onPlay }: { tracks: Track[]; online: boolean; onPlay: (index: number) => void }) {
  const { current, playing, player } = usePlayer();
  if (tracks.length === 0) return <div className="empty">Nothing here.</div>;
  return (
    <div className="grid songs">
      {tracks.map((t, i) => {
        const isCurrent = current?.id === t.id;
        const playable = !!t.local_path || online;
        return (
          <button
            key={t.id}
            className={`tile ${isCurrent ? "current" : ""} ${playable ? "" : "unplayable"}`}
            disabled={!playable}
            onClick={() => (isCurrent ? player.toggle() : onPlay(i))}
            title={isCurrent && playing ? "Pause" : "Play"}
          >
            <div className="tile-art-wrap">
              {t.has_cover ? <img className="tile-art" src={coverUrl(t.id, 300)} alt="" loading="lazy" /> : <div className="tile-art">♫</div>}
              <span className="tile-play">{isCurrent && playing ? "⏸" : "▶"}</span>
              {t.local_path ? <span className="tile-dot" title="On this PC">●</span> : null}
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

function AlbumGrid({ albums, onOpen }: { albums: Album[]; onOpen: (a: Album) => void }) {
  return (
    <div className="grid">
      {albums.map((a) => (
        <button key={a.album_id} className="tile" onClick={() => onOpen(a)}>
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
  go,
  openAlbum,
}: {
  summary: Summary | null;
  online: boolean;
  go: (s: Section) => void;
  openAlbum: (a: Album) => void;
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

  const ctx = (name: string) => ({ section: "home", scope: {}, search: name, localOnly: false });

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
        <AlbumGrid albums={recentAlbums} onOpen={openAlbum} />
      </div>

      <h3>Recently added songs</h3>
      <TrackTable tracks={recentSongs} online={online} showAlbum onPlay={(i) => player.playList(recentSongs, i, ctx("recent-songs"))} compact />

      {recentPlays.length > 0 && (
        <>
          <h3>Recently played</h3>
          <TrackTable tracks={recentPlays} online={online} showAlbum onPlay={(i) => player.playList(recentPlays, i, ctx("recent-plays"))} compact />
        </>
      )}
    </div>
  );
}

function TrackTable({
  tracks,
  online,
  showAlbum,
  onPlay,
  compact,
}: {
  tracks: Track[];
  online: boolean;
  showAlbum: boolean;
  onPlay: (index: number) => void;
  compact?: boolean;
}) {
  const { player, current, playing } = usePlayer();
  const [selected, setSelected] = useState<string | null>(null);

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
              className={`${t.local_path ? "local" : "remote"} ${isCurrent ? "current" : ""} ${selected === t.id ? "selected" : ""} ${playable ? "" : "unplayable"}`}
              data-track-id={t.id}
              onClick={() => setSelected(t.id)}
              onDoubleClick={() => playable && onPlay(i)}
              title={playable ? "Double-click to play" : "Not downloaded and the server is offline"}
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
              <td className="c-title">{t.title || t.file}</td>
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
              <td className="c-dur">{fmtDuration(t.duration)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
