// Lyrics for the lyrics page: the server's saved copy first, LRCLIB when the
// server has none or the song is only streamed (see get_lyrics in Rust).
import { invoke } from "@tauri-apps/api/core";
import { Track } from "./api";

export interface LyricLine {
  time: number;
  text: string;
}

export interface SongLyrics {
  /** Time-synced lines, empty when only plain lyrics exist. */
  lines: LyricLine[];
  plain: string;
  source: "server" | "lrclib" | "";
}

const STAMP = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;

/** LRC text to timed lines, in order. Tag lines like [ar:…] are skipped. */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP)];
    if (!stamps.length) continue;
    const words = raw.replace(STAMP, "").trim();
    for (const m of stamps) {
      out.push({ time: Number(m[1]) * 60 + Number(m[2].replace(":", ".")), text: words });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const cache = new Map<string, Promise<SongLyrics>>();

export function loadLyrics(t: Track): Promise<SongLyrics> {
  let p = cache.get(t.id);
  if (!p) {
    p = invoke<{ synced: string; plain: string; source: SongLyrics["source"] }>("get_lyrics", {
      id: t.online ? null : t.id,
      title: t.title,
      artist: t.artists?.[0] || t.artist,
      album: t.album || "",
      duration: t.duration || 0,
    }).then((r) => ({ lines: parseLrc(r.synced), plain: r.plain || "", source: r.source }));
    // A failed lookup (no internet, server down) is tried again next time.
    p.catch(() => cache.delete(t.id));
    cache.set(t.id, p);
  }
  return p;
}
