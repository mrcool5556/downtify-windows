import { useSyncExternalStore } from "react";
import { player } from "./store";

export function usePlayer() {
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot);
  return { ...snap, player };
}
