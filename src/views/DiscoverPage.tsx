import { useEffect, useState } from "react";
import { MenuItem } from "../components/ContextMenu";
import { OnlineList } from "../components/OnlineList";
import { DiscoverArtist, DiscoverCollection, OnlineSong, chart, collections, discoverCache, newArtists, notInterested } from "../discover";
import { nav } from "../nav";

/** Discover: new artists, albums and playlists, and the charts. */
export function DiscoverPage({ online, openMenu }: { online: boolean; openMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const [artists, setArtists] = useState<DiscoverArtist[] | null>(discoverCache.artists ?? null);
  const [coll, setColl] = useState(discoverCache.coll ?? null);
  const [top, setTop] = useState<OnlineSong[] | null>(discoverCache.chart ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!online) return;
    if (!discoverCache.artists)
      newArtists()
        .then((a) => {
          discoverCache.artists = a;
          setArtists(a);
        })
        .catch((e) => setErrors((x) => ({ ...x, artists: String(e) })));
    if (!discoverCache.coll)
      collections()
        .then((c) => {
          discoverCache.coll = c;
          setColl(c);
        })
        .catch((e) => setErrors((x) => ({ ...x, coll: String(e) })));
    if (!discoverCache.chart)
      chart()
        .then((t) => {
          discoverCache.chart = t;
          setTop(t);
        })
        .catch((e) => setErrors((x) => ({ ...x, chart: String(e) })));
  }, [online]);

  if (!online) return <div className="empty">Discover needs the server. Your library and downloads still work offline.</div>;

  const openArtist = (a: DiscoverArtist) => nav.push({ section: "search", scope: {}, search: a.name });
  const openCollection = (c: DiscoverCollection) => c.url && nav.push({ section: "collection", scope: { url: c.url, name: c.name, by: c.artist || c.owner || "", cover: c.cover_url || "" }, search: "" });

  function artistMenu(a: DiscoverArtist): MenuItem[] {
    return [
      { label: `Find ${a.name}`, onClick: () => openArtist(a) },
      { separator: true },
      {
        label: "Not interested",
        hint: "only for you",
        onClick: () =>
          notInterested(a.name)
            .then(() => {
              const left = (discoverCache.artists ?? []).filter((x) => x.name !== a.name);
              discoverCache.artists = left;
              setArtists(left);
            })
            .catch(() => {}),
      },
    ];
  }

  return (
    <div className="discover">
      <h3>New artists for you</h3>
      {errors.artists ? (
        <div className="hint">{errors.artists}</div>
      ) : artists === null ? (
        <div className="hint">Finding artists like the ones you play…</div>
      ) : artists.length === 0 ? (
        <div className="hint">No suggestions yet. Listen to a few more songs and check back.</div>
      ) : (
        <div className="grid strip-grid">
          {artists.slice(0, 18).map((a) => (
            <button key={a.name} className="tile artist-tile" onClick={() => openArtist(a)} onContextMenu={(e) => openMenu(e, artistMenu(a))} title={a.because?.length ? `Because you listen to ${a.because.join(", ")}` : a.name}>
              {a.picture_url ? <img className="tile-art round" src={a.picture_url} alt="" loading="lazy" /> : <div className="tile-art round">♫</div>}
              <div className="tile-title">{a.name}</div>
              <div className="tile-sub">{a.because?.length ? `Like ${a.because[0]}` : ""}</div>
            </button>
          ))}
        </div>
      )}

      <h3>Albums and playlists for you</h3>
      {errors.coll ? (
        <div className="hint">{errors.coll}</div>
      ) : coll === null ? (
        <div className="hint">Looking for albums and playlists…</div>
      ) : coll.albums.length + coll.playlists.length === 0 ? (
        <div className="hint">Nothing new right now.</div>
      ) : (
        <div className="grid strip-grid">
          {[...coll.albums.slice(0, 12), ...coll.playlists.slice(0, 6)].map((c, i) => (
            <button key={`${c.url}-${i}`} className="tile" onClick={() => openCollection(c)} title={c.because?.length ? `Because you listen to ${c.because.join(", ")}` : c.name}>
              {c.cover_url ? <img className="tile-art" src={c.cover_url} alt="" loading="lazy" /> : <div className="tile-art">♫</div>}
              <div className="tile-title">{c.name}</div>
              <div className="tile-sub">{c.artist || c.owner || ""}</div>
            </button>
          ))}
        </div>
      )}

      <h3>Top charts</h3>
      {errors.chart ? (
        <div className="hint">{errors.chart}</div>
      ) : top === null ? (
        <div className="hint">Loading the charts…</div>
      ) : (
        <OnlineList songs={top} online={online} openMenu={openMenu} context={{ section: "discover", scope: {}, search: "", localOnly: false }} />
      )}
    </div>
  );
}

/** An album or playlist from Discover, resolved by the server. */
export function CollectionPage({
  url,
  online,
  openMenu,
  songs,
  error,
}: {
  url: string;
  online: boolean;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  songs: OnlineSong[] | null;
  error: string;
}) {
  if (!online) return <div className="empty">This needs the server.</div>;
  if (error) return <div className="empty">{error}</div>;
  if (songs === null) return <div className="hint">Loading the tracklist…</div>;
  return <OnlineList songs={songs} online={online} openMenu={openMenu} context={{ section: "collection", scope: { url }, search: "", localOnly: false }} />;
}
