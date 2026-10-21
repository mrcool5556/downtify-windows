import { clearFinished, downloadsApi, fmtBytes, useDownloads } from "../downloads";

export function Downloads() {
  const all = useDownloads();
  const active = all.filter((p) => p.status === "downloading");
  const queued = all.filter((p) => p.status === "queued");
  const failed = all.filter((p) => p.status === "error");
  const done = all.filter((p) => p.status === "done" || p.status === "cancelled");

  if (all.length === 0) {
    return <div className="empty">No downloads yet. Use the download icon on a song, or switch on "Keep synced to this PC" on a playlist.</div>;
  }

  return (
    <div className="downloads">
      {active.length + queued.length > 0 && (
        <div className="dl-summary">
          {active.length} downloading · {queued.length} queued
          {queued.length + active.length > 0 && (
            <button
              className="small ghost"
              onClick={() => {
                for (const p of [...queued, ...active]) downloadsApi.cancel(p.track_id).catch(() => {});
              }}
            >
              Cancel all
            </button>
          )}
        </div>
      )}
      <ul className="dl-list">
        {[...active, ...queued].map((p) => {
          const pct = p.total > 0 ? (p.received / p.total) * 100 : 0;
          return (
            <li key={p.track_id} className={p.status}>
              <div className="dl-row">
                <div className="dl-meta">
                  <span className="dl-title">{p.title || p.track_id}</span>
                  <span className="dl-sub">{p.artist}</span>
                </div>
                <span className="dl-state">
                  {p.status === "queued" ? "Queued" : p.total ? `${fmtBytes(p.received)} / ${fmtBytes(p.total)}` : fmtBytes(p.received)}
                </span>
                <button className="icon" title="Cancel" onClick={() => downloadsApi.cancel(p.track_id).catch(() => {})}>
                  ✕
                </button>
              </div>
              <div className="dl-bar">
                <div className="dl-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      {failed.length > 0 && (
        <>
          <h3>Failed</h3>
          <ul className="dl-list">
            {failed.map((p) => (
              <li key={p.track_id} className="error">
                <div className="dl-row">
                  <div className="dl-meta">
                    <span className="dl-title">{p.title || p.track_id}</span>
                    <span className="dl-sub">{p.error}</span>
                  </div>
                  <button className="small" onClick={() => downloadsApi.download([p.track_id]).catch(() => {})}>
                    Retry
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {done.length > 0 && (
        <>
          <h3>
            Finished <button className="small ghost" onClick={clearFinished}>Clear</button>
          </h3>
          <ul className="dl-list dim">
            {done.map((p) => (
              <li key={p.track_id}>
                <div className="dl-row">
                  <div className="dl-meta">
                    <span className="dl-title">{p.title || p.track_id}</span>
                    <span className="dl-sub">{p.artist}</span>
                  </div>
                  <span className="dl-state">{p.status === "done" ? "On this PC" : "Cancelled"}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
