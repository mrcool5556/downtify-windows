import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  hint?: string;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface OpenState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** One menu per app; open it from any right-click handler. */
export function useContextMenu() {
  const [state, setState] = useState<OpenState | null>(null);
  const open = useCallback((e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  const close = useCallback(() => setState(null), []);
  const menu = state ? <Menu x={state.x} y={state.y} items={state.items} onClose={close} /> : null;
  return { open, close, menu, isOpen: !!state };
}

function Menu({ x, y, items, onClose }: OpenState & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = Math.min(y, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y, items]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx" style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <ul className="ctx-list" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <li key={i} className="ctx-sep" role="separator" />
        ) : (
          <li
            key={i}
            className={`ctx-item ${it.disabled ? "disabled" : ""} ${it.danger ? "danger" : ""} ${it.submenu ? "has-sub" : ""}`}
            role="menuitem"
            onMouseEnter={() => setOpenSub(it.submenu ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled || it.submenu) return;
              it.onClick?.();
              onClose();
            }}
          >
            <span className="ctx-check">{it.checked ? "✓" : ""}</span>
            <span className="ctx-label">{it.label}</span>
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
            {it.submenu && <span className="ctx-arrow">›</span>}
            {it.submenu && openSub === i && (
              <div className="ctx ctx-sub">
                <MenuList items={it.submenu} onClose={onClose} />
              </div>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
