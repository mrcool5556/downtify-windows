// "Go to album / artist" requests from anywhere (menus, player bar) to
// the Library view.

export interface NavTarget {
  album_id?: string;
  album?: string;
  album_artist?: string;
  artist_id?: string;
  artist?: string;
  cover_track_id?: string;
  playlist?: string;
}

type Handler = (t: NavTarget) => void;
const handlers = new Set<Handler>();
let pending: NavTarget | null = null;

export const navBus = {
  on(h: Handler): () => void {
    handlers.add(h);
    if (pending) {
      const p = pending;
      pending = null;
      h(p);
    }
    return () => {
      handlers.delete(h);
    };
  },
  go(t: NavTarget) {
    if (handlers.size === 0) pending = t;
    for (const h of handlers) h(t);
  },
};
