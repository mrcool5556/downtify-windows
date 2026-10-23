// The heart on a song from outside the library: ask the server to download
// it, then like it as soon as it shows up in the library after a sync.
// Pending saves survive a restart (localStorage) and expire after a week.

import { useSyncExternalStore } from "react";
import { Track, playerApi } from "./api";
import { OnlineSong, invalidateLibraryIndex, libraryIndex, requestDownload, songKey } from "./discover";
import { likeBus } from "./likeBus";

type State = "saving" | "waiting" | "liked" | "failed";
interface Pending {
  key: string;
  title: string;
  artist: string;
  at: number;
  state: State;
  error?: string;
}

const KEY = "downtify.pendingLikes";
const WEEK = 7 * 24 * 3600 * 1000;

function load(): Record<string, Pending> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Pending>;
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k].at > WEEK || all[k].state === "liked") delete all[k];
    return all;
  } catch {
    return {};
  }
}

let pending: Record<string, Pending> = load();
const listeners = new Set<() => void>();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* fine */
  }
  pending = { ...pending };
  for (const l of listeners) l();
}

/** Ask the app to sync (App listens and runs its normal sync). */
function requestSync() {
  window.dispatchEvent(new CustomEvent("downtify-sync-request"));
}

/** Heart pressed on an online song. */
export async function saveAndLike(t: Track): Promise<void> {
  if (!t.online) return;
  const key = songKey(t.title, t.artist);
  if (pending[key] && pending[key].state !== "failed") return;
  pending[key] = { key, title: t.title, artist: t.artist, at: Date.now(), state: "saving" };
  save();
  try {
    await requestDownload(t.online.song as OnlineSong);
    pending[key] = { ...pending[key], state: "waiting" };
    save();
    requestSync();
  } catch (e) {
    const msg = String(e);
    // The server keeps downloading even if our request timed out; wait for it.
    if (/timed out|timeout|unreachable/i.test(msg)) {
      pending[key] = { ...pending[key], state: "waiting" };
      save();
      setTimeout(requestSync, 60_000);
    } else {
      pending[key] = { ...pending[key], state: "failed", error: msg };
      save();
    }
  }
}

/** After every sync: like whatever has arrived. Returns how many were liked. */
export async function resolvePendingLikes(): Promise<number> {
  const waiting = Object.values(pending).filter((p) => p.state === "waiting" || p.state === "saving");
  if (!waiting.length) return 0;
  invalidateLibraryIndex();
  const idx = await libraryIndex();
  let n = 0;
  for (const p of waiting) {
    const local = idx.get(p.key);
    if (!local) continue;
    try {
      const liked = await playerApi.setLike(local.id, true);
      likeBus.emit(local.id, liked);
      pending[p.key] = { ...p, state: "liked" };
      n++;
    } catch {
      /* try again next sync */
    }
  }
  if (n) save();
  return n;
}

export const hasWaiting = () => Object.values(pending).some((p) => p.state === "waiting" || p.state === "saving");

/** The save state of an online song, for the heart. */
export function usePendingLike(t: Track | null | undefined): Pending | undefined {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => pending,
  );
  if (!t || !t.online) return undefined;
  return all[songKey(t.title, t.artist)];
}
