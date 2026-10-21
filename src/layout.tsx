// Per-PC look-and-feel choices, remembered in localStorage.
import { useSyncExternalStore } from "react";

export type Density = "compact" | "comfortable";

export interface LayoutPrefs {
  density: Density;
  rowArt: boolean;
}

const KEY = "downtify.layout";
const DEFAULTS: LayoutPrefs = { density: "compact", rowArt: true };

let prefs: LayoutPrefs = load();
const listeners = new Set<() => void>();

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LayoutPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setLayout(patch: Partial<LayoutPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* fine */
  }
  for (const l of listeners) l();
}

export function useLayout(): LayoutPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => prefs,
  );
}

export function DensityPicker({ small }: { small?: boolean }) {
  const { density } = useLayout();
  return (
    <div className={`seg ${small ? "seg-small" : ""}`} role="radiogroup" aria-label="Row density">
      <button className={density === "compact" ? "on" : ""} onClick={() => setLayout({ density: "compact" })} title="Compact rows">
        Compact
      </button>
      <button className={density === "comfortable" ? "on" : ""} onClick={() => setLayout({ density: "comfortable" })} title="Roomier rows">
        Comfortable
      </button>
    </div>
  );
}
