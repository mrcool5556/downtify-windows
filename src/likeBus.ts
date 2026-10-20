// Tiny broadcast so every list and the player bar agree on a like.
import { player } from "./player/store";

type Handler = (trackId: string, liked: boolean) => void;
const handlers = new Set<Handler>();

export const likeBus = {
  on(h: Handler): () => void {
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  },
  emit(trackId: string, liked: boolean) {
    player.applyLike(trackId, liked);
    for (const h of handlers) h(trackId, liked);
  },
};
