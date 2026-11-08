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

/** Button style. "modern" is the library's Flat and "heavy" its Lipped
 *  (the names the app used first, kept so saved choices still work). */
export type ControlStyle = "modern" | "heavy" | "raised" | "inset" | "neon" | "cut-paper" | "bevel95";

export const BUTTON_STYLES: [ControlStyle, string, string][] = [
  ["modern", "Flat", "Quiet, flat buttons (Modern)"],
  ["heavy", "Lipped", "Raised keys in a metal rim that press down (Heavy)"],
  ["raised", "Raised", "Keys standing up off the panel"],
  ["inset", "Inset", "Keys pressed into the panel"],
  ["neon", "Neon", "Glowing outlines in the theme colour"],
  ["cut-paper", "Cut paper", "Paper shapes with a hard shadow"],
  ["bevel95", "90s bevel", "Classic desktop buttons"],
];

/** The other parts of the look, each picked on its own. "theme" = as the colour theme has it. */
export const ASPECTS = {
  font: { label: "Fonts", options: [["theme", "As the theme"], ["studio", "Studio"], ["machined", "Machined"], ["paper", "Paper"], ["pixel", "Pixel"], ["neon", "Neon"]] },
  corners: { label: "Corners", options: [["theme", "As the theme"], ["sharp", "Sharp"], ["rounded", "Rounded"], ["pill", "Pill"]] },
  surface: { label: "Windows and cards", options: [["theme", "As the theme"], ["flat", "Flat"], ["soft-inset", "Soft inset"], ["indented", "Indented"], ["glass", "Glass"], ["paper", "Paper"], ["bevel", "Bevel"]] },
  lip: { label: "Lip metal", options: [["theme", "As the theme"], ["gold", "Gold"], ["silver", "Silver"], ["bronze", "Bronze"], ["ink", "Ink"], ["accent", "Theme colour"]] },
  lipshadow: { label: "Rim shadow", options: [["theme", "Thin edge"], ["none", "None"], ["drop", "Drop shadow"]] },
  inputs: { label: "Text fields", options: [["theme", "As the theme"], ["boxed", "Boxed"], ["sunk", "Sunk"], ["underline", "Underline"], ["notebook", "Notebook"]] },
  toggles: { label: "Switches", options: [["theme", "As the theme"], ["pill", "Pill"], ["flap", "Paper flap"], ["retro", "Retro box"]] },
} as const;
export type AspectKey = keyof typeof ASPECTS;
export type AspectValue<K extends AspectKey> = (typeof ASPECTS)[K]["options"][number][0];
export type Aspects = { [K in AspectKey]: AspectValue<K> };
export const ASPECT_DEFAULTS: Aspects = { font: "theme", corners: "theme", surface: "theme", lip: "theme", lipshadow: "theme", inputs: "theme", toggles: "theme" };

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

/** A whole look: colours, buttons and the rest of the mix. */
export interface StyleMix {
  theme: ThemeId;
  buttons: ControlStyle;
  look: Aspects;
}

const mix = (theme: ThemeId, buttons: ControlStyle, look: Partial<Aspects>): StyleMix => ({ theme, buttons, look: { ...ASPECT_DEFAULTS, ...look } });

/** One-click starting points: the design library's five presets, plus the app's own default. */
export const PRESETS: { name: string; feel: string; mix: StyleMix }[] = [
  { name: "Downtify", feel: "The app's own look", mix: mix("downtify", "modern", {}) },
  { name: "Studio", feel: "Calm, warm paper", mix: mix("studio-light", "modern", { font: "studio", corners: "rounded", surface: "flat", inputs: "boxed", toggles: "pill" }) },
  { name: "Gold arcade", feel: "Black, gold rims", mix: mix("machined", "heavy", { font: "machined", corners: "pill", surface: "soft-inset", lip: "gold", lipshadow: "none", inputs: "sunk", toggles: "pill" }) },
  { name: "Paper desk", feel: "Typewriter and cut paper", mix: mix("cozy", "cut-paper", { font: "paper", corners: "sharp", surface: "paper", inputs: "notebook", toggles: "flap" }) },
  { name: "Retro 95", feel: "Grey bevels, pixel type", mix: mix("retro-console", "bevel95", { font: "pixel", corners: "sharp", surface: "bevel", lip: "silver", inputs: "sunk", toggles: "retro" }) },
  { name: "Synth night", feel: "Neon over glass", mix: mix("night-glass", "neon", { font: "neon", corners: "rounded", surface: "glass", lip: "accent", inputs: "underline", toggles: "pill" }) },
];

export function sameMix(a: StyleMix, b: StyleMix): boolean {
  return a.theme === b.theme && a.buttons === b.buttons && (Object.keys(ASPECT_DEFAULTS) as AspectKey[]).every((k) => a.look[k] === b.look[k]);
}

/** The parts of the mix the mini player can have its own way (it has no
 *  text fields or switches). */
export const MINI_ASPECTS: AspectKey[] = ["surface", "font", "corners", "lip", "lipshadow"];
/** Window looks that work on the mini's see-through window (no glass: the
 *  desktop behind can't be blurred; no paper: its texture ignores opacity). */
export const MINI_SURFACES = ["theme", "flat", "soft-inset", "indented", "bevel"];
