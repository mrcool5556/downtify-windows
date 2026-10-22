// Update state shared by the Settings dot and the About page.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Release {
  tag: string;
  version: string;
  name: string;
  notes: string;
  published_at: string;
  prerelease: boolean;
  installer_url: string;
  installer_name: string;
  installer_size: number;
  digest: string;
  html_url: string;
}

export interface UpdateState {
  current: string;
  newer: Release[];
  checking: boolean;
  checkedAt: number;
  error: string;
  progress: { stage: string; received: number; total: number; message: string } | null;
}

let state: UpdateState = { current: "", newer: [], checking: false, checkedAt: 0, error: "", progress: null };
const listeners = new Set<() => void>();
function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export async function checkForUpdates() {
  if (state.checking) return;
  set({ checking: true, error: "" });
  try {
    const r = await invoke<{ current: string; newer: Release[] }>("check_updates");
    set({ current: r.current, newer: r.newer, checkedAt: Date.now() });
  } catch (e) {
    set({ error: String(e) });
  } finally {
    set({ checking: false });
  }
}

export async function installUpdate(release: Release) {
  set({ error: "", progress: { stage: "downloading", received: 0, total: release.installer_size, message: "Starting" } });
  try {
    await invoke("install_update", { release });
  } catch (e) {
    set({ error: String(e), progress: null });
  }
}

listen<UpdateState["progress"]>("update-progress", (e) => set({ progress: e.payload }));

// Check shortly after start and every six hours.
setTimeout(checkForUpdates, 8000);
setInterval(checkForUpdates, 6 * 60 * 60 * 1000);

export function useUpdates(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
  );
}

export function fmtMb(n: number) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
