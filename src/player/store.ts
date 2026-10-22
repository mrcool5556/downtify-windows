// The player: one HTML5 audio element, a queue, and the bookkeeping
// around it (persistence, listens, now-playing, Windows media keys).
// Framework-free; React reads it through usePlayer().

import { listen } from "@tauri-apps/api/event";
import { Track, api, homeApi, localTrackUrl, playerApi } from "../api";
import { invoke } from "@tauri-apps/api/core";

export type Repeat = "off" | "all" | "one";

/** Where the queue came from, so the UI can jump back to that list. */
export interface PlayContext {
  section: string;
  scope: unknown;
  search: string;
  localOnly: boolean;
}

export interface ProgressSnapshot {
  position: number;
  duration: number;
  loading: boolean;
}

export interface PlayerSnapshot {
  queue: Track[];
  /** Play order as indices into `queue` (identity order unless shuffled). */
  order: number[];
  /** Position in `order`; -1 when nothing is loaded. */
  cursor: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  error: string;
  queueOpen: boolean;
  context: PlayContext | null;
  /** Bumped when the user asks to see the list the queue came from. */
  revealNonce: number;
}

type Listener = () => void;

const SAVE_DEBOUNCE_MS = 1500;
const NOW_PLAYING_EVERY_MS = 30_000;

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function shuffledOrder(n: number, first: number): number[] {
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (i !== first) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 ? [first, ...rest] : rest;
}

class PlayerStore {
  private audio = new Audio();
  private listeners = new Set<Listener>();
  private progressListeners = new Set<Listener>();
  private progress: ProgressSnapshot = { position: 0, duration: 0, loading: false };
  private snap: PlayerSnapshot = {
    queue: [],
    order: [],
    cursor: -1,
    current: null,
    playing: false,
    loading: false,
    position: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: "off",
    error: "",
    queueOpen: false,
    context: null,
    revealNonce: 0,
  };
  private streamCache = new Map<string, { url: string; expires_at: number }>();
  private playId = "";
  private listenReported = false;
  private saveTimer: number | undefined;
  private nowPlayingTimer: number | undefined;
  private loadToken = 0;
  private restored = false;
  /** Position to apply once metadata for a restored track arrives. */
  private pendingSeek: number | null = null;

  constructor() {
    const a = this.audio;
    a.preload = "auto";
    a.addEventListener("timeupdate", () => this.set({ position: a.currentTime }));
    a.addEventListener("durationchange", () => this.set({ duration: isFinite(a.duration) ? a.duration : 0 }));
    a.addEventListener("loadedmetadata", () => {
      if (this.pendingSeek != null) {
        a.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
    });
    a.addEventListener("play", () => {
      this.set({ playing: true, error: "" });
      this.pushNowPlaying("playing");
      this.startNowPlayingTimer();
    });
    a.addEventListener("pause", () => {
      this.set({ playing: false });
      if (!a.ended) this.pushNowPlaying("paused");
      this.stopNowPlayingTimer();
    });
    a.addEventListener("waiting", () => this.set({ loading: true }));
    a.addEventListener("canplay", () => this.set({ loading: false }));
    a.addEventListener("ended", () => this.onEnded());
    a.addEventListener("error", () => {
      const code = a.error?.code;
      this.set({ loading: false, playing: false, error: code === 4 ? "Can't play this track (unsupported or unreachable)" : "Playback error" });
    });
    a.addEventListener("timeupdate", () => this.maybeReportListen());

    listen<string>("media-key", (e) => {
      switch (e.payload) {
        case "play":
          this.play();
          break;
        case "toggle":
          this.toggle();
          break;
        case "pause":
          this.pause();
          break;
        case "next":
          this.next();
          break;
        case "previous":
          this.previous();
          break;
        case "stop":
          this.pause();
          break;
      }
    });

    window.addEventListener("beforeunload", () => this.saveNow());
  }

  // ── React plumbing ──────────────────────────────────────────────────

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;
  subscribeProgress = (l: Listener): (() => void) => {
    this.progressListeners.add(l);
    return () => {
      this.progressListeners.delete(l);
    };
  };
  getProgress = () => this.progress;

  /** Position, duration and loading tick several times a second; they go to
   *  progress subscribers only, so lists keyed on the main snapshot stay still. */
  private set(patch: Partial<PlayerSnapshot>) {
    const { position, duration, loading, ...rest } = patch;
    let progressChanged = false;
    if (position !== undefined || duration !== undefined || loading !== undefined) {
      this.progress = {
        position: position ?? this.progress.position,
        duration: duration ?? this.progress.duration,
        loading: loading ?? this.progress.loading,
      };
      progressChanged = true;
    }
    if (Object.keys(rest).length) {
      this.snap = { ...this.snap, ...rest };
      for (const l of this.listeners) l();
    }
    if (progressChanged) for (const l of this.progressListeners) l();
  }

  // ── Restore / persist ───────────────────────────────────────────────

  async restore() {
    if (this.restored) return;
    this.restored = true;
    try {
      const s = (await playerApi.getPlayerState()) as Partial<PlayerSnapshot> | null;
      if (!s || !Array.isArray(s.queue)) {
        this.audio.volume = this.snap.volume;
        return;
      }
      const queue = s.queue as Track[];
      const order = Array.isArray(s.order) && s.order.length === queue.length ? s.order : queue.map((_, i) => i);
      const cursor = typeof s.cursor === "number" && s.cursor >= 0 && s.cursor < order.length ? s.cursor : -1;
      const volume = typeof s.volume === "number" ? Math.min(1, Math.max(0, s.volume)) : 0.8;
      this.audio.volume = volume;
      this.set({
        queue,
        order,
        cursor,
        volume,
        shuffle: !!s.shuffle,
        repeat: s.repeat === "all" || s.repeat === "one" ? s.repeat : "off",
        current: cursor >= 0 ? queue[order[cursor]] : null,
        position: typeof s.position === "number" ? s.position : 0,
        context: (s.context as PlayContext | null) ?? null,
      });
      if (cursor >= 0) {
        // Show the track without starting it. A local file is loaded so
        // seeking works at once; a streamed one waits for play, so an
        // offline launch never shows a network error unasked.
        this.pendingSeek = typeof s.position === "number" ? s.position : null;
        const cur = queue[order[cursor]];
        this.set({ duration: cur?.duration ?? 0, position: this.pendingSeek ?? 0 });
        if (cur?.local_path) await this.loadCurrent(false);
      }
    } catch {
      /* start fresh */
    }
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  private saveNow() {
    const s = this.snap;
    playerApi
      .setPlayerState({
        queue: s.queue.slice(0, 5000),
        order: s.order,
        cursor: s.cursor,
        position: s.position,
        volume: s.volume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        context: s.context,
      })
      .catch(() => {});
  }

  // ── Source resolution ───────────────────────────────────────────────

  private async sourceFor(track: Track): Promise<string> {
    if (track.local_path) return localTrackUrl(track.id);
    const cached = this.streamCache.get(track.id);
    const nowSec = Date.now() / 1000;
    if (cached && cached.expires_at > nowSec) return cached.url;
    const s = await playerApi.streamUrl(track.id);
    this.streamCache.set(track.id, s);
    return s.url;
  }

  private async loadCurrent(autoplay: boolean) {
    const track = this.snap.current;
    if (!track) return;
    const token = ++this.loadToken;
    this.set({ loading: true, error: "", position: this.pendingSeek ?? 0, duration: track.duration || 0 });
    this.playId = newId();
    this.listenReported = false;
    let src: string;
    try {
      src = await this.sourceFor(track);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.set({ loading: false, playing: false, error: track.local_path ? String(e) : `Not downloaded and the server is unreachable` });
      return;
    }
    if (token !== this.loadToken) return;
    this.audio.src = src;
    this.audio.load();
    this.pushSmtc(autoplay ? "playing" : "paused");
    if (autoplay) {
      homeApi.recordPlay(track.id).catch(() => {});
      if (!track.local_path) {
        api.getSettings()
          .then((s) => {
            if (s.keep_played) invoke("download_tracks", { trackIds: [track.id] }).catch(() => {});
          })
          .catch(() => {});
      }
      this.audio.play().catch(() => {});
    } else {
      this.set({ loading: false });
    }
    this.scheduleSave();
  }

  // ── Controls ────────────────────────────────────────────────────────

  /** Play `tracks[startIndex]` and make `tracks` the queue. */
  playList(tracks: Track[], startIndex: number, context: PlayContext | null = null) {
    if (tracks.length === 0) return;
    const start = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const order = this.snap.shuffle ? shuffledOrder(tracks.length, start) : tracks.map((_, i) => i);
    const cursor = order.indexOf(start);
    this.pendingSeek = null;
    this.set({ queue: tracks, order, cursor, current: tracks[start], context });
    this.loadCurrent(true);
  }

  /** Ask the library to show the list the queue came from. */
  reveal() {
    this.set({ revealNonce: this.snap.revealNonce + 1 });
  }

  play() {
    if (!this.snap.current) {
      if (this.snap.queue.length) this.goTo(0, true);
      return;
    }
    if (!this.audio.src) {
      this.loadCurrent(true);
      return;
    }
    this.audio.play().catch(() => {});
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    if (this.snap.playing) this.pause();
    else this.play();
  }

  private goTo(cursor: number, autoplay: boolean) {
    const { queue, order } = this.snap;
    if (cursor < 0 || cursor >= order.length) return;
    this.pendingSeek = null;
    this.set({ cursor, current: queue[order[cursor]], position: 0 });
    this.loadCurrent(autoplay);
  }

  next() {
    const { cursor, order, repeat } = this.snap;
    if (cursor + 1 < order.length) this.goTo(cursor + 1, true);
    else if (repeat === "all" && order.length) this.goTo(0, true);
    else {
      this.pause();
      this.audio.currentTime = 0;
    }
  }

  previous() {
    if (this.audio.currentTime > 3 || this.snap.cursor <= 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.goTo(this.snap.cursor - 1, true);
  }

  /** Put tracks right after the current song. */
  playNext(tracks: Track[]) {
    if (tracks.length === 0) return;
    if (this.snap.queue.length === 0) {
      this.playList(tracks, 0);
      return;
    }
    const { queue, order, cursor } = this.snap;
    const base = queue.length;
    const newQueue = [...queue, ...tracks];
    const inserted = tracks.map((_, i) => base + i);
    const at = cursor + 1;
    const newOrder = [...order.slice(0, at), ...inserted, ...order.slice(at)];
    this.set({ queue: newQueue, order: newOrder });
    this.scheduleSave();
  }

  /** Append tracks to the end of the queue. */
  addToQueue(tracks: Track[]) {
    if (tracks.length === 0) return;
    if (this.snap.queue.length === 0) {
      this.playList(tracks, 0);
      return;
    }
    const { queue, order } = this.snap;
    const base = queue.length;
    this.set({ queue: [...queue, ...tracks], order: [...order, ...tracks.map((_, i) => base + i)] });
    this.scheduleSave();
  }

  /** Remove one entry (index into `queue`). Removing the current song skips it. */
  removeFromQueue(index: number) {
    const { queue, order, cursor } = this.snap;
    if (index < 0 || index >= queue.length) return;
    const wasCurrent = cursor >= 0 && order[cursor] === index;
    const newQueue = queue.filter((_, i) => i !== index);
    const remap = (i: number) => (i > index ? i - 1 : i);
    const newOrder = order.filter((i) => i !== index).map(remap);
    let newCursor = cursor;
    if (wasCurrent) {
      newCursor = Math.min(cursor, newOrder.length - 1);
      this.set({ queue: newQueue, order: newOrder, cursor: newCursor, current: newCursor >= 0 ? newQueue[newOrder[newCursor]] : null });
      if (newCursor >= 0) this.loadCurrent(this.snap.playing);
      else {
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.pushSmtc("stopped");
      }
    } else {
      const pos = order.indexOf(index);
      if (pos >= 0 && pos < cursor) newCursor = cursor - 1;
      this.set({ queue: newQueue, order: newOrder, cursor: newCursor });
    }
    this.scheduleSave();
  }

  /** Reorder within the play order: move the entry at order position `from` to `to`. */
  moveInOrder(from: number, to: number) {
    const { order, cursor } = this.snap;
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const newOrder = [...order];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    let newCursor = cursor;
    if (cursor === from) newCursor = to;
    else if (from < cursor && to >= cursor) newCursor = cursor - 1;
    else if (from > cursor && to <= cursor) newCursor = cursor + 1;
    this.set({ order: newOrder, cursor: newCursor });
    this.scheduleSave();
  }

  /** Shuffle-play a list from a random start. */
  shufflePlay(tracks: Track[], context: PlayContext | null = null) {
    if (tracks.length === 0) return;
    if (!this.snap.shuffle) this.set({ shuffle: true });
    this.playList(tracks, Math.floor(Math.random() * tracks.length), context);
  }

  /** Jump to a queue entry (index into `queue`, not `order`). */
  playQueueIndex(index: number) {
    const cursor = this.snap.order.indexOf(index);
    if (cursor >= 0) this.goTo(cursor, true);
  }

  private onEnded() {
    const { cursor, order, repeat } = this.snap;
    if (repeat === "one") {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (cursor + 1 < order.length) this.goTo(cursor + 1, true);
    else if (repeat === "all" && order.length) this.goTo(0, true);
    else {
      this.set({ playing: false });
      this.pushNowPlaying("stopped");
      this.pushSmtc("paused");
    }
  }

  seek(seconds: number) {
    const d = this.snap.duration || this.audio.duration || 0;
    const t = Math.max(0, Math.min(seconds, d || seconds));
    this.audio.currentTime = t;
    this.set({ position: t });
    this.scheduleSave();
  }

  seekBy(delta: number) {
    this.seek(this.audio.currentTime + delta);
  }

  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v));
    this.audio.volume = vol;
    this.audio.muted = false;
    this.set({ volume: vol, muted: false });
    this.scheduleSave();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.set({ muted: this.audio.muted });
  }

  toggleShuffle() {
    const shuffle = !this.snap.shuffle;
    const { queue, order, cursor } = this.snap;
    const currentIndex = cursor >= 0 ? order[cursor] : -1;
    const newOrder = shuffle ? shuffledOrder(queue.length, currentIndex) : queue.map((_, i) => i);
    this.set({ shuffle, order: newOrder, cursor: currentIndex >= 0 ? newOrder.indexOf(currentIndex) : -1 });
    this.scheduleSave();
  }

  cycleRepeat() {
    const next: Repeat = this.snap.repeat === "off" ? "all" : this.snap.repeat === "all" ? "one" : "off";
    this.set({ repeat: next });
    this.scheduleSave();
  }

  setQueueOpen(open: boolean) {
    this.set({ queueOpen: open });
  }

  /** Called by the UI after a like changed anywhere, to keep the queue in step. */
  applyLike(trackId: string, liked: boolean) {
    const queue = this.snap.queue.map((t) => (t.id === trackId ? { ...t, liked } : t));
    const current = this.snap.current && this.snap.current.id === trackId ? { ...this.snap.current, liked } : this.snap.current;
    this.set({ queue, current });
  }

  /** Called after a download finished, so the next play uses the file. */
  applyLocalPath(trackId: string, localPath: string | null) {
    const queue = this.snap.queue.map((t) => (t.id === trackId ? { ...t, local_path: localPath } : t));
    const current = this.snap.current && this.snap.current.id === trackId ? { ...this.snap.current, local_path: localPath } : this.snap.current;
    this.set({ queue, current });
  }

  // ── Server reporting ────────────────────────────────────────────────

  private maybeReportListen() {
    const t = this.snap.current;
    if (!t || this.listenReported) return;
    const d = this.audio.duration || t.duration || 0;
    if (!d) return;
    const threshold = Math.min(d / 2, 240);
    if (this.audio.currentTime >= threshold) {
      this.listenReported = true;
      playerApi.reportListen(t.id, this.playId).catch(() => {});
    }
  }

  private trackPayload() {
    const t = this.snap.current;
    return t ? { track_id: t.id, title: t.title, artist: t.artist, album: t.album, duration: Math.round(t.duration || 0) } : {};
  }

  private pushNowPlaying(state: "playing" | "paused" | "stopped") {
    playerApi.reportPlayback(state, this.trackPayload(), Math.round(this.audio.currentTime)).catch(() => {});
    if (state !== "playing") this.pushSmtc(state === "stopped" ? "stopped" : "paused");
    else this.pushSmtc("playing");
  }

  private startNowPlayingTimer() {
    this.stopNowPlayingTimer();
    this.nowPlayingTimer = window.setInterval(() => {
      if (this.snap.playing) this.pushNowPlaying("playing");
      this.scheduleSave();
    }, NOW_PLAYING_EVERY_MS);
  }

  private stopNowPlayingTimer() {
    window.clearInterval(this.nowPlayingTimer);
    this.nowPlayingTimer = undefined;
  }

  private pushSmtc(status: "playing" | "paused" | "stopped") {
    const t = this.snap.current;
    playerApi
      .nowPlaying({
        track_id: t?.id ?? "",
        title: t?.title ?? "",
        artist: t?.artist ?? "",
        album: t?.album ?? "",
        status: t ? status : "stopped",
      })
      .catch(() => {});
  }
}

export const player = new PlayerStore();
