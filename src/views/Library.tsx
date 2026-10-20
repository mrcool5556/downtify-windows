import { useEffect, useState } from "react";
import { Album, Artist, PlaylistSummary, Summary, Track, api, coverUrl, fmtDuration, playerApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";

type Section = "tracks" | "albums" | "artists" | "playlists";

interface Scope {
  album?: Album;
  artist?: Artist;
  playlist?: PlaylistSummary;
}

export function Library({ online, summary }: { online: boolean; summary: Summary | null }) {
  const [section, setSection] = useState<Section>("tracks");
  const [scope, setScope] = useState<Scope>({});
  const [search, setSearch] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [error, setError] = useState("");
  const { player } = usePlayer();

  const showingTracks = section === "tracks" || !!scope.album || !!scope.playlist;

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
        } else if (section === "playlists") {
          if (!cancelled) setPlaylists(await api.listPlaylists());
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

  const empty = summary && summary.tracks === 0;

  return (
    <div className="library">
      <aside className="sidebar">
        <button className={section === "tracks" ? "active" : ""} onClick={() => go("tracks")}>
          Songs {summary ? <small>{summary.tracks}</small> : null}
        </button>
        <button className={section === "albums" ? "active" : ""} onClick={() => go("albums")}>
          Albums {summary ? <small>{summary.albums}</small> : null}
        </button>
        <button className={section === "artists" ? "active" : ""} onClick={() => go("artists")}>
          Artists {summary ? <small>{summary.artists}</small> : null}
        </button>
        <button className={section === "playlists" ? "active" : ""} onClick={() => go("playlists")}>
          Playlists {summary ? <small>{summary.playlists}</small> : null}
        </button>
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
            <button className="link" onClick={() => setScope({})}>
              ← Back
            </button>
          ) : null}
          {scope.album && scope.album.cover_track_id ? <img className="head-art" src={coverUrl(scope.album.cover_track_id, 150)} alt="" /> : null}
          <h2>
            {scope.album
              ? `${scope.album.album} — ${scope.album.album_artist}`
              : scope.playlist
                ? scope.playlist.name
                : scope.artist
                  ? scope.artist.name
                  : section[0].toUpperCase() + section.slice(1)}
          </h2>
          {showingTracks && tracks.length > 0 && (
            <button className="small" onClick={() => player.playList(tracks, 0)} title="Play all from the top">
              ▶ Play all
            </button>
          )}
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
        ) : showingTracks ? (
          <TrackTable tracks={tracks} online={online} showAlbum={!scope.album} />
        ) : section === "albums" ? (
          <div className="grid">
            {albums.map((a) => (
              <button key={a.album_id} className="tile" onClick={() => setScope({ ...scope, album: a })}>
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
          <ul className="list">
            {playlists.map((p) => (
              <li key={p.name}>
                <button className="rowbtn" onClick={() => setScope({ playlist: p })}>
                  <span>
                    {p.liked ? "♥ " : ""}
                    {p.name}
                  </span>
                  <small>
                    {p.local_count}/{p.count} on this PC
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AlbumArt({ trackId }: { trackId: string }) {
  const [failed, setFailed] = useState(false);
  if (!trackId || failed) return <div className="tile-art">♫</div>;
  return <img className="tile-art" src={coverUrl(trackId, 300)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function TrackTable({ tracks, online, showAlbum }: { tracks: Track[]; online: boolean; showAlbum: boolean }) {
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
    <table className="tracks">
      <thead>
        <tr>
          <th className="c-play"></th>
          <th className="c-local" title="Downloaded to this PC"></th>
          <th>Title</th>
          <th>Artist</th>
          {showAlbum && <th>Album</th>}
          <th className="c-like"></th>
          <th className="c-dur">Time</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((t, i) => {
          const isCurrent = current?.id === t.id;
          const playable = !!t.local_path || online;
          return (
            <tr
              key={t.id}
              className={`${t.local_path ? "local" : "remote"} ${isCurrent ? "current" : ""} ${selected === t.id ? "selected" : ""} ${playable ? "" : "unplayable"}`}
              onClick={() => setSelected(t.id)}
              onDoubleClick={() => playable && player.playList(tracks, i)}
              title={playable ? "Double-click to play" : "Not downloaded and the server is offline"}
            >
              <td className="c-play">
                <button
                  className="icon rowplay"
                  disabled={!playable}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCurrent) player.toggle();
                    else player.playList(tracks, i);
                  }}
                  title={isCurrent && playing ? "Pause" : "Play"}
                >
                  {isCurrent && playing ? "⏸" : "▶"}
                </button>
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
