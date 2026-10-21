import { useEffect } from "react";

const ROWS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 seconds"],
  ["Ctrl + ← / →", "Previous / next song"],
  ["Ctrl + L", "Like / unlike the playing song"],
  ["Ctrl + K  or  Ctrl + F", "Search, or paste a link to download"],
  ["Alt + ← / →", "Back / forward"],
  ["Scroll on volume", "Volume ± 2"],
  ["Double-click a song", "Play it, with its list as the queue"],
  ["Right-click", "Menu for songs, albums, playlists, queue"],
  ["Drag songs onto a playlist", "Copy (hold Shift to move)"],
  ["Esc", "Close this"],
  ["?", "Show this"],
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h3>Keyboard shortcuts</h3>
          <button className="icon" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <table className="shortcuts">
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
