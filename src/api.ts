import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  server_url: string;
  server_id: string;
  server_name: string;
  username: string;
  device_id: string;
  device_name: string;
  music_dir: string;
  stream_quality: string;
  keep_played: boolean;
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
  orphaned: boolean;
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
  keep_synced: boolean;
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

export function fmtAgo(unix: number): string {
  if (!unix) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function fmtWhen(unix: number): string {
  if (!unix) return "never";
  return new Date(unix * 1000).toLocaleString();
}

// ── Player ───────────────────────────────────────────────────────────────

export interface StreamUrl {
  url: string;
  expires_at: number;
}

export const playerApi = {
  streamUrl: (trackId: string) => invoke<StreamUrl>("stream_url", { trackId }),
  setLike: (trackId: string, liked: boolean) => invoke<boolean>("set_like", { trackId, liked }),
  reportListen: (trackId: string, playId: string) => invoke<void>("report_listen", { trackId, playId }),
  flushListens: () => invoke<number>("flush_listens"),
  reportPlayback: (playbackState: string, track: unknown, position: number) =>
    invoke<void>("report_playback", { playbackState, track, position }),
  getPlayerState: () => invoke<unknown>("get_player_state"),
  setPlayerState: (playerState: unknown) => invoke<void>("set_player_state", { playerState }),
  nowPlaying: (t: { track_id: string; title: string; artist: string; album: string; status: string }) =>
    invoke<void>("now_playing", { trackId: t.track_id, title: t.title, artist: t.artist, album: t.album, status: t.status }),
  setStreamQuality: (quality: string) => invoke<Settings>("set_stream_quality", { quality }),
};

/** The custom `media` scheme as WebView2 on Windows exposes it. */
const MEDIA_ORIGIN = "http://media.localhost";

export const localTrackUrl = (id: string) => `${MEDIA_ORIGIN}/track/${id}`;
export const coverUrl = (id: string, size: 150 | 300 | 600 = 300) => `${MEDIA_ORIGIN}/cover/${id}?size=${size}`;

export const homeApi = {
  recordPlay: (trackId: string) => invoke<void>("record_play", { trackId }),
  recentPlays: (limit = 20) => invoke<Track[]>("recent_plays", { limit }),
  recentAlbums: (limit = 12) => invoke<Album[]>("recent_albums", { limit }),
};

export const playlistCoverUrl = (cover: string) => `${MEDIA_ORIGIN}/playlist-cover?file=${encodeURIComponent(cover)}`;
