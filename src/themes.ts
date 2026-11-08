// Colour themes. Values come from the UI/UX design library
// (D:\projects\UI-UX-Design\project\tokens.json), mapped onto the
// variable names the app uses. The stylesheet in themes.css holds the
// same values per theme; this list drives the Theme page.

export type ThemeId =
  | "downtify"
  | "studio-light"
  | "studio-dark"
  | "retro-console"
  | "arcade"
  | "night-glass"
  | "machined"
  | "machined-light"
  | "cozy"
  | "lavender-glass";

export type ControlStyle = "modern" | "heavy";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  feel: string;
  tone: "dark" | "light";
  /** Swatches for the preview card: page, panel, text, accent. */
  swatch: { bg: string; panel: string; fg: string; accent: string };
}

export const THEMES: ThemeInfo[] = [
  { id: "downtify", name: "Downtify", feel: "Today's look", tone: "dark", swatch: { bg: "#121417", panel: "#1a1d22", fg: "#e8eaed", accent: "#1ed760" } },
  { id: "studio-light", name: "Studio Light", feel: "Warm paper, teal", tone: "light", swatch: { bg: "#f6f5f2", panel: "#ffffff", fg: "#1c1f23", accent: "#0d6e63" } },
  { id: "studio-dark", name: "Studio Dark", feel: "Studio after dark, mint", tone: "dark", swatch: { bg: "#121417", panel: "#1a1d21", fg: "#eceae5", accent: "#4fd1b8" } },
  { id: "retro-console", name: "Retro Console", feel: "Grey molded plastic", tone: "light", swatch: { bg: "#c4c4c8", panel: "#d6d6d9", fg: "#1e1e22", accent: "#4a3f8c" } },
  { id: "arcade", name: "Arcade", feel: "Near-black, yellow", tone: "dark", swatch: { bg: "#0b0d12", panel: "#151924", fg: "#f5f3ea", accent: "#ffd23f" } },
  { id: "night-glass", name: "Night Glass", feel: "Frosted dark glass, lime", tone: "dark", swatch: { bg: "#0d0f10", panel: "#1a1d1b", fg: "#f2f4ee", accent: "#d4f53c" } },
  { id: "machined", name: "Machined", feel: "Black and gold", tone: "dark", swatch: { bg: "#07090c", panel: "#11161c", fg: "#f2efe8", accent: "#e6b84a" } },
  { id: "machined-light", name: "Machined Light", feel: "Warm paper, darker gold", tone: "light", swatch: { bg: "#f2efe8", panel: "#ffffff", fg: "#15120c", accent: "#9a6f15" } },
  { id: "cozy", name: "Cozy", feel: "Cream and terracotta", tone: "light", swatch: { bg: "#fbf4ec", panel: "#fffaf4", fg: "#2e211a", accent: "#b0440f" } },
  { id: "lavender-glass", name: "Lavender Glass", feel: "Milky glass, purple", tone: "light", swatch: { bg: "#e8e6f3", panel: "#f6f5fb", fg: "#1f1b33", accent: "#5b3fd1" } },
];

export const themeById = (id: string): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Older saved prefs used "dark" / "light", and "gr1mos" for what the
 *  design library now calls Machined (shown in the app as "Sleek" before). */
export function migrateThemeId(id: string | undefined): ThemeId {
  if (id === "light") return "studio-light";
  if (!id || id === "dark") return "downtify";
  if (id === "gr1mos") return "machined";
  return THEMES.some((t) => t.id === id) ? (id as ThemeId) : "downtify";
}
