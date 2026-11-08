import { useEffect, useRef, useState } from "react";
import { artFor, artistInfo, ArtistInfo, artistPhotoUrl, fmtDuration, profileArtist, Track } from "../api";
import { usePlayer, usePlayerProgress } from "../player/usePlayer";
import { loadLyrics, SongLyrics } from "../lyrics";
import { navBus } from "../navBus";

/**
 * The lyrics page, over the song list: an about panel for the song and its
 * artist on the left, the lyrics on the right. Synced lyrics follow the
 * song: the line being sung is lit and kept in the middle, and clicking a
 * line jumps there. Plain lyrics are shown as text.
 */
export function LyricsView() {
  const { current, player } = usePlayer();
  const [lyrics, setLyrics] = useState<SongLyrics | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    setLyrics(null);
    setFailed("");
    if (!current) return;
    let cancelled = false;
    loadLyrics(current)
      .then((l) => !cancelled && setLyrics(l))
      .catch((e) => !cancelled && setFailed(String(e)));
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && player.setLyricsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  return (
    <div className="lyrics-page">
      {current && <AboutPanel t={current} />}
      <div className="lyrics-main">
        <button className="icon k-util lyrics-close" onClick={() => player.setLyricsOpen(false)} title="Close lyrics (Esc)">
          ✕
        </button>
        {!current ? (
          <div className="lyrics-empty">Play a song to see its lyrics.</div>
        ) : failed ? (
          <div className="lyrics-empty">Couldn't get lyrics: {failed}</div>
        ) : !lyrics ? (
          <div className="lyrics-empty">Looking for lyrics…</div>
        ) : lyrics.lines.length ? (
          <SyncedLines lyrics={lyrics} onSeek={(t) => player.seek(t)} />
        ) : lyrics.plain.trim() ? (
          <div className="lyrics-plain">{lyrics.plain}</div>
        ) : (
          <div className="lyrics-empty">No lyrics found for this song.</div>
        )}
      </div>
    </div>
  );
}

/** Cover, song details, and what the server knows about the artist. */
function AboutPanel({ t }: { t: Track }) {
  const name = profileArtist(t);
  const [info, setInfo] = useState<ArtistInfo | null>(null);
  const [coverOk, setCoverOk] = useState(true);
  const [photoOk, setPhotoOk] = useState(true);
  const [moreBio, setMoreBio] = useState(false);

  useEffect(() => {
    setInfo(null);
    setCoverOk(true);
    setPhotoOk(true);
    setMoreBio(false);
    if (!name) return;
    let cancelled = false;
    artistInfo(name, !t.online)
      .then((i) => !cancelled && setInfo(i))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [name, t.id]);

  const p = info?.profile;
  const photo = info?.art?.photo_url;
  const when = p?.born_or_formed ? (p.is_group === false ? `Born ${p.born_or_formed}` : `Formed ${p.born_or_formed}`) : "";
  const facts = [when, p?.origin].filter(Boolean).join(" · ");
  const bio = (p?.bio || "").trim();
  const details = [
    fmtDuration(t.duration),
    !t.online && t.codec ? t.codec.toUpperCase() : "",
    !t.online && t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : "",
  ].filter(Boolean);

  return (
    <aside className="lyrics-about">
      {coverOk && (t.online ? t.online.cover : t.has_cover) ? (
        <img className="about-cover" src={artFor(t, 600)} alt="" onError={() => setCoverOk(false)} />
      ) : (
        <div className="about-cover placeholder">♫</div>
      )}
      <h2 className="about-title">{t.title || t.file}</h2>
      <div className="about-line">
        {t.artist_id ? (
          <button className="cell-link" title="Go to artist" onClick={() => navBus.go({ artist_id: t.artist_id, artist: t.album_artist || t.artist })}>
            {t.artist}
          </button>
        ) : (
          t.artist
        )}
      </div>
      {t.album && (
        <div className="about-line hint">
          {t.album_id ? (
            <button className="cell-link" title="Go to album" onClick={() => navBus.go({ album_id: t.album_id, album: t.album, album_artist: t.album_artist, cover_track_id: t.id })}>
              {t.album}
            </button>
          ) : (
            t.album
          )}
          {t.year ? ` · ${t.year.slice(0, 4)}` : ""}
        </div>
      )}
      <div className="about-line hint small">{details.join(" · ")}</div>

      {(photo || facts || p?.genre || bio) && (
        <section className="about-artist">
          <div className="about-artist-head">
            {photo && photoOk ? (
              <img className="about-photo" src={artistPhotoUrl(photo, info?.art?.photo_version)} alt="" onError={() => setPhotoOk(false)} />
            ) : (
              <div className="about-photo placeholder">{name.slice(0, 1).toUpperCase()}</div>
            )}
            <div className="about-artist-name">
              <b>{p?.name || name}</b>
              {facts && <div className="hint small">{facts}</div>}
              {p?.genre && <span className="about-genre">{p.genre}</span>}
            </div>
          </div>
          {bio && (
            <>
              <p className={`about-bio ${moreBio ? "open" : ""}`}>{bio}</p>
              {bio.length > 320 && (
                <button className="link small" onClick={() => setMoreBio((m) => !m)}>
                  {moreBio ? "Show less" : "Read more"}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </aside>
  );
}

function SyncedLines({ lyrics, onSeek }: { lyrics: SongLyrics; onSeek: (t: number) => void }) {
  const { position } = usePlayerProgress();
  const box = useRef<HTMLDivElement>(null);
  // After the user scrolls by hand, leave the scroll alone for a few seconds.
  const handScrolled = useRef(0);
  let active = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if (lyrics.lines[i].time <= position + 0.2) active = i;
    else break;
  }

  useEffect(() => {
    if (Date.now() - handScrolled.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${Math.max(active, 0)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div
      className="lyrics-lines"
      ref={box}
      onWheel={() => (handScrolled.current = Date.now())}
      onMouseDown={() => (handScrolled.current = Date.now())}
    >
      {lyrics.lines.map((l, i) => (
        <p
          key={i}
          data-i={i}
          className={i === active ? "on" : i < active ? "past" : ""}
          onClick={() => {
            handScrolled.current = 0;
            onSeek(l.time);
          }}
          title="Jump here"
        >
          {l.text || "♪"}
        </p>
      ))}
    </div>
  );
}
