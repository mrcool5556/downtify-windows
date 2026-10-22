// Download progress mirror: seeded from the backend, kept current by
// events. Also broadcasts local-path changes so lists and the player
// switch to the file as soon as it lands.

import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { player } from "./player/store";

export type DownloadStatus = "queued" | "downloading" | "done" | "error" | "cancelled";

export interface Progress {
  track_id: string;
  status: DownloadStatus;
  received: number;
  total: number;
  error: string;
  title: string;
  artist: string;
}

export const downloadsApi = {
  download: (trackIds: string[]) => invoke<number>("download_tracks", { trackIds }),
  cancel: (trackId: string) => invoke<void>("cancel_download", { trackId }),
  states: () => invoke<Progress[]>("download_states"),
  clearFinished: () => invoke<void>("clear_finished_downloads"),
  removeLocal: (trackIds: string[]) => invoke<number>("remove_local", { trackIds }),
  setKeepSynced: (name: string, on: boolean) => invoke<number>("set_keep_synced", { name, on }),
  syncKeepSynced: () => invoke<number>("sync_keep_synced"),
  setKeepPlayed: (on: boolean) => invoke<unknown>("set_keep_played", { on }),
};

type LocalHandler = (trackId: string, localPath: string | null) => void;
const localHandlers = new Set<LocalHandler>();

export const localBus = {
  on(h: LocalHandler): () => void {
    localHandlers.add(h);
    return () => {
      localHandlers.delete(h);
    };
  },
};

let map = new Map<string, Progress>();
const listeners = new Set<() => void>();
const perTrack = new Map<string, Set<() => void>>();
let snapshotCache: Progress[] = [];

function publish(changed?: string) {
  snapshotCache = Array.from(map.values());
  for (const l of listeners) l();
  if (changed) {
    const ls = perTrack.get(changed);
    if (ls) for (const l of ls) l();
  } else {
    for (const ls of perTrack.values()) for (const l of ls) l();
  }
}

downloadsApi
  .states()
  .then((list) => {
    map = new Map(list.map((p) => [p.track_id, p]));
    publish();
  })
  .catch(() => {});

listen<Progress>("download-progress", (e) => {
  map.set(e.payload.track_id, e.payload);
  publish(e.payload.track_id);
});

listen<{ track_id: string; local_path: string | null }>("download-done", (e) => {
  player.applyLocalPath(e.payload.track_id, e.payload.local_path);
  for (const h of localHandlers) h(e.payload.track_id, e.payload.local_path);
});

export function useDownloads(): Progress[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snapshotCache,
  );
}

/** One track's progress; re-renders only when that track's entry changes. */
export function useDownload(trackId: string | undefined): Progress | undefined {
  return useSyncExternalStore(
    (l) => {
      if (!trackId) return () => {};
      let set = perTrack.get(trackId);
      if (!set) {
        set = new Set();
        perTrack.set(trackId, set);
      }
      set.add(l);
      return () => {
        set!.delete(l);
        if (set!.size === 0) perTrack.delete(trackId);
      };
    },
    () => (trackId ? map.get(trackId) : undefined),
  );
}

export function clearFinished() {
  downloadsApi.clearFinished().catch(() => {});
  for (const [id, p] of map) if (p.status !== "queued" && p.status !== "downloading") map.delete(id);
  publish();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
