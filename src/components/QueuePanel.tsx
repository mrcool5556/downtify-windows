import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { fmtDuration, playerApi, PlaylistSummary, playlistsApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";
import { MenuItem, useContextMenu } from "../components/ContextMenu";
import { trackMenu } from "../views/Library";
import { api } from "../api";

export function QueuePanel({ online }: { online: boolean }) {
  const { queue, order, cursor, current, player } = usePlayer();
  const currentRef = useRef<HTMLLIElement>(null);
  const ctx = useContextMenu();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [notice, setNotice] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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
        <h3>Queue</h3>
        <small>
          {queue.length} {queue.length === 1 ? "song" : "songs"}
        </small>
        <button className="small" onClick={jumpToCurrent} title="Scroll to the playing song" disabled={!current}>
          Jump to current
        </button>
        <button className="icon" onClick={() => player.setQueueOpen(false)} title="Close">
          ✕
        </button>
      </div>
      {notice && <div className="toast">{notice}</div>}
      {queue.length === 0 ? (
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
        <button className={`icon heart ${t.liked ? "on" : ""}`} disabled={!online} onClick={toggleLike} title={t.liked ? "Unlike" : "Like"}>
          {t.liked ? "♥" : "♡"}
        </button>
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
        <small>{fmtDuration(t.duration)}</small>
      </div>
    </li>
  );
});
