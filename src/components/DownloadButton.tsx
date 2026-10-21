import { useState } from "react";
import { Track } from "../api";
import { downloadsApi, useDownload } from "../downloads";

/**
 * One control, three states: not here (click to download), downloading
 * (progress ring, click to cancel), on this PC (click asks to remove).
 */
export function DownloadButton({ track, online, size = 16 }: { track: Track; online: boolean; size?: number }) {
  const p = useDownload(track.id);
  const [confirm, setConfirm] = useState(false);
  const active = p && (p.status === "queued" || p.status === "downloading");
  const local = !!track.local_path;

  if (confirm) {
    return (
      <span className="dl-confirm icons" onClick={(e) => e.stopPropagation()} title="Remove this file from this PC?">
        <button
          className="icon confirm-yes"
          title="Yes, remove from this PC"
          onClick={() => {
            downloadsApi.removeLocal([track.id]).catch(() => {});
            setConfirm(false);
          }}
        >
          <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="7" fill="var(--danger)" />
            <path d="M5 5h6M6.5 5V4h3v1M6 7v4.5M8 7v4.5M10 7v4.5M5.5 7l.4 5.5h4.2L10.5 7" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        <button className="icon confirm-no" title="Keep it" onClick={() => setConfirm(false)}>
          <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    );
  }

  if (active) {
    const pct = p!.total > 0 ? Math.min(100, (p!.received / p!.total) * 100) : 0;
    const r = (size - 3) / 2;
    const c = 2 * Math.PI * r;
    return (
      <button
        className="icon dl active"
        title={p!.status === "queued" ? "Queued. Click to cancel" : `Downloading ${pct.toFixed(0)}%. Click to cancel`}
        onClick={(e) => {
          e.stopPropagation();
          downloadsApi.cancel(track.id).catch(() => {});
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={p!.status === "queued" ? "dl-queued" : ""}
          />
        </svg>
      </button>
    );
  }

  if (local) {
    return (
      <button
        className="icon dl on"
        title={track.orphaned ? "On this PC (no longer on the server). Click to remove" : "On this PC. Click to remove"}
        onClick={(e) => {
          e.stopPropagation();
          setConfirm(true);
        }}
      >
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="var(--accent)" />
          <path d="M4.5 8.2 7 10.6 11.6 5.8" fill="none" stroke="#06230f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <button
      className="icon dl"
      disabled={!online}
      title={online ? (p?.status === "error" ? `Failed: ${p.error}. Click to retry` : "Download to this PC") : "Downloads need the server"}
      onClick={(e) => {
        e.stopPropagation();
        downloadsApi.download([track.id]).catch(() => {});
      }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="none" stroke={p?.status === "error" ? "var(--danger)" : "currentColor"} strokeWidth="1.3" />
        <path d="M8 4v6M5.5 7.8 8 10.3l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
