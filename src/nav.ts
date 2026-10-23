// In-app navigation history: a stack of views with back / forward,
// shared by the top bar and the Library.

import { useSyncExternalStore } from "react";

export type Section = "home" | "tracks" | "albums" | "artists" | "playlists" | "downloads" | "settings" | "search" | "discover" | "collection";

export interface View {
  section: Section;
  /** Album / artist / playlist scope; shape owned by the Library. */
  scope: Record<string, unknown>;
  search: string;
  /** Settings tab, when section is "settings". */
  tab?: string;
}

const HOME: View = { section: "home", scope: {}, search: "" };

let stack: View[] = [HOME];
let pos = 0;
const listeners = new Set<() => void>();
let snapshot = { view: HOME, canBack: false, canForward: false };

function publish() {
  snapshot = { view: stack[pos], canBack: pos > 0, canForward: pos < stack.length - 1 };
  for (const l of listeners) l();
}

function same(a: View, b: View) {
  return a.section === b.section && a.search === b.search && a.tab === b.tab && JSON.stringify(a.scope) === JSON.stringify(b.scope);
}

export const nav = {
  /** Go somewhere new (adds a history entry). */
  push(v: View) {
    if (same(stack[pos], v)) return;
    stack = stack.slice(0, pos + 1);
    stack.push(v);
    if (stack.length > 100) stack.shift();
    pos = stack.length - 1;
    publish();
  },
  /** Change the current entry without adding history (search typing). */
  replace(v: View) {
    stack[pos] = v;
    publish();
  },
  back() {
    if (pos > 0) {
      pos--;
      publish();
    }
  },
  forward() {
    if (pos < stack.length - 1) {
      pos++;
      publish();
    }
  },
  current: () => stack[pos],
};

export function useNav() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snapshot,
  );
}
