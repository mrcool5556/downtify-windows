import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Track, fmtDuration, homeApi, playerApi, PlaylistSummary, playlistsApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";
import { MenuItem, useContextMenu } from "../components/ContextMenu";
import { trackMenu } from "../views/Library";
import { api } from "../api";
import { OnlineList } from "./OnlineList";
import { OnlineSong, libraryIndex, similarTo, toTrack } from "../discover";

export function QueuePanel({ online }: { online: boolean }) {
  const { queue, order, cursor, current, player } = usePlayer();
  const currentRef = useRef<HTMLLIElement>(null);
  const ctx = useContextMenu();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [notice, setNotice] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { panelTab: tab, radio } = usePlayer();
  const setTab = (t: "queue" | "recent" | "like") => player.setPanelTab(t);
  const [recent, setRecent] = useState<Track[]>([]);
  useEffect(() => {
    if (tab === "recent") homeApi.recentPlays(50).then(setRecent).catch(() => {});
  }, [tab, current?.id]);
  useEffect(() => likeBus.on((id, liked) => setRecent((ts) => ts.map((t) => (t.id === id ? { ...t, liked } : t)))), []);

  useEffect(() => {
    api.listPlaylists().then(setPlaylists).catch(() => {});
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const jumpToCurrent = useCallback(() => {
    currentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, [current?.id]);

  async function addToPlaylist(name: string, ids: string[]) {
    try {
      const r = await playlistsApi.editTracks(name, ids, []);
      setPlaylists(r.playlists);
      setNotice(`Added ${r.added} to "${name}"`);
    } catch (e) {
      setNotice(String(e));
    }
  }

  const env = {
    online,
    playlists,
    setNotice,
    reloadPlaylists: () => api.listPlaylists().then(setPlaylists).catch(() => {}),
    promptNewPlaylist: () => setNotice("Create playlists from the + in the sidebar"),
    currentPlaylist: undefined,
  };

  function menuFor(orderPos: number): MenuItem[] {
    const qi = order[orderPos];
    const t = queue[qi];
    return trackMenu([t], env, {
      playFirst: () => player.playQueueIndex(qi),
      addToPlaylist,
      extra: [{ label: "Remove from queue", onClick: () => player.removeFromQueue(qi) }],
    });
  }

  return (
    <aside className="queue">
      {ctx.menu}
      <div className="queue-head">
        <div className="seg seg-small tabs2">
          <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
            Queue <small>{queue.length}</small>
          </button>
          <button className={tab === "recent" ? "on" : ""} onClick={() => setTab("recent")}>
            Recent
          </button>
          <button className={tab === "like" ? "on" : ""} onClick={() => setTab("like")} title="Songs like the one playing">
            Like this
          </button>
        </div>
        {tab === "queue" && (
          <button className="icon" onClick={jumpToCurrent} title="Jump to the playing song" disabled={!current}>
            ⌖
          </button>
        )}
        <button className="icon" onClick={() => player.setQueueOpen(false)} title="Close">
          ✕
        </button>
      </div>
      {notice && <div className="toast">{notice}</div>}
      {tab === "like" ? (
        <LikeThis online={online} radio={radio} openMenu={ctx.open} />
      ) : tab === "recent" ? (
        recent.length === 0 ? (
          <div className="empty">Nothing played yet.</div>
        ) : (
          <ol className="queue-list">
            {recent.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <div
                  className="rowbtn q-row"
                  onDoubleClick={() => player.playList(recent, i, { section: "home", scope: {}, search: "recent-plays", localOnly: false })}
                  onContextMenu={(e) => ctx.open(e, trackMenu([t], env, { playFirst: () => player.playList(recent, i), addToPlaylist }))}
                  title="Double-click to play · right-click for more"
                >
                  <span className="q-main">
                    <span className="q-title">{t.title || t.file}</span>
                    <span className="q-sub">{t.artist}</span>
                  </span>
                  <span className="q-end">
                    <button
                      className={`icon heart ${t.liked ? "on" : ""}`}
                      disabled={!online}
                      onClick={(e) => {
                        e.stopPropagation();
                        playerApi.setLike(t.id, !t.liked).then((liked) => likeBus.emit(t.id, liked)).catch(() => {});
                      }}
                      title={t.liked ? "Unlike" : "Like"}
                    >
                      {t.liked ? "♥" : "♡"}
                    </button>
                    <small>{fmtDuration(t.duration)}</small>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : queue.length === 0 ? (
        <div className="empty">Nothing queued.</div>
      ) : (
        <ol className="queue-list">
          {order.map((qi, pos) => (
            <QueueRow
              key={`${pos}-${qi}`}
              index={qi}
              isCurrent={pos === cursor}
              dim={pos < cursor}
              online={online}
              ref={pos === cursor ? currentRef : undefined}
              onMenu={(e) => ctx.open(e, menuFor(pos))}
              dragging={dragFrom === pos}
              dragOver={dragOver === pos}
              onDragStart={() => setDragFrom(pos)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== pos) setDragOver(pos);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null) player.moveInOrder(dragFrom, pos);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}

interface RowProps {
  index: number;
  isCurrent?: boolean;
  dim?: boolean;
  online: boolean;
  onMenu: (e: React.MouseEvent) => void;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

const QueueRow = forwardRef<HTMLLIElement, RowProps>(function QueueRow(
  { index, isCurrent, dim, online, onMenu, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd },
  ref,
) {
  const { queue, player } = usePlayer();
  const t = queue[index];
  if (!t) return null;

  async function toggleLike(e: React.MouseEvent) {
    e.stopPropagation();
    if (!online) return;
    try {
      const liked = await playerApi.setLike(t.id, !t.liked);
      likeBus.emit(t.id, liked);
    } catch {
      /* keep as is */
    }
  }

  return (
    <li
      ref={ref}
      className={`${isCurrent ? "current" : ""} ${dim ? "dim" : ""} ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.title);
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={onMenu}
    >
      <div className="rowbtn q-row" onDoubleClick={() => player.playQueueIndex(index)} title="Double-click to play · drag to reorder · right-click for more">
        <span className="q-main">
          <span className="q-title">{t.title || t.file}</span>
          <span className="q-sub">{t.artist}</span>
        </span>
        <span className="q-end">
          <button className={`icon heart ${t.liked ? "on" : ""}`} disabled={!online} onClick={toggleLike} title={t.liked ? "Unlike" : "Like"}>
            {t.liked ? "♥" : "♡"}
          </button>
          <small>{fmtDuration(t.duration)}</small>
        </span>
        <button
          className="icon q-remove"
          title="Remove from queue"
          onClick={(e) => {
            e.stopPropagation();
            player.removeFromQueue(index);
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
});


/** "Like this": songs similar to the playing one, with Start radio. */
function LikeThis({ online, radio, openMenu }: { online: boolean; radio: boolean; openMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const { current, player } = usePlayer();
  const [songs, setSongs] = useState<OnlineSong[] | null>(null);
  const [error, setError] = useState("");
  const seed = current ? `${current.artist}|${current.title}` : "";

  useEffect(() => {
    if (!current || !online) return;
    let cancelled = false;
    setSongs(null);
    setError("");
    similarTo(current.artist, current.title, 30)
      .then((s) => !cancelled && setSongs(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, online]);

  async function startRadio() {
    if (!current || !songs) return;
    const idx = await libraryIndex();
    const tracks = [current, ...songs.map((s) => toTrack(s, idx)).filter((t) => t.id !== current.id)];
    player.startRadio(tracks, async (t) => (await similarTo(t.artist, t.title, 20)).map((s) => toTrack(s, idx)));
  }

  if (!online) return <div className="empty">Songs like this need the server.</div>;
  if (!current) return <div className="empty">Play something to see songs like it.</div>;
  return (
    <div className="likethis">
      <div className="likethis-head">
        <span className="hint">
          Like <b>{current.title}</b>
        </span>
        {radio ? (
          <button className="small" onClick={() => player.stopRadio()} title="Stop adding songs automatically">
            Radio on · stop
          </button>
        ) : (
          <button className="small primary" onClick={startRadio} disabled={!songs?.length} title="Play these, and keep adding more like the song playing">
            Start radio
          </button>
        )}
      </div>
      {error ? <div className="empty">{error}</div> : songs === null ? <div className="hint" style={{ padding: 12 }}>Finding songs like this…</div> : <OnlineList songs={songs} online={online} openMenu={openMenu} context={{ section: "home", scope: {}, search: "like-this", localOnly: false }} compact />}
    </div>
  );
}
