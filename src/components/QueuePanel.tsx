import { forwardRef, useCallback, useEffect, useRef } from "react";
import { fmtDuration, playerApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";

export function QueuePanel({ online }: { online: boolean }) {
  const { queue, order, cursor, current, player } = usePlayer();
  const currentRef = useRef<HTMLLIElement>(null);

  const jumpToCurrent = useCallback(() => {
    currentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Follow the song: when it changes, bring it near the top.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, [current?.id]);

  const upcoming = order.slice(Math.max(cursor, 0));
  const played = cursor > 0 ? order.slice(0, cursor) : [];

  return (
    <aside className="queue">
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
      {queue.length === 0 ? (
        <div className="empty">Nothing queued.</div>
      ) : (
        <ol className="queue-list">
          {played.map((qi) => (
            <Row key={`p-${qi}`} index={qi} dim />
          ))}
          {upcoming.map((qi, i) => (
            <Row key={`u-${qi}`} index={qi} isCurrent={i === 0 && cursor >= 0} ref={i === 0 ? currentRef : undefined} />
          ))}
        </ol>
      )}
    </aside>
  );

  function Row(props: { index: number; isCurrent?: boolean; dim?: boolean; ref?: React.Ref<HTMLLIElement> }) {
    return <QueueRow {...props} online={online} />;
  }
}

interface RowProps {
  index: number;
  isCurrent?: boolean;
  dim?: boolean;
  online: boolean;
}

const QueueRow = forwardRef<HTMLLIElement, RowProps>(function QueueRow({ index, isCurrent, dim, online }, ref) {
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
    <li ref={ref} className={`${isCurrent ? "current" : ""} ${dim ? "dim" : ""}`}>
      <div className="rowbtn q-row" onDoubleClick={() => player.playQueueIndex(index)} title="Double-click to play">
        <span className="q-main">
          <span className="q-title">{t.title || t.file}</span>
          <span className="q-sub">{t.artist}</span>
        </span>
        <button className={`icon heart ${t.liked ? "on" : ""}`} disabled={!online} onClick={toggleLike} title={t.liked ? "Unlike" : "Like"}>
          {t.liked ? "♥" : "♡"}
        </button>
        <small>{fmtDuration(t.duration)}</small>
      </div>
    </li>
  );
});
