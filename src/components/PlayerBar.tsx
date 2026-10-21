import { useState } from "react";
import { coverUrl, fmtDuration, playerApi } from "../api";
import { usePlayer } from "../player/usePlayer";
import { likeBus } from "../likeBus";

export function PlayerBar({ online, onReveal }: { online: boolean; onReveal: () => void }) {
  const p = usePlayer();
  const { player, current } = p;
  const [likeBusy, setLikeBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(true);

  async function toggleLike() {
    if (!current || likeBusy || !online) return;
    setLikeBusy(true);
    try {
      const liked = await playerApi.setLike(current.id, !current.liked);
      likeBus.emit(current.id, liked);
    } catch {
      /* banner elsewhere */
    } finally {
      setLikeBusy(false);
    }
  }

  const pct = p.duration ? (p.position / p.duration) * 100 : 0;

  return (
    <footer className="playerbar">
      <div className="pb-track">
        {current ? (
          <>
            {coverOk && current.has_cover ? (
              <img className="pb-art" src={coverUrl(current.id, 150)} alt="" onError={() => setCoverOk(false)} key={current.id} />
            ) : (
              <div className="pb-art placeholder">♫</div>
            )}
            <div className="pb-meta">
              <button className="pb-title linkish" title="Show the list this is playing from" onClick={onReveal}>
                {current.title || current.file}
              </button>
              <div className="pb-sub" title={`${current.artist} — ${current.album}`}>
                {current.artist}
                {current.album ? ` — ${current.album}` : ""}
                {!current.local_path && <span className="pb-stream" title="Streaming from the server"> · streaming</span>}
              </div>
            </div>
            <button
              className={`icon heart ${current.liked ? "on" : ""}`}
              onClick={toggleLike}
              disabled={!online || likeBusy}
              title={online ? (current.liked ? "Unlike (Ctrl+L)" : "Like (Ctrl+L)") : "Likes need the server"}
            >
              {current.liked ? "♥" : "♡"}
            </button>
          </>
        ) : (
          <div className="pb-meta muted">Nothing playing. Double-click a song to start.</div>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon ${p.shuffle ? "on" : ""}`} onClick={() => player.toggleShuffle()} title="Shuffle">
            ⇄
          </button>
          <button className="icon" onClick={() => player.previous()} title="Previous (Ctrl+Left)" disabled={!current}>
            ⏮
          </button>
          <button className="icon big" onClick={() => player.toggle()} title="Play/Pause (Space)" disabled={!current && p.queue.length === 0}>
            {p.playing ? "⏸" : "▶"}
          </button>
          <button className="icon" onClick={() => player.next()} title="Next (Ctrl+Right)" disabled={!current}>
            ⏭
          </button>
          <button className={`icon ${p.repeat !== "off" ? "on" : ""}`} onClick={() => player.cycleRepeat()} title={`Repeat: ${p.repeat}`}>
            {p.repeat === "one" ? "🔂" : "🔁"}
          </button>
        </div>
        <div className="pb-seek">
          <span className="pb-time">{fmtDuration(p.position)}</span>
          <input
            type="range"
            min={0}
            max={p.duration || 0}
            step={0.5}
            value={Math.min(p.position, p.duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
            disabled={!current || !p.duration}
            style={{ backgroundSize: `${pct}% 100%` }}
          />
          <span className="pb-time">{fmtDuration(p.duration)}</span>
        </div>
        {p.error && <div className="pb-error">{p.error}</div>}
        {p.loading && !p.error && <div className="pb-loading">Loading…</div>}
      </div>

      <div className="pb-right">
        <button className="icon" onClick={() => player.toggleMute()} title={p.muted ? "Unmute" : "Mute"}>
          {p.muted || p.volume === 0 ? "🔇" : p.volume < 0.5 ? "🔉" : "🔊"}
        </button>
        <input
          className="pb-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={p.muted ? 0 : Math.round(p.volume * 100)}
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 2 : -2;
            player.setVolume((p.muted ? 0 : p.volume) + delta / 100);
          }}
          title="Volume (scroll to change by 2)"
          style={{ backgroundSize: `${p.muted ? 0 : p.volume * 100}% 100%` }}
        />
        <button className={`icon ${p.queueOpen ? "on" : ""}`} onClick={() => player.setQueueOpen(!p.queueOpen)} title="Queue">
          ☰
        </button>
      </div>
    </footer>
  );
}
