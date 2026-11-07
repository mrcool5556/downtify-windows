import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MenuItem, useContextMenu } from "./ContextMenu";
import { suggestFromLibrary, warmLibrarySpell, wordAt } from "../librarySpell";

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
 * Ctrl+Z still undoes them. A word your library doesn't know gets
 * "did you mean" fixes from your song, artist and album names.
 */
export function TextMenu() {
  const ctx = useContextMenu();
  useEffect(() => {
    async function onMenu(e: MouseEvent) {
      const f = fieldAt(e.target);
      if (!f || f.disabled) return;
      e.preventDefault();
      const at = { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} };
      if (document.activeElement !== f) f.focus();
      const picked = selectedText(f);
      const editable = !f.readOnly;
      const isPassword = f instanceof HTMLInputElement && f.type === "password";
      // The word under the caret (or the one selected word) and fixes for it.
      let fixes: MenuItem[] = [];
      const caret = f.selectionStart ?? f.value.length;
      const target = editable && !isPassword && f.type !== "number" ? wordAt(f.value, caret) : null;
      if (target && (!picked || picked === target.word)) {
        const words = await suggestFromLibrary(target.word).catch(() => []);
        fixes = words.map((w) => ({
          label: w,
          onClick: () => {
            f.focus();
            f.setSelectionRange(target.start, target.end);
            document.execCommand("insertText", false, w);
          },
        }));
        if (fixes.length) fixes.push({ separator: true });
      }
      ctx.open(at, [
        ...fixes,
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
    const onFocus = (e: FocusEvent) => fieldAt(e.target) && warmLibrarySpell();
    window.addEventListener("contextmenu", onMenu);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("focusin", onFocus);
    };
  }, [ctx.open]);
  return ctx.menu;
}
