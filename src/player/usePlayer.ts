import { useSyncExternalStore } from "react";
import { player } from "./store";

/** Queue, current track, playing state. Does NOT tick with playback position. */
export function usePlayer() {
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot);
  return { ...snap, player };
}

/** Position / duration / loading, several updates a second. Use only where shown. */
export function usePlayerProgress() {
  return useSyncExternalStore(player.subscribeProgress, player.getProgress);
}
