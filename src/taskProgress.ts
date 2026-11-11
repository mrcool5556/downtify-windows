// A long batch job (like liking a big list) reports its progress here, and
// the player bar's seek bar shows it: done on the left, total on the right.
import { useEffect, useState } from "react";

export type TaskProgress = { label: string; done: number; total: number };

let current: TaskProgress | null = null;
const handlers = new Set<(t: TaskProgress | null) => void>();

export const taskProgress = {
  set(t: TaskProgress | null) {
    current = t;
    for (const h of handlers) h(t);
  },
  get: () => current,
  on(h: (t: TaskProgress | null) => void): () => void {
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  },
};

export function useTaskProgress(): TaskProgress | null {
  const [t, setT] = useState(current);
  useEffect(() => taskProgress.on(setT), []);
  return t;
}
