import { useEffect, useState } from "react";
import { Track, api } from "../api";
import { clearFinished, downloadsApi, fmtBytes, localBus, useDownloads } from "../downloads";

/**
 * Downloads: what is still missing (greyed, with progress) above what is
 * already on this PC (a normal song list rendered by the Library).
 */
export function Downloads({ renderTable }: { renderTable: (tracks: Track[]) => JSX.Element }) {
  const all = useDownloads();
  const [local, setLocal] = useState<Track[]>([]);

  const load = () => api.listTracks({ local_only: true, limit: 10000 }).then(setLocal).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useEffect(() => localBus.on(() => load()), []);

  const active = all.filter((p) => p.status === "downloading");
  const queued = all.filter((p) => p.status === "queued");
  const failed = all.filter((p) => p.status === "error");
  const missing = [...active, ...queued, ...failed];
  const finished = all.filter((p) => p.status === "done" || p.status === "cancelled");

  return (
    <div className="downloads">
      {missing.length > 0 && (
        <>
          <h3>
            Missing from this PC
            <small>
              {active.length} downloading · {queued.length} queued{failed.length ? ` · ${failed.length} failed` : ""}
            </small>
            <button
              className="small ghost"
              onClick={() => {
                for (const p of [...queued, ...active]) downloadsApi.cancel(p.track_id).catch(() => {});
              }}
              disabled={active.length + queued.length === 0}
            >
              Cancel all
            </button>
          </h3>
          <ul className="dl-list missing">
            {missing.map((p) => {
              const pct = p.total > 0 ? (p.received / p.total) * 100 : 0;
              return (
                <li key={p.track_id} className={p.status}>
                  <div className="dl-row">
                    <div className="dl-meta">
                      <span className="dl-title">{p.title || p.track_id}</span>
                      <span className="dl-sub">{p.status === "error" ? p.error : p.artist}</span>
                    </div>
                    <span className="dl-state">
                      {p.status === "queued"
                        ? "Queued"
                        : p.status === "error"
                          ? "Failed"
                          : p.total
                            ? `${fmtBytes(p.received)} / ${fmtBytes(p.total)}`
                            : fmtBytes(p.received)}
                    </span>
                    {p.status === "error" ? (
                      <button className="small" onClick={() => downloadsApi.download([p.track_id]).catch(() => {})}>
                        Retry
                      </button>
                    ) : (
                      <button className="icon" title="Cancel" onClick={() => downloadsApi.cancel(p.track_id).catch(() => {})}>
                        ✕
                      </button>
                    )}
                  </div>
                  {p.status !== "error" && (
                    <div className="dl-bar">
                      <div className="dl-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3>
        On this PC
        <small>
          {local.length} {local.length === 1 ? "song" : "songs"}
        </small>
        {finished.length > 0 && (
          <button className="small ghost" onClick={clearFinished} title="Clear the finished entries from the activity list">
            Clear finished ({finished.length})
          </button>
        )}
      </h3>
      {local.length === 0 && missing.length === 0 ? (
        <div className="empty">Nothing downloaded yet. Use the download icon on a song, or right-click a playlist and choose "Available offline".</div>
      ) : (
        renderTable(local)
      )}
    </div>
  );
}
