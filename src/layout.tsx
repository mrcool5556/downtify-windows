// Per-PC look-and-feel choices, remembered in localStorage.
import { useSyncExternalStore } from "react";
import { ControlStyle, ThemeId, migrateThemeId, themeById } from "./themes";

export type Density = "compact" | "comfortable" | "grid";
export type GroupKey = "play" | "skip" | "toggles" | "status" | "sliders" | "topbar";
export type GroupStyle = "follow" | ControlStyle;
export type ShowKey = "toggles" | "volume" | "download" | "heart";
export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "play", label: "Play key" },
  { key: "skip", label: "Previous and next" },
  { key: "toggles", label: "Shuffle and repeat" },
  { key: "status", label: "Heart and download" },
  { key: "sliders", label: "Seek and volume sliders" },
  { key: "topbar", label: "Top bar buttons and search" },
];

export interface LayoutPrefs {
  density: Density;
  rowArt: boolean;
  /** Colour theme of the full window. */
  theme: ThemeId;
  /** Modern (flat) or Heavy (beveled keys in a metal lip). */
  controlStyle: ControlStyle;
  /** The mini player's own theme and style; "" means same as the window. */
  miniTheme: ThemeId | "";
  miniStyle: ControlStyle | "";
  /** What the sun / moon button switches between. */
  darkPick: ThemeId;
  lightPick: ThemeId;
  sidebarCollapsed: boolean;
  /** Admin accounts receive every user's playlist; show them in their own section. */
  showOthersPlaylists: boolean;
  /** Per-group override of the control style ("follow" = the main choice). */
  advanced: Record<GroupKey, GroupStyle>;
  /** Optional player items; false hides them everywhere. */
  show: Record<ShowKey, boolean>;
}

const KEY = "downtify.layout";
const DEFAULTS: LayoutPrefs = {
  density: "compact",
  rowArt: true,
  theme: "downtify",
  controlStyle: "modern",
  miniTheme: "",
  miniStyle: "",
  darkPick: "downtify",
  lightPick: "studio-light",
  sidebarCollapsed: false,
  showOthersPlaylists: false,
  advanced: { play: "follow", skip: "follow", toggles: "follow", status: "follow", sliders: "follow", topbar: "follow" },
  show: { toggles: true, volume: true, download: true, heart: true },
};

let prefs: LayoutPrefs = load();
const listeners = new Set<() => void>();
let miniActive = false;

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<LayoutPrefs>) : {};
    const p = { ...DEFAULTS, ...saved };
    return {
      ...p,
      theme: migrateThemeId(p.theme as string),
      advanced: { ...DEFAULTS.advanced, ...(saved.advanced ?? {}) },
      show: { ...DEFAULTS.show, ...(saved.show ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

/** The theme and style in force right now (the mini may override them). */
export function effectiveLook(p: LayoutPrefs = prefs, mini = miniActive): { theme: ThemeId; style: ControlStyle } {
  if (mini) return { theme: p.miniTheme || p.theme, style: p.miniStyle || p.controlStyle };
  return { theme: p.theme, style: p.controlStyle };
}

/** A group's style right now: its override, or the main / mini choice. */
export function groupStyle(g: GroupKey, p: LayoutPrefs = prefs, mini = miniActive): ControlStyle {
  const a = p.advanced[g];
  return a === "follow" ? effectiveLook(p, mini).style : a;
}

function applyTheme() {
  const { theme, style } = effectiveLook();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.tone = themeById(theme).tone;
  root.dataset.style = style;
  for (const g of GROUPS) root.setAttribute(`data-s-${g.key}`, groupStyle(g.key));
  for (const k of ["toggles", "volume", "download", "heart"] as ShowKey[]) root.toggleAttribute(`data-hide-${k}`, !prefs.show[k]);
}
applyTheme();

/** The app tells us when it switches between the full window and the mini. */
export function setMiniActive(on: boolean) {
  if (miniActive === on) return;
  miniActive = on;
  applyTheme();
}

export function setLayout(patch: Partial<LayoutPrefs>) {
  prefs = { ...prefs, ...patch };
  // Picking a theme also records it as your dark or light choice for the sun button.
  if (patch.theme) {
    if (themeById(patch.theme).tone === "dark") prefs.darkPick = patch.theme;
    else prefs.lightPick = patch.theme;
  }
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
  const p = useLayout();
  const tone = themeById(p.theme).tone;
  const next = tone === "dark" ? p.lightPick : p.darkPick;
  return (
    <button className="icon" onClick={() => setLayout({ theme: next })} title={`Switch to ${themeById(next).name}`}>
      {tone === "dark" ? "☀" : "☾"}
    </button>
  );
}
