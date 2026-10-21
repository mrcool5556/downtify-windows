import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Minimize | maximize (or restore-to-full in mini) | close, for a frameless window. */
export function WindowControls({ onRestoreFull }: { onRestoreFull?: () => void }) {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (onRestoreFull) return;
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, [onRestoreFull, win]);

  return (
    <div className="winctl">
      <button className="winbtn" title="Minimize" onClick={() => win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      {onRestoreFull ? (
        <button className="winbtn" title="Back to the full window (Ctrl+M)" onClick={onRestoreFull}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 6.5V9h2.5M9 3.5V1H6.5M1 9l3.5-3.5M9 1 5.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      ) : (
        <button className="winbtn" title={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
              <path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
      )}
      <button className="winbtn close" title="Close (keeps playing in the tray)" onClick={() => win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1 1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
