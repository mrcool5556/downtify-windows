import { useEffect, useState } from "react";
import { Track, fmtDuration } from "../api";
import { usePlayer } from "../player/usePlayer";
import { OnlineSong, findInLibrary, libraryIndex, requestDownload, songArtist, toTrack, videoIdOf } from "../discover";
import { MenuItem } from "./ContextMenu";
import { player as playerSingleton } from "../player/store";

/**
 * Songs from outside the library. Double-click plays (full stream for
 * YouTube rows, a 30 s preview otherwise); the arrow asks the server to
 * add the song. Songs already in the library say so and play your copy.
 */
export function OnlineList({
  songs,
  online,
  openMenu,
  context,
  compact,
}: {
  songs: OnlineSong[];
  online: boolean;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  context: { section: string; scope: Record<string, unknown>; search: string; localOnly: boolean };
  compact?: boolean;
}) {
  const { current, playing } = usePlayer();
  const [idx, setIdx] = useState<Map<string, Track> | null>(null);
  const [requested, setRequested] = useState<Record<number, "busy" | "done" | string>>({});

  useEffect(() => {
    libraryIndex().then(setIdx).catch(() => setIdx(new Map()));
  }, []);

  const tracks = songs.map((s) => toTrack(s, idx ?? undefined));
  const play = (i: number) => playerSingleton.playList(tracks, i, context);

  async function download(i: number) {
    setRequested((r) => ({ ...r, [i]: "busy" }));
    try {
      await requestDownload(songs[i]);
      setRequested((r) => ({ ...r, [i]: "done" }));
    } catch (e) {
      setRequested((r) => ({ ...r, [i]: String(e) }));
    }
  }

  function menu(i: number): MenuItem[] {
    const inLib = idx ? !!findInLibrary(idx, songs[i]) : false;
    return [
      { label: "Play", onClick: () => play(i) },
      { label: "Play next", onClick: () => playerSingleton.playNext([tracks[i]]) },
      { label: "Add to queue", onClick: () => playerSingleton.addToQueue([tracks[i]]) },
      { separator: true },
      { label: inLib ? "Already in your library" : "Add to library (download on server)", disabled: inLib || !online || requested[i] === "done", onClick: () => download(i) },
    ];
  }

  if (songs.length === 0) return <div className="empty">Nothing here.</div>;
  return (
    <table className={`tracks online ${compact ? "compact" : ""}`}>
      <tbody>
        {songs.map((s, i) => {
          const t = tracks[i];
          const inLib = !t.online;
          const isCurrent = current?.id === t.id;
          const full = inLib || !!videoIdOf(s);
          const req = requested[i];
          return (
            <tr
              key={`${t.id}-${i}`}
              className={`${isCurrent ? "current" : ""}`}
              onDoubleClick={() => play(i)}
              onContextMenu={(e) => openMenu(e, menu(i))}
              title={full ? "Double-click to play" : "Double-click to hear a 30-second preview"}
            >
              <td className="c-play">
                <button
                  className="icon rowplay"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCurrent) playerSingleton.toggle();
                    else play(i);
                  }}
                >
                  {isCurrent && playing ? "⏸" : "▶"}
                </button>
              </td>
              <td className="c-art">{s.cover_url ? <img className="row-art" src={s.cover_url} alt="" loading="lazy" /> : <div className="row-art">♫</div>}</td>
              <td className="c-title">
                {s.name}
                {inLib ? <span className="badge-in">in library</span> : !full ? <span className="badge-pre">preview</span> : null}
              </td>
              <td className="c-artist">{songArtist(s)}</td>
              <td className="c-dl">
                {inLib ? (
                  <span className="dl-glyph-ok" title="In your library">
                    ✓
                  </span>
                ) : (
                  <button
                    className="icon dl"
                    disabled={!online || req === "busy" || req === "done"}
                    title={req === "done" ? "Requested; it appears after the next sync" : req && req !== "busy" ? `Failed: ${req}` : "Add to library (download on server)"}
                    onClick={(e) => {
                      e.stopPropagation();
                      download(i);
                    }}
                  >
                    {req === "done" ? "✓" : req === "busy" ? "…" : "⤓"}
                  </button>
                )}
              </td>
              <td className="c-dur">{fmtDuration(Number(s.duration) || 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
