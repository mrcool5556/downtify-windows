import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, coverUrl, fmtDuration, playerApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";
import { DownloadButton } from "./DownloadButton";
import { WindowControls } from "./WindowControls";
import { useContextMenu } from "./ContextMenu";
import { trackMenu } from "../views/Library";

interface Props {
  settings: Settings;
  online: boolean;
  onSettings: (s: Settings) => void;
  onRestoreFull: () => void;
}

export function MiniPlayer({ settings, online, onSettings, onRestoreFull }: Props) {
  const p = usePlayer();
  const { player, current } = p;
  const [nextOpen, setNextOpen] = useState(false);
  const [coverOk, setCoverOk] = useState(true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const ctx = useContextMenu();

  // Solid while hovered, back to the chosen opacity a second after leaving.
  function onEnter() {
    window.clearTimeout(fadeTimer.current);
    invoke("window_opacity_now", { percent: 100 }).catch(() => {});
  }
  function onLeave() {
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => {
      invoke("window_opacity_now", { percent: settings.mini_opacity }).catch(() => {});
    }, 1000);
  }
  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);

  const upcoming = p.order.slice(p.cursor + 1, p.cursor + 6).map((qi) => ({ qi, t: p.queue[qi] }));
  const next = upcoming[0]?.t;
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;

  async function toggleLike() {
    if (!current || !online) return;
    try {
      const liked = await playerApi.setLike(current.id, !current.liked);
      likeBus.emit(current.id, liked);
    } catch {
      /* ignore */
    }
  }

  const env = {
    online,
    playlists: [],
    setNotice: () => {},
    reloadPlaylists: () => {},
    promptNewPlaylist: () => {},
    currentPlaylist: undefined,
  };

  return (
    <div className="mini" onMouseEnter={onEnter} onMouseLeave={onLeave} data-tauri-drag-region>
      {ctx.menu}
      <div className="mini-row1" data-tauri-drag-region>
        <div
          className="mini-track"
          onContextMenu={(e) => current && ctx.open(e, trackMenu([current], env, { playFirst: () => player.play(), addToPlaylist: async () => {} }))}
        >
          {current && coverOk && current.has_cover ? (
            <img className="mini-art" src={coverUrl(current.id, 150)} alt="" key={current.id} onError={() => setCoverOk(false)} />
          ) : (
            <div className="mini-art placeholder">♫</div>
          )}
          <div className="mini-meta">
            <div className="mini-title">{current ? current.title || current.file : "Nothing playing"}</div>
            <div className="mini-sub">{current ? current.artist : "Open the full window to pick a song"}</div>
          </div>
        </div>

        <div className="mini-controls">
          <button className="icon" onClick={() => player.previous()} disabled={!current} title="Previous">
            ⏮
          </button>
          <button className="icon big mini-play" onClick={() => player.toggle()} disabled={!current && p.queue.length === 0} title="Play / pause">
            {p.playing ? "⏸" : "▶"}
          </button>
          <button className="icon" onClick={() => player.next()} disabled={!current} title="Next">
            ⏭
          </button>
        </div>

        <div className="mini-right">
          {current && (
            <>
              <button className={`icon heart ${current.liked ? "on" : ""}`} onClick={toggleLike} disabled={!online} title={current.liked ? "Unlike" : "Like"}>
                {current.liked ? "♥" : "♡"}
              </button>
              <DownloadButton track={current} online={online} size={16} />
            </>
          )}
          <WindowControls onRestoreFull={onRestoreFull} />
        </div>
      </div>

      <div className="mini-row2" data-tauri-drag-region>
        <button className={`icon ${p.shuffle ? "on" : ""}`} onClick={() => player.toggleShuffle()} title="Shuffle">
          ⇄
        </button>
        <button className={`icon ${p.repeat !== "off" ? "on" : ""}`} onClick={() => player.cycleRepeat()} title={`Repeat: ${p.repeat}`}>
          {p.repeat === "one" ? "🔂" : "🔁"}
        </button>

        <div className="mini-next">
          <button className="mini-next-btn" onClick={() => setNextOpen((o) => !o)} disabled={!next} title="Up next">
            {next ? (
              <>
                <span className="mini-next-label">Next:</span> {next.title} <span className="mini-next-artist">— {next.artist}</span>
              </>
            ) : (
              <span className="mini-next-label">End of queue</span>
            )}
          </button>
          {nextOpen && upcoming.length > 0 && (
            <div className="mini-next-pop" onMouseLeave={() => setNextOpen(false)}>
              {upcoming.map(({ qi, t }, i) => (
                <button
                  key={`${qi}-${i}`}
                  className="mini-next-item"
                  onClick={() => {
                    player.playQueueIndex(qi);
                    setNextOpen(false);
                  }}
                >
                  <span className="q-title">{t.title}</span>
                  <span className="q-sub">{t.artist}</span>
                  <small>{fmtDuration(t.duration)}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className={`icon ${settings.mini_pinned ? "on" : ""}`}
          onClick={() => invoke<Settings>("set_mini_pinned", { on: !settings.mini_pinned }).then(onSettings).catch(() => {})}
          title={settings.mini_pinned ? "Pinned above other windows (click to unpin)" : "Pin above other windows"}
        >
          📌
        </button>
        <label className="mini-opacity" title={`Opacity ${settings.mini_opacity}%`}>
          <span className="mini-opacity-icon">◐</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={settings.mini_opacity}
            onChange={(e) => invoke<Settings>("set_mini_opacity", { percent: Number(e.target.value) }).then(onSettings).catch(() => {})}
          />
        </label>
        <label className="mini-volume" title="Volume (scroll to change by 2)">
          <span>{p.muted || p.volume === 0 ? "🔇" : "🔊"}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={p.muted ? 0 : Math.round(p.volume * 100)}
            onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
            onWheel={(e) => {
              e.preventDefault();
              player.setVolume((p.muted ? 0 : p.volume) + (e.deltaY < 0 ? 0.02 : -0.02));
            }}
          />
        </label>
      </div>

      <input
        className="mini-seek"
        type="range"
        min={0}
        max={p.duration || 0}
        step={0.5}
        value={Math.min(p.position, p.duration || 0)}
        onChange={(e) => player.seek(Number(e.target.value))}
        disabled={!current || !p.duration}
        style={{ backgroundSize: `${pct}% 100%` }}
        title={`${fmtDuration(p.position)} / ${fmtDuration(p.duration)}`}
      />
    </div>
  );
}
