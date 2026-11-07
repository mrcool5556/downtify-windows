// "Did you mean" for text boxes, from the words in your own library (song,
// artist and album names) instead of an English dictionary, so band names
// like "Witchouse" count as spelled right.
import { Track } from "./api";
import { libraryIndex } from "./discover";

interface Vocab {
  /** lower-case word → how it is usually written, and how often it appears */
  words: Map<string, { shown: string; count: number }>;
}

let built: { from: Map<string, Track>; vocab: Vocab } | null = null;

const WORD = /[\p{L}\p{N}']+/gu;

function build(idx: Map<string, Track>): Vocab {
  const casing = new Map<string, Map<string, number>>();
  for (const t of idx.values()) {
    for (const text of [t.title, t.artist, t.album]) {
      for (const w of (text || "").match(WORD) ?? []) {
        if (w.length < 2) continue;
        const k = w.toLowerCase();
        const forms = casing.get(k) ?? new Map<string, number>();
        forms.set(w, (forms.get(w) ?? 0) + 1);
        casing.set(k, forms);
      }
    }
  }
  const words: Vocab["words"] = new Map();
  for (const [k, forms] of casing) {
    let shown = k;
    let best = 0;
    let count = 0;
    for (const [w, n] of forms) {
      count += n;
      if (n > best) [shown, best] = [w, n];
    }
    words.set(k, { shown, count });
  }
  return { words };
}

async function vocab(): Promise<Vocab> {
  const idx = await libraryIndex();
  if (built?.from !== idx) built = { from: idx, vocab: build(idx) };
  return built.vocab;
}

/** Start building the word list early (e.g. when a text box gets focus). */
export function warmLibrarySpell() {
  vocab().catch(() => {});
}

/** Edit distance with swaps of neighbouring letters counted as one edit. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * Library words close to `word`, best first. Empty when the word is already
 * in the library, too short, or nothing is close.
 */
export async function suggestFromLibrary(word: string, limit = 5): Promise<string[]> {
  const k = word.toLowerCase();
  if (k.length < 3 || /^\d+$/.test(k)) return [];
  const { words } = await vocab();
  if (words.has(k)) return [];
  const max = k.length <= 4 ? 1 : k.length <= 6 ? 2 : 3;
  const hits: { shown: string; d: number; count: number }[] = [];
  for (const [w, v] of words) {
    if (w.length < 3) continue;
    const d = distance(k, w, max);
    if (d <= max) hits.push({ shown: v.shown, d, count: v.count });
  }
  hits.sort((a, b) => a.d - b.d || b.count - a.count);
  return hits.slice(0, limit).map((h) => h.shown);
}

/** The word in `text` at `pos` (the caret), with where it starts and ends. */
export function wordAt(text: string, pos: number): { word: string; start: number; end: number } | null {
  for (const m of text.matchAll(WORD)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (pos >= start && pos <= end) return { word: m[0], start, end };
  }
  return null;
}
