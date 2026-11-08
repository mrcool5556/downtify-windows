import { useState } from "react";
import { ButtonShape, GROUPS, GroupKey, GroupStyle, LayoutPrefs, RowStyle, ShowKey, applyMix, applyMixToMini, currentMix, setLayout, useLayout } from "../layout";
import { ASPECTS, AspectKey, Aspects, BUTTON_STYLES, ControlStyle, MINI_ASPECTS, MINI_SURFACES, PRESETS, THEMES, ThemeId, ThemeInfo, sameMix, themeById } from "../themes";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "../api";

/** Settings → Theme: colour theme cards, control style, and the mini player's own look. */
export function ThemePage({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const p = useLayout();

  return (
    <>
      <section className="card">
        <h2>Colour theme</h2>
        <p className="hint">Click a theme to use it. The sun and moon button in the top bar switches between your last dark and last light choice.</p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} t={t} selected={p.theme === t.id} heavy={p.controlStyle === "heavy"} onPick={() => setLayout({ theme: t.id })} />
          ))}
        </div>
        <div className="setting-row tight">
          <span className="hint">
            Sun/moon switches between <b>{themeById(p.darkPick).name}</b> and <b>{themeById(p.lightPick).name}</b>.
          </span>
        </div>
      </section>

      <Presets p={p} />

      <section className="card">
        <h2>Style</h2>
        <p className="hint">Each part of the look is picked on its own, so you can mix them freely. "As the theme" keeps the colour theme's own look.</p>
        <div className="setting-row mix-row">
          <span>Buttons</span>
          <div className="seg seg-text seg-wrap" role="radiogroup" aria-label="Buttons">
            {BUTTON_STYLES.map(([v, label, tip]) => (
              <button key={v} className={p.controlStyle === v ? "on" : ""} title={tip} onClick={() => setLayout({ controlStyle: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {(Object.keys(ASPECTS) as AspectKey[])
          .filter((k) => (k === "lip" || k === "lipshadow" ? usesLip(p.controlStyle, p.advanced) : true))
          .map((k) => (
            <AspectRow key={k} k={k} value={p.look[k]} onChange={(v) => setLayout({ look: { ...p.look, [k]: v } as Aspects })} />
          ))}
        {mixNote(p.look, p.controlStyle) && <p className="hint mix-note">Heads up: {mixNote(p.look, p.controlStyle)}</p>}
      </section>

      <section className="card">
        <h2>Window</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.window_shadow}
            onChange={(e) => invoke<Settings>("set_window_shadow", { mini: false, on: e.target.checked }).then(onSettings).catch(() => {})}
          />
          Shadow around the window
        </label>
      </section>

      <details className="card adv">
        <summary>
          <h2>Advanced</h2>
          <small className="hint">Style and show each part of the player on its own</small>
        </summary>
        <p className="hint">"Follow" uses the Controls choice above (or the mini player's own, in the mini).</p>
        {GROUPS.map((g) => (
          <div key={g.key} className="setting-row">
            <span>{g.label}</span>
            <div className="seg seg-text" role="radiogroup" aria-label={g.label}>
              {(["follow", "modern", "heavy"] as GroupStyle[]).map((v) => (
                <button key={v} className={p.advanced[g.key] === v ? "on" : ""} onClick={() => setLayout({ advanced: { ...p.advanced, [g.key as GroupKey]: v } })}>
                  {v === "follow" ? "Follow" : v === "modern" ? "Modern" : "Heavy"}
                </button>
              ))}
            </div>
          </div>
        ))}
        <h3 className="adv-sub">Shape and selection</h3>
        <div className="setting-row">
          <span>Button shape</span>
          <div className="seg seg-text" role="radiogroup" aria-label="Button shape">
            {(
              [
                ["default", "Default"],
                ["round", "Round"],
                ["square", "Square"],
              ] as [ButtonShape, string][]
            ).map(([v, label]) => (
              <button key={v} className={p.shape === v ? "on" : ""} onClick={() => setLayout({ shape: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span>Selected songs and playlists</span>
          <div className="seg seg-text" role="radiogroup" aria-label="Selected rows">
            {(
              [
                ["simple", "Simple"],
                ["highlight", "Highlighted"],
              ] as [RowStyle, string][]
            ).map(([v, label]) => (
              <button key={v} className={p.rows === v ? "on" : ""} onClick={() => setLayout({ rows: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">Default keeps each style's own corners: a round play button in Modern, square keys in Heavy. Highlighted adds an accent bar and tint, pressed in when the controls are Heavy.</p>

        <h3 className="adv-sub">Show</h3>
        <p className="hint">Turned off, an item is hidden in both the full window and the mini. The mini also hides items on its own when it gets narrow; they stay in its right-click menu.</p>
        {(
          [
            ["toggles", "Shuffle and repeat"],
            ["volume", "Volume slider"],
            ["download", "Download button"],
            ["heart", "Heart (like)"],
          ] as [ShowKey, string][]
        ).map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={p.show[key]} onChange={(e) => setLayout({ show: { ...p.show, [key]: e.target.checked } })} />
            {label}
          </label>
        ))}
      </details>

      <section className="card">
        <h2>Mini player</h2>
        <p className="hint">The mini player can look different from the main window. Anything left on "Same as main window" follows it.</p>
        <div className="setting-row">
          <span>Copy a look</span>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__main") setLayout({ miniTheme: "", miniStyle: "", miniLook: {} });
              else {
                const m = PRESETS.find((x) => `p:${x.name}` === v)?.mix ?? p.mixes.find((x) => `m:${x.name}` === v)?.mix;
                if (m) applyMixToMini(m);
              }
            }}
          >
            <option value="">Pick a preset or mix…</option>
            <option value="__main">Match the main window</option>
            <optgroup label="Presets">
              {PRESETS.map((x) => (
                <option key={x.name} value={`p:${x.name}`}>
                  {x.name}
                </option>
              ))}
            </optgroup>
            {p.mixes.length > 0 && (
              <optgroup label="My mixes">
                {p.mixes.map((x) => (
                  <option key={x.name} value={`m:${x.name}`}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="setting-row">
          <span>Theme</span>
          <select value={p.miniTheme} onChange={(e) => setLayout({ miniTheme: e.target.value as ThemeId | "" })}>
            <option value="">Same as main window ({themeById(p.theme).name})</option>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <span>Buttons</span>
          <select value={p.miniStyle} onChange={(e) => setLayout({ miniStyle: e.target.value as ControlStyle | "" })}>
            <option value="">Same as main window ({BUTTON_STYLES.find(([v]) => v === p.controlStyle)?.[1]})</option>
            {BUTTON_STYLES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {MINI_ASPECTS.map((k) => (
          <MiniAspectRow key={k} k={k} p={p} />
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={settings.mini_shadow}
            onChange={(e) => invoke<Settings>("set_window_shadow", { mini: true, on: e.target.checked }).then(onSettings).catch(() => {})}
          />
          Shadow around the mini player
        </label>
        <p className="hint">The mini's opacity slider (in its drawer) goes down to 0%. At 0% it still comes back fully when you hover over it.</p>
      </section>
    </>
  );
}

/** The lip choices only matter when something is Lipped (Heavy). */
function usesLip(main: ControlStyle, advanced: Record<GroupKey, GroupStyle>): boolean {
  return main === "heavy" || Object.values(advanced).includes("heavy");
}

function AspectRow<K extends AspectKey>({ k, value, onChange }: { k: K; value: Aspects[K]; onChange: (v: Aspects[K]) => void }) {
  const a = ASPECTS[k];
  return (
    <div className="setting-row mix-row">
      <span>{a.label}</span>
      <div className="seg seg-text seg-wrap" role="radiogroup" aria-label={a.label}>
        {a.options.map(([v, label]) => (
          <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v as Aspects[K])}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pairings that can look weak: say so, but never block (the library's rule). */
function mixNote(look: Aspects, buttons: ControlStyle): string {
  if (look.surface === "soft-inset" && look.corners === "sharp") return "soft inset windows read best with rounded corners.";
  if (look.font === "pixel" && look.inputs === "notebook") return "pixel letters and handwritten fields fight a little.";
  if (buttons === "cut-paper" && look.surface === "glass") return "cut paper buttons look stuck on over glass; Paper windows suit them better.";
  if (buttons === "neon" && look.surface === "paper") return "neon glow is hard to see on paper.";
  return "";
}

/** A small live preview drawn with the theme's own colours. */
function ThemeCard({ t, selected, heavy, onPick }: { t: ThemeInfo; selected: boolean; heavy: boolean; onPick: () => void }) {
  const s = t.swatch;
  return (
    <button className={`theme-card ${selected ? "on" : ""}`} onClick={onPick} title={`${t.name}: ${t.feel}`} data-preview-theme={t.id}>
      <span className="tc-preview" style={{ background: s.bg, color: s.fg }}>
        <span className="tc-side" style={{ background: s.panel }}>
          <i style={{ background: s.accent }} />
          <i />
          <i />
        </span>
        <span className="tc-main">
          <span className="tc-row" />
          <span className="tc-row cur" style={{ background: `color-mix(in srgb, ${s.accent} 18%, transparent)` }} />
          <span className="tc-row" />
        </span>
        <span className="tc-bar" style={{ background: s.panel }}>
          <span className={`tc-play ${heavy ? "heavy" : ""}`} style={heavy ? { background: s.accent } : { background: s.fg }} />
          <span className="tc-seek">
            <span style={{ background: s.accent }} />
          </span>
        </span>
      </span>
      <span className="tc-label">
        <b>{t.name}</b>
        <small>
          {t.feel}
          {t.id === "downtify" ? " · default" : ""}
        </small>
      </span>
      {selected && <span className="tc-check">✓</span>}
    </button>
  );
}

/** One-click looks from the design library, plus mixes you saved yourself. */
function Presets({ p }: { p: LayoutPrefs }) {
  const [name, setName] = useState("");
  const now = currentMix(p);
  const pinned = GROUPS.filter((g) => p.advanced[g.key] !== "follow");

  function save() {
    const n = name.trim();
    if (!n) return;
    const others = p.mixes.filter((m) => m.name.toLowerCase() !== n.toLowerCase());
    setLayout({ mixes: [...others, { name: n, mix: now }] });
    setName("");
  }

  return (
    <section className="card">
      <h2>Presets</h2>
      <p className="hint">A preset sets the colours, buttons and every part of the style at once. Change anything afterwards to make it yours.</p>
      <div className="preset-grid">
        {PRESETS.map((pr) => (
          <button key={pr.name} className={`preset ${sameMix(now, pr.mix) ? "on" : ""}`} onClick={() => applyMix(pr.mix)} title={`${pr.name}: ${themeById(pr.mix.theme).name} colours, ${BUTTON_STYLES.find(([v]) => v === pr.mix.buttons)?.[1]} buttons`}>
            <span className="preset-swatch" style={{ background: themeById(pr.mix.theme).swatch.bg }}>
              <i style={{ background: themeById(pr.mix.theme).swatch.accent }} />
            </span>
            <b>{pr.name}</b>
            <small>{pr.feel}</small>
          </button>
        ))}
      </div>
      {pinned.length > 0 && (
        <p className="hint mix-note">
          {pinned.length === 1 ? "One part of the player keeps" : `${pinned.length} parts of the player keep`} its own style from Advanced ({pinned.map((g) => g.label.toLowerCase()).join(", ")}), so presets don't change {pinned.length === 1 ? "it" : "them"}.{" "}
          <button className="link" onClick={() => setLayout({ advanced: Object.fromEntries(GROUPS.map((g) => [g.key, "follow"])) as Record<GroupKey, GroupStyle> })}>
            Let presets style {pinned.length === 1 ? "it" : "them"} too
          </button>
        </p>
      )}

      <h3 className="adv-sub">My mixes</h3>
      {p.mixes.length > 0 ? (
        <div className="mix-list">
          {p.mixes.map((m) => (
            <span key={m.name} className={`mix-chip ${sameMix(now, m.mix) ? "on" : ""}`}>
              <button className="chip-btn" onClick={() => applyMix(m.mix)} title={`Use "${m.name}"`}>
                <span className="preset-dot" style={{ background: themeById(m.mix.theme).swatch.accent }} />
                {m.name}
              </button>
              <button className="icon" title={`Delete "${m.name}"`} onClick={() => setLayout({ mixes: p.mixes.filter((x) => x.name !== m.name) })}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="hint">None yet. Make the look your own, then save it here by name.</p>
      )}
      <div className="mix-save">
        <input value={name} placeholder="Name this mix" maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="small" disabled={!name.trim()} onClick={save}>
          {p.mixes.some((m) => m.name.toLowerCase() === name.trim().toLowerCase()) ? "Update" : "Save this mix"}
        </button>
      </div>
    </section>
  );
}

/** One of the mini's own style choices, with "same as main window" first. */
function MiniAspectRow({ k, p }: { k: AspectKey; p: LayoutPrefs }) {
  const a = k === "surface" ? { ...ASPECTS.surface, label: "Window" } : ASPECTS[k];
  const mainLabel = a.options.find(([v]) => v === p.look[k])?.[1] ?? "";
  return (
    <div className="setting-row">
      <span>{a.label}</span>
      <select
        value={p.miniLook[k] ?? ""}
        onChange={(e) => {
          const next = { ...p.miniLook } as Record<string, string>;
          if (e.target.value === "") delete next[k];
          else next[k] = e.target.value;
          setLayout({ miniLook: next as Partial<Aspects> });
        }}
      >
        <option value="">Same as main window ({mainLabel})</option>
        {a.options.filter(([v]) => k !== "surface" || MINI_SURFACES.includes(v)).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
