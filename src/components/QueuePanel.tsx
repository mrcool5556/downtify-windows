import { useEffect, useRef } from "react";
import { fmtDuration } from "../api";
import { usePlayer } from "../player/usePlayer";

export function QueuePanel() {
  const { queue, order, cursor, current, player } = usePlayer();
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
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

  function Row({ index, isCurrent, dim, ref }: { index: number; isCurrent?: boolean; dim?: boolean; ref?: React.Ref<HTMLLIElement> }) {
    const t = queue[index];
    if (!t) return null;
    return (
      <li ref={ref} className={`${isCurrent ? "current" : ""} ${dim ? "dim" : ""}`}>
        <button className="rowbtn" onDoubleClick={() => player.playQueueIndex(index)} title="Double-click to play">
          <span className="q-main">
            <span className="q-title">{t.title || t.file}</span>
            <span className="q-sub">{t.artist}</span>
          </span>
          <small>{fmtDuration(t.duration)}</small>
        </button>
      </li>
    );
  }
}
