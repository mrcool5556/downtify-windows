import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  server_url: string;
  server_id: string;
  server_name: string;
  username: string;
  device_id: string;
  device_name: string;
  music_dir: string;
  paired: boolean;
  default_music_dir: string;
}

export interface ServerInfo {
  server_id: string;
  name: string;
  product: string;
  version: string;
  api_version: number;
  require_sign_in: boolean;
}

export interface ServerStatus {
  online: boolean;
  paired: boolean;
  detail: string;
  user: { username?: string; role?: string } | null;
}

export interface Track {
  id: string;
  file: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  album_artist: string;
  album_id: string;
  artist_id: string;
  track_number: number;
  year: string;
  duration: number;
  codec: string;
  bitrate: number;
  size: number;
  added: number;
  has_cover: boolean;
  playlists: string[];
  local_path: string | null;
  liked: boolean;
}

export interface Album {
  album_id: string;
  album: string;
  album_artist: string;
  artist_id: string;
  count: number;
  local_count: number;
  cover_track_id: string;
}

export interface Artist {
  artist_id: string;
  name: string;
  count: number;
  local_count: number;
}

export interface PlaylistSummary {
  name: string;
  liked: boolean;
  manual: boolean;
  count: number;
  local_count: number;
  cover: string;
}

export interface Summary {
  tracks: number;
  local_tracks: number;
  albums: number;
  artists: number;
  playlists: number;
  cursor: number;
  last_sync: number;
}

export interface SyncResult {
  full: boolean;
  upserted: number;
  deleted: number;
  cursor: number;
  playlists: number;
  likes: number;
  summary: Summary;
}

export interface TrackFilter {
  search?: string;
  album_id?: string;
  artist_id?: string;
  playlist?: string;
  local_only?: boolean;
  limit?: number;
  offset?: number;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  checkServer: (url: string) => invoke<ServerInfo>("check_server", { url }),
  pair: (url: string, code: string) => invoke<Settings>("pair", { url, code }),
  unpair: () => invoke<Settings>("unpair"),
  serverStatus: () => invoke<ServerStatus>("server_status"),
  syncLibrary: (refresh = false) => invoke<SyncResult>("sync_library", { refresh }),
  librarySummary: () => invoke<Summary>("library_summary"),
  listTracks: (filter: TrackFilter) => invoke<Track[]>("list_tracks", { filter }),
  listAlbums: (artistId?: string) => invoke<Album[]>("list_albums", { artistId: artistId ?? null }),
  listArtists: () => invoke<Artist[]>("list_artists"),
  listPlaylists: () => invoke<PlaylistSummary[]>("list_playlists"),
  setMusicDir: (path: string) => invoke<Settings>("set_music_dir", { path }),
};

export function fmtDuration(s: number): string {
  if (!s || s < 0) return "–";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function fmtWhen(unix: number): string {
  if (!unix) return "never";
  return new Date(unix * 1000).toLocaleString();
}
