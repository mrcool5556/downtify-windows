import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useContextMenu } from "./ContextMenu";

// Tauri's clipboard plugin, so Paste never shows the browser's
// "allow clipboard access?" prompt.
const writeClip = (text: string) => invoke("plugin:clipboard-manager|write_text", { text }).catch(() => {});
const readClip = () => invoke<string>("plugin:clipboard-manager|read_text").catch(() => "");

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUTS = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);

function fieldAt(target: EventTarget | null): Field | null {
  const el = (target as HTMLElement | null)?.closest?.("input, textarea");
  if (!el) return null;
  if (el instanceof HTMLInputElement && !TEXT_INPUTS.has(el.type)) return null;
  return el as Field;
}

/** Selected text of a field (number inputs have no selection API). */
function selectedText(f: Field): string {
  try {
    const a = f.selectionStart ?? 0;
    const b = f.selectionEnd ?? 0;
    return f.value.slice(a, b);
  } catch {
    return "";
  }
}

/**
 * The app's own Cut / Copy / Paste / Select all menu for text boxes, in place
 * of the browser's. Edits go through execCommand so React sees them and
 * Ctrl+Z still undoes them.
 */
export function TextMenu() {
  const ctx = useContextMenu();
  useEffect(() => {
    function onMenu(e: MouseEvent) {
      const f = fieldAt(e.target);
      if (!f || f.disabled) return;
      if (document.activeElement !== f) f.focus();
      const picked = selectedText(f);
      const editable = !f.readOnly;
      const isPassword = f instanceof HTMLInputElement && f.type === "password";
      ctx.open(e, [
        {
          label: "Cut",
          hint: "Ctrl+X",
          disabled: !picked || !editable || isPassword,
          onClick: async () => {
            await writeClip(picked);
            f.focus();
            document.execCommand("delete");
          },
        },
        {
          label: "Copy",
          hint: "Ctrl+C",
          disabled: !picked || isPassword,
          onClick: () => writeClip(picked),
        },
        {
          label: "Paste",
          hint: "Ctrl+V",
          disabled: !editable,
          onClick: async () => {
            const text = await readClip();
            f.focus();
            if (text) document.execCommand("insertText", false, text);
          },
        },
        { separator: true },
        {
          label: "Select all",
          hint: "Ctrl+A",
          disabled: !f.value,
          onClick: () => {
            f.focus();
            f.select();
          },
        },
      ]);
    }
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, [ctx.open]);
  return ctx.menu;
}
