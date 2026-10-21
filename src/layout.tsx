// Per-PC look-and-feel choices, remembered in localStorage.
import { useSyncExternalStore } from "react";

export type Density = "compact" | "comfortable" | "grid";
export type Theme = "dark" | "light";

export interface LayoutPrefs {
  density: Density;
  rowArt: boolean;
  theme: Theme;
  sidebarCollapsed: boolean;
  /** Admin accounts receive every user's playlist; show them in their own section. */
  showOthersPlaylists: boolean;
}

const KEY = "downtify.layout";
const DEFAULTS: LayoutPrefs = { density: "compact", rowArt: true, theme: "dark", sidebarCollapsed: false, showOthersPlaylists: false };

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

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}
applyTheme();

export function setLayout(patch: Partial<LayoutPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* fine */
  }
  applyTheme();
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

const ICONS: Record<Density, { title: string; svg: JSX.Element }> = {
  compact: {
    title: "Compact rows",
    svg: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <rect x="2" y="3" width="12" height="1.6" rx="0.8" fill="currentColor" />
        <rect x="2" y="7.2" width="12" height="1.6" rx="0.8" fill="currentColor" />
        <rect x="2" y="11.4" width="12" height="1.6" rx="0.8" fill="currentColor" />
      </svg>
    ),
  },
  comfortable: {
    title: "Roomier rows",
    svg: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <rect x="2" y="2.5" width="12" height="4.5" rx="1.2" fill="currentColor" />
        <rect x="2" y="9" width="12" height="4.5" rx="1.2" fill="currentColor" />
      </svg>
    ),
  },
  grid: {
    title: "Tiles",
    svg: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" />
        <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" />
        <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" />
        <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" />
      </svg>
    ),
  },
};

export function DensityPicker({ small }: { small?: boolean }) {
  const { density } = useLayout();
  return (
    <div className={`seg ${small ? "seg-small" : ""}`} role="radiogroup" aria-label="List layout">
      {(Object.keys(ICONS) as Density[]).map((d) => (
        <button key={d} className={density === d ? "on" : ""} onClick={() => setLayout({ density: d })} title={ICONS[d].title}>
          {ICONS[d].svg}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const { theme } = useLayout();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button className="icon" onClick={() => setLayout({ theme: next })} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
