import { useEffect, useRef, useState } from "react";
import { usePlayer, usePlayerProgress } from "../player/usePlayer";
import { loadLyrics, SongLyrics } from "../lyrics";

/**
 * The lyrics page, over the song list. Synced lyrics follow the song: the
 * line being sung is lit and kept in the middle, and clicking a line jumps
 * there. Plain lyrics are shown as text.
 */
export function LyricsView() {
  const { current, player } = usePlayer();
  const [lyrics, setLyrics] = useState<SongLyrics | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    setLyrics(null);
    setFailed("");
    if (!current) return;
    let cancelled = false;
    loadLyrics(current)
      .then((l) => !cancelled && setLyrics(l))
      .catch((e) => !cancelled && setFailed(String(e)));
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && player.setLyricsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const from = lyrics?.source === "server" ? "From your Downtify server" : lyrics?.source === "lrclib" ? "From LRCLIB" : "";

  return (
    <div className="lyrics-page">
      <div className="lyrics-head">
        <div className="lyrics-song">
          <h2>{current ? current.title || current.file : "Lyrics"}</h2>
          {current && <div className="hint">{current.artist}</div>}
        </div>
        {from && <span className="hint lyrics-from">{from}</span>}
        <button className="icon" onClick={() => player.setLyricsOpen(false)} title="Close lyrics (Esc)">
          ✕
        </button>
      </div>
      {!current ? (
        <div className="lyrics-empty">Play a song to see its lyrics.</div>
      ) : failed ? (
        <div className="lyrics-empty">Couldn't get lyrics: {failed}</div>
      ) : !lyrics ? (
        <div className="lyrics-empty">Looking for lyrics…</div>
      ) : lyrics.lines.length ? (
        <SyncedLines lyrics={lyrics} onSeek={(t) => player.seek(t)} />
      ) : lyrics.plain.trim() ? (
        <div className="lyrics-plain">{lyrics.plain}</div>
      ) : (
        <div className="lyrics-empty">No lyrics found for this song.</div>
      )}
    </div>
  );
}

function SyncedLines({ lyrics, onSeek }: { lyrics: SongLyrics; onSeek: (t: number) => void }) {
  const { position } = usePlayerProgress();
  const box = useRef<HTMLDivElement>(null);
  // After the user scrolls by hand, leave the scroll alone for a few seconds.
  const handScrolled = useRef(0);
  let active = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if (lyrics.lines[i].time <= position + 0.2) active = i;
    else break;
  }

  useEffect(() => {
    if (Date.now() - handScrolled.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${Math.max(active, 0)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div
      className="lyrics-lines"
      ref={box}
      onWheel={() => (handScrolled.current = Date.now())}
      onMouseDown={() => (handScrolled.current = Date.now())}
    >
      {lyrics.lines.map((l, i) => (
        <p
          key={i}
          data-i={i}
          className={i === active ? "on" : i < active ? "past" : ""}
          onClick={() => {
            handScrolled.current = 0;
            onSeek(l.time);
          }}
          title="Jump here"
        >
          {l.text || "♪"}
        </p>
      ))}
    </div>
  );
}
