import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, coverUrl, fmtDuration, playerApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";
import { DownloadButton } from "./DownloadButton";
import { WindowControls } from "./WindowControls";
import { useContextMenu } from "./ContextMenu";
import { trackMenu } from "../views/Library";
import { OpacityBackgroundIcon, OpacityWindowIcon, PauseOutlineIcon, PinIcon, PlayOutlineIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon, VolumeIcon } from "./Icons";

interface Props {
  settings: Settings;
  online: boolean;
  onSettings: (s: Settings) => void;
  onRestoreFull: () => void;
}

export function MiniPlayer({ settings, online, onSettings, onRestoreFull }: Props) {
  const p = usePlayer();
  const { player, current } = p;
  const [coverOk, setCoverOk] = useState(true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const ctx = useContextMenu();

  // Solid while hovered, back to the chosen opacity a second after leaving.
  const [hovered, setHovered] = useState(false);
  const windowMode = settings.mini_opacity_mode === "window";
  function onEnter() {
    window.clearTimeout(fadeTimer.current);
    setHovered(true);
    if (windowMode) invoke("window_opacity_now", { percent: 100 }).catch(() => {});
  }
  function onLeave() {
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => {
      setHovered(false);
      if (windowMode) invoke("window_opacity_now", { percent: settings.mini_opacity }).catch(() => {});
    }, 1000);
  }
  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);
  const bgAlpha = windowMode || hovered ? 1 : settings.mini_opacity / 100;

  const upcoming = p.order.slice(p.cursor + 1, p.cursor + 6).map((qi) => ({ qi, t: p.queue[qi] }));
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;
  const expanded = settings.mini_expanded;

  async function toggleLike() {
    if (!current || !online) return;
    try {
      const liked = await playerApi.setLike(current.id, !current.liked);
      likeBus.emit(current.id, liked);
    } catch {
      /* ignore */
    }
  }

  const env = { online, playlists: [], setNotice: () => {}, reloadPlaylists: () => {}, promptNewPlaylist: () => {}, currentPlaylist: undefined };

  return (
    <div className={`mini ${bgAlpha < 1 ? "faded" : ""}`} onMouseEnter={onEnter} onMouseLeave={onLeave} data-tauri-drag-region style={{ "--mini-alpha": bgAlpha } as React.CSSProperties}>
      {ctx.menu}

      <div className="mini-main" data-tauri-drag-region>
        <div
          className="mini-track"
          data-tauri-drag-region
          onContextMenu={(e) => current && ctx.open(e, trackMenu([current], env, { playFirst: () => player.play(), addToPlaylist: async () => {} }))}
        >
          {current && coverOk && current.has_cover ? (
            <img className="mini-art" src={coverUrl(current.id, 150)} alt="" key={current.id} onError={() => setCoverOk(false)} />
          ) : (
            <div className="mini-art placeholder">♫</div>
          )}
          <div className="mini-meta" data-tauri-drag-region>
            <div className="mini-title">{current ? current.title || current.file : "Nothing playing"}</div>
            <div className="mini-sub">{current ? current.artist : "Open the full window to pick a song"}</div>
          </div>
        </div>

        <div className="mini-center" data-tauri-drag-region>
          <div className="mini-controls">
            <button className="icon" onClick={() => player.previous()} disabled={!current} title="Previous">
              ⏮
            </button>
            <button className="icon big mini-play" onClick={() => player.toggle()} disabled={!current && p.queue.length === 0} title="Play / pause">
              {p.playing ? <PauseOutlineIcon /> : <PlayOutlineIcon />}
            </button>
            <button className="icon" onClick={() => player.next()} disabled={!current} title="Next">
              ⏭
            </button>
          </div>
          <div className="mini-modes">
            <button className={`icon ${p.shuffle ? "on" : ""}`} onClick={() => player.toggleShuffle()} title="Shuffle">
              <ShuffleIcon />
            </button>
            <button className={`icon ${p.repeat !== "off" ? "on" : ""}`} onClick={() => player.cycleRepeat()} title={`Repeat: ${p.repeat}`}>
              {p.repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
            </button>
          </div>
        </div>

        <div className="mini-side">
          <div className="mini-side-row chrome">
            <button
              className={`icon pin ${settings.mini_pinned ? "on" : ""}`}
              onClick={() => invoke<Settings>("set_mini_pinned", { on: !settings.mini_pinned }).then(onSettings).catch(() => {})}
              title={settings.mini_pinned ? "Pinned above other windows (click to unpin)" : "Pin above other windows"}
            >
              <PinIcon />
            </button>
            <WindowControls onRestoreFull={onRestoreFull} />
          </div>
          <div className="mini-side-row">
            {current ? (
              <>
                <button className={`icon heart ${current.liked ? "on" : ""}`} onClick={toggleLike} disabled={!online} title={current.liked ? "Unlike" : "Like"}>
                  {current.liked ? "♥" : "♡"}
                </button>
                <DownloadButton track={current} online={online} size={16} />
              </>
            ) : (
              <span />
            )}
          </div>
          <div className="mini-side-row">
            <label className="mini-volume" title="Volume (scroll to change by 2)">
              <span>
                <VolumeIcon muted={p.muted || p.volume === 0} />
              </span>
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
        </div>
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

      {expanded && (
        <div className="mini-drawer">
          <div className="mini-drawer-head">
            <span>Up next</span>
            <span className="mini-opacity-ctl">
              <button
                className="icon"
                onClick={() => invoke<Settings>("set_mini_opacity_mode", { mode: windowMode ? "background" : "window" }).then(onSettings).catch(() => {})}
                title={windowMode ? "Fading the whole window. Click to fade only the background" : "Fading only the background; song stays solid. Click to fade the whole window"}
              >
                {windowMode ? <OpacityWindowIcon /> : <OpacityBackgroundIcon />}
              </button>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={settings.mini_opacity}
                title={`Opacity ${settings.mini_opacity}%`}
                onChange={(e) => invoke<Settings>("set_mini_opacity", { percent: Number(e.target.value) }).then(onSettings).catch(() => {})}
              />
              <small>{settings.mini_opacity}%</small>
            </span>
          </div>
          <div className="mini-queue">
            {upcoming.length === 0 && <div className="mini-queue-empty">End of queue</div>}
            {upcoming.map(({ qi, t }, i) => (
              <button key={`${qi}-${i}`} className="mini-next-item" onClick={() => player.playQueueIndex(qi)} title="Play now">
                <span className="q-title">{t.title}</span>
                <span className="q-sub">{t.artist}</span>
                <small>{fmtDuration(t.duration)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        className="mini-handle"
        onClick={() => invoke<Settings>("set_mini_expanded", { on: !expanded }).then(onSettings).catch(() => {})}
        title={expanded ? "Hide up next and opacity" : "Show up next and opacity"}
      >
        <span className="mini-handle-bar" />
        <span className="mini-handle-arrow">{expanded ? "⌃" : "⌄"}</span>
      </button>
    </div>
  );
}
