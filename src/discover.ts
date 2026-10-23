// Discover: songs and artists from outside the library, through the server.
// Online songs become pseudo Tracks (id "online:…") so the player, queue and
// lists can handle them next to library songs.

import { invoke } from "@tauri-apps/api/core";
import { Track, api } from "./api";

/** A song row as the server's search / similar / chart / resolve endpoints return it. */
export interface OnlineSong {
  song_id?: string;
  name: string;
  artists?: string[];
  artist?: string;
  album_name?: string;
  cover_url?: string;
  duration?: number;
  url?: string;
  source?: string;
  preview_url?: string;
  match?: number;
  [k: string]: unknown;
}

export interface DiscoverArtist {
  name: string;
  deezer_id?: string;
  picture_url?: string;
  fans?: number;
  because?: string[];
}

export interface DiscoverCollection {
  name: string;
  artist?: string;
  owner?: string;
  year?: string;
  cover_url?: string;
  url?: string;
  reason?: string;
  because?: string[];
}

export function discoverApi<T = unknown>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  return invoke<T>("discover_api", { method, path, body: body ?? null });
}

const enc = encodeURIComponent;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/ - .*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const songArtist = (s: OnlineSong) => (s.artists && s.artists.length ? s.artists.join(", ") : s.artist || "");
const firstArtist = (s: string) => norm(s.split(/[;,&]| feat\.| ft\./i)[0] || "");

/** YouTube rows carry a video id and stream in full; others only preview. */
export function videoIdOf(s: OnlineSong): string | undefined {
  if (s.source === "youtube" && s.song_id) return s.song_id;
  const m = /[?&]v=([\w-]{6,})/.exec(s.url || "");
  return m ? m[1] : undefined;
}

// ── "In library": a title + first-artist index of the local library ──

let index: Map<string, Track> | null = null;
let indexPromise: Promise<Map<string, Track>> | null = null;

export function invalidateLibraryIndex() {
  index = null;
  indexPromise = null;
}

export async function libraryIndex(): Promise<Map<string, Track>> {
  if (index) return index;
  if (!indexPromise) {
    indexPromise = api.listTracks({ limit: 20000 }).then((all) => {
      const m = new Map<string, Track>();
      for (const t of all) m.set(`${norm(t.title)}|${firstArtist(t.artist)}`, t);
      index = m;
      return m;
    });
  }
  return indexPromise;
}

/** The key the library index uses: title + first artist, normalised. */
export const songKey = (title: string, artist: string) => `${norm(title)}|${firstArtist(artist)}`;

export function findInLibrary(idx: Map<string, Track>, s: OnlineSong): Track | undefined {
  return idx.get(`${norm(s.name)}|${firstArtist(songArtist(s))}`);
}

/** An online song as a queue-able Track (library copy if we have one). */
export function toTrack(s: OnlineSong, idx?: Map<string, Track>): Track {
  const local = idx ? findInLibrary(idx, s) : undefined;
  if (local) return local;
  const vid = videoIdOf(s);
  const key = vid ? `online:${vid}` : `preview:${norm(s.name)}|${firstArtist(songArtist(s))}`;
  return {
    id: key,
    file: "",
    title: s.name,
    artist: songArtist(s),
    artists: s.artists ?? [],
    album: s.album_name ?? "",
    album_artist: "",
    album_id: "",
    artist_id: "",
    track_number: 0,
    year: "",
    duration: Number(s.duration) || 0,
    codec: "",
    bitrate: 0,
    size: 0,
    added: 0,
    has_cover: !!s.cover_url,
    playlists: [],
    local_path: null,
    liked: false,
    orphaned: false,
    online: { cover: s.cover_url ?? "", video_id: vid, preview: s.preview_url || undefined, song: s },
  } as Track;
}

export const isOnline = (t: Track) => !!t.online;

/** Where the player gets audio for an online pseudo track. */
export async function onlineSource(t: Track): Promise<string> {
  const o = t.online!;
  if (o.video_id) return `http://media.localhost/online/${o.video_id}`;
  if (o.preview) return o.preview;
  const r = await discoverApi<{ preview_url?: string }>("GET", `/api/preview?artist=${enc(t.artist)}&title=${enc(t.title)}&duration=${t.duration || 0}`);
  if (!r.preview_url) throw new Error("No preview for this song. Download it to listen.");
  o.preview = r.preview_url;
  return r.preview_url;
}

/** Ask the server to add a song to the library. It appears after the next sync. */
export async function requestDownload(s: OnlineSong): Promise<void> {
  const url = s.url || (videoIdOf(s) ? `https://music.youtube.com/watch?v=${videoIdOf(s)}` : "");
  await discoverApi("POST", `/api/download/url?url=${enc(url)}`, s);
}

// ── Fetchers ──

export async function similarTo(artist: string, title: string, limit = 30): Promise<OnlineSong[]> {
  const r = await discoverApi<{ tracks?: OnlineSong[] }>("GET", `/api/similar/tracks?artist=${enc(artist)}&track=${enc(title)}&limit=${limit}`);
  return r.tracks ?? [];
}

export async function searchOnline(q: string): Promise<OnlineSong[]> {
  return (await discoverApi<OnlineSong[]>("GET", `/api/songs/search?query=${enc(q)}`)) ?? [];
}

export async function resolveCollection(url: string): Promise<OnlineSong[]> {
  const r = await discoverApi<OnlineSong[] | { songs?: OnlineSong[]; tracks?: OnlineSong[] }>("GET", `/api/url?url=${enc(url)}`);
  if (Array.isArray(r)) return r;
  return r.songs ?? r.tracks ?? [];
}

export async function chart(): Promise<OnlineSong[]> {
  const r = await discoverApi<{ tracks?: OnlineSong[] }>("GET", `/api/discover/chart?limit=30`);
  return r.tracks ?? [];
}

async function libraryPayload() {
  const artists = await api.listArtists();
  return artists.map((a) => ({ name: a.name, tracks: a.count, liked: 0 }));
}

export async function newArtists(): Promise<DiscoverArtist[]> {
  const r = await discoverApi<{ artists?: DiscoverArtist[] }>("POST", "/api/discover", { library: await libraryPayload() });
  return r.artists ?? [];
}

export async function collections(): Promise<{ albums: DiscoverCollection[]; playlists: DiscoverCollection[] }> {
  const albums = (await api.listAlbums()).map((a) => ({ artist: a.album_artist, title: a.album }));
  const r = await discoverApi<{ albums?: DiscoverCollection[]; more_albums?: DiscoverCollection[]; playlists?: DiscoverCollection[] }>("POST", "/api/discover/collections", {
    library: await libraryPayload(),
    albums,
  });
  return { albums: [...(r.albums ?? []), ...(r.more_albums ?? [])], playlists: r.playlists ?? [] };
}

export async function notInterested(name: string): Promise<void> {
  await discoverApi("POST", "/api/discover/blocked", { name });
}

/** Session cache so going back to Discover is instant. */
export const discoverCache: {
  artists?: DiscoverArtist[];
  coll?: { albums: DiscoverCollection[]; playlists: DiscoverCollection[] };
  chart?: OnlineSong[];
} = {};
