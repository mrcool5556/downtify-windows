import { useEffect, useRef, useState } from "react";
import { saveAndLike } from "../saveLike";
import { PlaylistSummary, Track, api, isEditable, playerApi, playlistsApi } from "../api";
import { player } from "../player/store";
import { likeBus } from "../likeBus";
import { downloadsApi, useDownload } from "../downloads";
import { navBus } from "../navBus";
import { DiscoverIcon, PrevIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon } from "./Icons";

/**
 * The mini player's own right-click menu: a strip of themed keys that fits
 * inside the mini instead of a tall list that gets cut off.
 * Row 1: the main actions as keys. Row 2: a label for the hovered key and a
 * few text links, or the playlist picker after "Add to playlist".
 */
export function MiniStrip({
  track,
  online,
  shuffle,
  repeat,
  onClose,
  onOpenFull,
}: {
  track: Track;
  online: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState("");
  const [picking, setPicking] = useState(false);
  const [lists, setLists] = useState<PlaylistSummary[]>([]);
  const [note, setNote] = useState("");
  const dl = useDownload(track.id);
  const downloading = dl && (dl.status === "queued" || dl.status === "downloading");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function act(fn: () => unknown, keepOpen = false) {
    try {
      fn();
    } finally {
      if (!keepOpen) onClose();
    }
  }

  async function startPicking() {
    setPicking(true);
    try {
      setLists((await api.listPlaylists()).filter(isEditable));
    } catch {
      setLists([]);
    }
  }

  async function addTo(name: string) {
    try {
      const r = await playlistsApi.editTracks(name, [track.id], []);
      setNote(r.added ? `Added to ${name}` : `Already in ${name}`);
      setTimeout(onClose, 900);
    } catch (e) {
      setNote(String(e).includes("Sign in") ? "Sign in under Settings → Server first" : String(e));
    }
  }

  function openInFull(target: Parameters<typeof navBus.go>[0]) {
    onOpenFull();
    // The full window mounts the library after the switch; navBus queues the request until then.
    setTimeout(() => navBus.go(target), 50);
  }

  const key = (label: string, onClick: () => void, child: React.ReactNode, opts: { on?: boolean; disabled?: boolean } = {}) => (
    <button
      className={`icon k-util strip-key ${opts.on ? "on" : ""}`}
      disabled={opts.disabled}
      onClick={onClick}
      onMouseEnter={() => setHint(label)}
      onMouseLeave={() => setHint("")}
      onFocus={() => setHint(label)}
      aria-label={label}
      title={label}
    >
      {child}
    </button>
  );

  return (
    <div className="mini-strip" ref={ref} onContextMenu={(e) => e.preventDefault()} role="menu" aria-label="Song actions">
      <div className="strip-row">
        {key("Previous", () => act(() => player.previous()), <PrevIcon />)}
        {key("Shuffle", () => act(() => player.toggleShuffle(), true), <ShuffleIcon />, { on: shuffle })}
        {key(`Repeat: ${repeat}`, () => act(() => player.cycleRepeat(), true), repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />, { on: repeat !== "off" })}
        {key(
          track.online ? "Save to your library and like it" : track.liked ? "Unlike" : "Like",
          () =>
            act(
              () =>
                track.online
                  ? saveAndLike(track).catch(() => {})
                  : playerApi
                      .setLike(track.id, !track.liked)
                      .then((liked) => likeBus.emit(track.id, liked))
                      .catch(() => {}),
              true,
            ),
          track.liked ? "♥" : "♡",
          { on: track.liked, disabled: !online },
        )}
        {track.local_path
          ? key("Remove from this PC", () => act(() => downloadsApi.removeLocal([track.id])), "✓", { on: true })
          : key(downloading ? "Downloading…" : "Download to this PC", () => act(() => downloadsApi.download([track.id]), true), "⤓", { disabled: !online || !!downloading })}
        {key("Add to playlist", () => startPicking(), "＋", { disabled: !online, on: picking })}
        {key("Go to album", () => act(() => openInFull({ album_id: track.album_id, album: track.album, album_artist: track.album_artist, artist_id: track.artist_id, cover_track_id: track.id })), "◫", {
          disabled: !track.album_id,
        })}
        {key(
          "Songs like this",
          () =>
            act(() => {
              onOpenFull();
              setTimeout(() => player.openPanel("like"), 80);
            }),
          <DiscoverIcon />,
          { disabled: !online },
        )}
        {key("Open full window", () => act(onOpenFull), "⤢")}
        <button className="icon strip-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="strip-row2">
        {note ? (
          <span className="strip-note">{note}</span>
        ) : picking ? (
          <span className="strip-lists">
            {lists.length === 0 && <span className="strip-hint">No editable playlists yet. Create one in the full window.</span>}
            {lists.map((l) => (
              <button key={l.name} className="strip-link chip" onClick={() => addTo(l.name)}>
                {l.name}
              </button>
            ))}
          </span>
        ) : (
          <>
            <span className="strip-hint">{hint || track.title}</span>
            <span className="strip-links">
              <button className="strip-link" disabled={!track.artist_id} onClick={() => act(() => openInFull({ artist_id: track.artist_id, artist: track.album_artist || track.artist }))}>
                Go to artist
              </button>
              <button className="strip-link" onClick={() =>
                  act(() => {
                    onOpenFull();
                    setTimeout(() => player.reveal(), 50);
                  })
                }>
                Show in list
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
