import { setLayout, useLayout } from "../layout";
import { ControlStyle, THEMES, ThemeId, ThemeInfo, themeById } from "../themes";

/** Settings → Theme: colour theme cards, control style, and the mini player's own look. */
export function ThemePage() {
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

      <section className="card">
        <h2>Controls</h2>
        <StyleChoice value={p.controlStyle} onChange={(v) => setLayout({ controlStyle: v })} />
      </section>

      <section className="card">
        <h2>Mini player</h2>
        <p className="hint">The mini player can look different from the main window.</p>
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
          <span>Controls</span>
          <select value={p.miniStyle} onChange={(e) => setLayout({ miniStyle: e.target.value as ControlStyle | "" })}>
            <option value="">Same as main window ({p.controlStyle === "heavy" ? "Heavy" : "Modern"})</option>
            <option value="modern">Modern</option>
            <option value="heavy">Heavy</option>
          </select>
        </div>
      </section>
    </>
  );
}

function StyleChoice({ value, onChange }: { value: ControlStyle; onChange: (v: ControlStyle) => void }) {
  return (
    <div className="style-choice">
      <button className={`style-opt ${value === "modern" ? "on" : ""}`} onClick={() => onChange("modern")}>
        <span className="style-demo modern">
          <span className="k">⏮</span>
          <span className="k play">▶</span>
          <span className="k">⏭</span>
        </span>
        <b>Modern</b>
        <small>Flat, quiet buttons. Today's look.</small>
      </button>
      <button className={`style-opt ${value === "heavy" ? "on" : ""}`} onClick={() => onChange("heavy")}>
        <span className="style-demo heavy">
          <span className="k">⏮</span>
          <span className="k play">▶</span>
          <span className="k">⏭</span>
        </span>
        <b>Heavy</b>
        <small>Raised keys in a metal bezel that press down.</small>
      </button>
    </div>
  );
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
